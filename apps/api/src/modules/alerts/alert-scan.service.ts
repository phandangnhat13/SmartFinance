import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, SpendingAlertType } from '@prisma/client';
import type { AlertScanSummaryDto } from '@smart-finance/shared-types';
import { DateTime } from 'luxon';
import { PrismaService } from '../../common/prisma/prisma.service';
import { isValidTimezone } from '../../common/utils/period';
import { toStoredScore } from './alert-score';
import type { DetectorResult, TransactionSample } from './detectors/anomaly.types';
import {
  CATEGORY_SPIKE_RULES,
  detectCategorySpike,
  type CategorySpikeFacts,
} from './detectors/category-spike.detector';
import {
  LARGE_TRANSACTION_RULES,
  detectLargeTransaction,
  type LargeTransactionFacts,
} from './detectors/large-transaction.detector';
import { DUPLICATE_RULES, detectPossibleDuplicates } from './detectors/possible-duplicate.detector';
import { buildScanWindows, type AlertScanWindows } from './scan-windows';

/**
 * Hard bounds for one scan. They exist so a huge (or corrupted) import cannot
 * make the endpoint load unbounded history; when any of them is hit the scan
 * reports `truncated` instead of claiming a complete pass.
 */
export const ALERT_SCAN_LIMITS = {
  lookbackDays: LARGE_TRANSACTION_RULES.lookbackDays,
  candidateDays: 30,
  referenceMonths: 3,
  maxTransactions: 5000,
  maxLargeCandidates: 500,
  maxDuplicatePairs: DUPLICATE_RULES.maxPairs,
} as const;

const DEFAULT_TIMEZONE = 'Asia/Ho_Chi_Minh';

/** Only the fields the detectors consume are read from PostgreSQL. */
const TRANSACTION_SELECT = {
  id: true,
  accountId: true,
  categoryId: true,
  type: true,
  amount: true,
  currency: true,
  description: true,
  occurredAt: true,
  category: { select: { name: true } },
} satisfies Prisma.TransactionSelect;

type ScanTransactionRow = Prisma.TransactionGetPayload<{ select: typeof TRANSACTION_SELECT }>;

interface LoadedTransactions {
  samples: TransactionSample[];
  categoryNames: Map<string, string>;
  transactionsTruncated: boolean;
}

@Injectable()
export class AlertScanService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Runs every detector for one user and inserts only what is new. Existing
   * rows are never updated, so a dismissed or resolved alert stays that way
   * across scans; the unique index `(userId, dedupeKey)` is what actually
   * prevents duplicates, including between two concurrent scans.
   */
  async scan(userId: string): Promise<AlertScanSummaryDto> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { timezone: true, defaultCurrency: true },
    });
    if (!user) throw new NotFoundException('Không tìm thấy người dùng');

    const timezone = isValidTimezone(user.timezone) ? user.timezone : DEFAULT_TIMEZONE;
    const windows = buildScanWindows(DateTime.now().setZone(timezone), ALERT_SCAN_LIMITS);
    const loaded = await this.loadTransactions(userId, windows);

    const results: Array<DetectorResult<unknown>> = [];
    const largeResults = this.detectLargeTransactions(loaded.samples, windows);
    results.push(...largeResults.results);

    results.push(
      ...this.detectCategorySpikes(
        loaded.samples,
        loaded.categoryNames,
        user.defaultCurrency,
        windows,
      ),
    );

    const duplicateResults = detectPossibleDuplicates(loaded.samples);
    results.push(...duplicateResults);
    const duplicateCapReached = duplicateResults.length >= ALERT_SCAN_LIMITS.maxDuplicatePairs;

    const created = await this.persist(userId, results);
    const detectedByType: Record<SpendingAlertType, number> = {
      LARGE_TRANSACTION: 0,
      CATEGORY_SPIKE: 0,
      POSSIBLE_DUPLICATE: 0,
    };
    for (const result of results) detectedByType[result.type] += 1;

    const truncated = loaded.transactionsTruncated || largeResults.capped || duplicateCapReached;

    return {
      status: truncated ? 'truncated' : 'completed',
      detected: results.length,
      created,
      alreadyPresent: results.length - created,
      detectedByType,
      scannedTransactions: loaded.samples.length,
      window: {
        currentMonth: windows.current.month,
        currentDays: windows.current.days,
        referenceMonths: windows.references.map((reference) => reference.month),
      },
      limits: {
        lookbackDays: ALERT_SCAN_LIMITS.lookbackDays,
        candidateDays: ALERT_SCAN_LIMITS.candidateDays,
        maxTransactions: ALERT_SCAN_LIMITS.maxTransactions,
        maxLargeCandidates: ALERT_SCAN_LIMITS.maxLargeCandidates,
        maxDuplicatePairs: ALERT_SCAN_LIMITS.maxDuplicatePairs,
        transactionsTruncated: loaded.transactionsTruncated,
        largeCandidatesCapped: largeResults.capped,
        duplicateCapReached,
      },
    };
  }

  private async loadTransactions(
    userId: string,
    windows: AlertScanWindows,
  ): Promise<LoadedTransactions> {
    // Newest first, one extra row: the extra row is how we *know* more exists.
    const rows = await this.prisma.transaction.findMany({
      where: {
        userId,
        // Transfers are internal moves, never income or spending.
        type: { in: ['INCOME', 'EXPENSE'] },
        occurredAt: { gte: windows.historyStart, lt: windows.nowExclusive },
      },
      select: TRANSACTION_SELECT,
      orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
      take: ALERT_SCAN_LIMITS.maxTransactions + 1,
    });

    const transactionsTruncated = rows.length > ALERT_SCAN_LIMITS.maxTransactions;
    const kept = transactionsTruncated ? rows.slice(0, ALERT_SCAN_LIMITS.maxTransactions) : rows;
    const categoryNames = new Map<string, string>();
    for (const row of kept) {
      if (row.categoryId && row.category) categoryNames.set(row.categoryId, row.category.name);
    }

    return {
      samples: kept.map((row) => this.toSample(row)),
      categoryNames,
      transactionsTruncated,
    };
  }

  private toSample(row: ScanTransactionRow): TransactionSample {
    return {
      id: row.id,
      accountId: row.accountId,
      categoryId: row.categoryId,
      type: row.type,
      amount: row.amount.toFixed(2),
      currency: row.currency,
      description: row.description,
      occurredAt: row.occurredAt,
    };
  }

  /**
   * Only recent expenses are re-examined as candidates; the baseline still uses
   * the whole loaded history. Candidates are taken newest-first, so capping
   * drops the least interesting (oldest) ones.
   */
  private detectLargeTransactions(
    samples: readonly TransactionSample[],
    windows: AlertScanWindows,
  ): { results: Array<DetectorResult<LargeTransactionFacts>>; capped: boolean } {
    const expensesByCurrency = new Map<string, TransactionSample[]>();
    for (const sample of samples) {
      if (sample.type !== 'EXPENSE') continue;
      const list = expensesByCurrency.get(sample.currency) ?? [];
      list.push(sample);
      expensesByCurrency.set(sample.currency, list);
    }
    for (const list of expensesByCurrency.values()) {
      list.sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
    }

    const candidates = samples.filter(
      (sample) =>
        sample.type === 'EXPENSE' &&
        sample.occurredAt.getTime() >= windows.candidateStart.getTime(),
    );
    const capped = candidates.length > ALERT_SCAN_LIMITS.maxLargeCandidates;
    const scanned = capped ? candidates.slice(0, ALERT_SCAN_LIMITS.maxLargeCandidates) : candidates;

    const results: Array<DetectorResult<LargeTransactionFacts>> = [];
    for (const candidate of scanned) {
      const history = (expensesByCurrency.get(candidate.currency) ?? []).filter(
        (transaction) =>
          transaction.id !== candidate.id &&
          transaction.occurredAt.getTime() < candidate.occurredAt.getTime(),
      );
      const result = detectLargeTransaction({ candidate, history });
      if (result) results.push(result);
    }
    return { results, capped };
  }

  private detectCategorySpikes(
    samples: readonly TransactionSample[],
    categoryNames: Map<string, string>,
    currency: string,
    windows: AlertScanWindows,
  ): Array<DetectorResult<CategorySpikeFacts>> {
    // Only months in the user's default currency are compared; this project
    // has no exchange rates, and mixing currencies would invent numbers.
    const currentCounts = new Map<string, number>();
    for (const sample of samples) {
      if (sample.type !== 'EXPENSE' || !sample.categoryId || sample.currency !== currency) continue;
      if (sample.occurredAt.getTime() < windows.current.start.getTime()) continue;
      if (sample.occurredAt.getTime() >= windows.current.endExclusive.getTime()) continue;
      currentCounts.set(sample.categoryId, (currentCounts.get(sample.categoryId) ?? 0) + 1);
    }

    const results: Array<DetectorResult<CategorySpikeFacts>> = [];
    for (const [categoryId, count] of currentCounts) {
      if (count < CATEGORY_SPIKE_RULES.minCurrentTransactions) continue;
      const result = detectCategorySpike({
        categoryId,
        categoryName: categoryNames.get(categoryId) ?? 'Không xác định',
        currency,
        current: windows.current,
        references: windows.references,
        transactions: samples,
      });
      if (result) results.push(result);
    }
    return results;
  }

  /** Inserts candidates, skipping any dedupe key the user already has. */
  private async persist(
    userId: string,
    results: ReadonlyArray<DetectorResult<unknown>>,
  ): Promise<number> {
    if (results.length === 0) return 0;
    const data: Prisma.SpendingAlertCreateManyInput[] = results.map((result) => ({
      userId,
      type: result.type,
      severity: result.severity,
      dedupeKey: result.dedupeKey,
      transactionId: result.transactionId,
      relatedTransactionId: result.relatedTransactionId,
      categoryId: result.categoryId,
      periodStart: result.periodStart,
      periodEnd: result.periodEnd,
      // Defence in depth: a detector that ever emits a score outside
      // DECIMAL(10, 4) must not fail the whole scan. Detectors keep the exact
      // value in their facts, so clamping here only protects the INSERT.
      score: result.score === null ? null : toStoredScore(new Prisma.Decimal(result.score)).score,
      facts: result.facts as Prisma.InputJsonValue,
    }));
    const { count } = await this.prisma.spendingAlert.createMany({ data, skipDuplicates: true });
    return count;
  }
}
