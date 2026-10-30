import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  AnalyticsForecastCashFlowDto,
  AnalyticsForecastDto,
  AnalyticsForecastExpensesDto,
  AnalyticsForecastIncomeDto,
  ForecastBalanceDto,
  ForecastCashFlowDto,
  ForecastCategoryDto,
  ForecastContextDto,
  ForecastDataQualityDto,
  ForecastHorizon,
  ForecastMonthValueDto,
  ForecastReason,
  ForecastSeriesDto,
} from '@smart-finance/shared-types';
import { DateTime } from 'luxon';
import { PrismaService } from '../../common/prisma/prisma.service';
import { moneyString } from '../../common/utils/money';
import { isValidTimezone } from '../../common/utils/period';
import { ForecastCache } from './forecast-cache';
import {
  bucketByMonth,
  forecastSeries,
  horizonMonths,
  monthOf,
  monthsEndingBefore,
  MAX_ANALYSIS_MONTHS,
  type MonthActual,
  type SeriesForecast,
  type SeriesKey,
} from './forecast-engine';
import type { ForecastQuery } from './dto/forecast.query';

const FALLBACK_TIMEZONE = 'Asia/Ho_Chi_Minh';
const DEFAULT_CURRENCY = 'VND';
const DEFAULT_HORIZON: ForecastHorizon = 'current_month';
const CATEGORY_FORECAST_LIMIT = 5;

interface ForecastRow {
  occurredAt: Date;
  type: 'INCOME' | 'EXPENSE';
  amount: Prisma.Decimal;
  categoryId: string | null;
  category: { name: string; isArchived: boolean } | null;
}

interface BalanceRow {
  accountId: string;
  type: 'INCOME' | 'EXPENSE' | 'TRANSFER';
  transferDirection: 'IN' | 'OUT' | null;
  _sum: { amount: Prisma.Decimal | null };
}

interface BuiltSeries {
  dto: ForecastSeriesDto;
  engine: SeriesForecast;
  /** Amount actually recorded in the current month so far. */
  monthToDate: number;
  remainingCurrentMonth: number | null;
  horizonTotal: number | null;
}

interface SeriesOptions {
  horizon: ForecastHorizon;
  currentMonth: string;
  monthToDate: number;
  windowMonths: number;
}

function money(value: number | null): string | null {
  if (value === null || !Number.isFinite(value)) return null;
  return moneyString(new Prisma.Decimal(value.toFixed(2)));
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

/**
 * Financial forecasting (M3c).
 *
 * Read-only, server-side and statistical. Every response carries the model,
 * the backtest error, how many months were used and the data-quality flags; when
 * the history is too thin the numbers are withheld instead of guessed. Nothing
 * here writes a transaction, changes a balance or calls an LLM.
 */
@Injectable()
export class AnalyticsForecastService {
  private readonly cache = new ForecastCache();

  constructor(private readonly prisma: PrismaService) {}

  async forecast(userId: string, query: ForecastQuery): Promise<AnalyticsForecastDto> {
    const { timezone, defaultCurrency } = await this.context(userId);
    const currency = (query.currency ?? defaultCurrency).toUpperCase() || DEFAULT_CURRENCY;
    const horizon = query.horizon ?? DEFAULT_HORIZON;

    const now = DateTime.now().setZone(timezone);
    if (!now.isValid) {
      // `context` already validates the zone; this is defensive only.
      throw new Error('Invalid timezone');
    }
    const currentMonth = now.toFormat('yyyy-MM');
    const asOf = now.toISODate() ?? now.toFormat('yyyy-MM-dd');
    const targetMonths = horizonMonths(currentMonth, horizon);
    const windowMonths = monthsEndingBefore(currentMonth, MAX_ANALYSIS_MONTHS);

    const fingerprint = await this.fingerprint(userId);
    const key = this.cache.buildKey({ userId, currency, timezone, horizon, fingerprint });
    const cached = this.cache.get(key);
    if (cached) return cached;

    const windowStart = DateTime.fromFormat(`${windowMonths[0]}-01`, 'yyyy-MM-dd', {
      zone: timezone,
    })
      .startOf('day')
      .toUTC();
    const nowUtc = now.toUTC();

    const [rows, accountRows, balanceRows] = await Promise.all([
      this.prisma.transaction.findMany({
        where: {
          userId,
          currency,
          type: { in: ['INCOME', 'EXPENSE'] },
          occurredAt: { gte: windowStart.toJSDate(), lt: nowUtc.toJSDate() },
        },
        select: {
          occurredAt: true,
          type: true,
          amount: true,
          categoryId: true,
          category: { select: { name: true, isArchived: true } },
        },
      }),
      this.prisma.account.findMany({
        where: { userId, currency },
        select: { id: true, initialBalance: true, isArchived: true },
      }),
      this.prisma.transaction.groupBy({
        by: ['accountId', 'type', 'transferDirection'],
        where: { userId, currency, occurredAt: { lt: nowUtc.toJSDate() } },
        _sum: { amount: true },
      }),
    ]);

    const typedRows = rows as ForecastRow[];
    const historyRows = typedRows.filter(
      (row) => monthOf(row.occurredAt, timezone) !== currentMonth,
    );
    const currentRows = typedRows.filter(
      (row) => monthOf(row.occurredAt, timezone) === currentMonth,
    );

    const actuals = bucketByMonth(
      historyRows.map((row) => ({
        occurredAt: row.occurredAt,
        type: row.type,
        amount: row.amount.toFixed(2),
      })),
      timezone,
      windowMonths,
    );

    const monthToDate: Record<SeriesKey, number> = {
      income: sum(
        currentRows.filter((row) => row.type === 'INCOME').map((row) => Number(row.amount)),
      ),
      expense: sum(
        currentRows.filter((row) => row.type === 'EXPENSE').map((row) => Number(row.amount)),
      ),
    };

    // Always forecast the current month too: the balance needs its remainder even
    // when the selected horizon starts next month.
    const engineTargets = Array.from(new Set([...targetMonths, currentMonth])).sort();
    const income = this.buildSeries(actuals, 'income', engineTargets, targetMonths, {
      horizon,
      currentMonth,
      monthToDate: monthToDate.income,
      windowMonths: windowMonths.length,
    });
    const expense = this.buildSeries(actuals, 'expense', engineTargets, targetMonths, {
      horizon,
      currentMonth,
      monthToDate: monthToDate.expense,
      windowMonths: windowMonths.length,
    });

    const dataQuality = this.dataQuality(actuals, historyRows.length);
    const status =
      income.dto.status === 'ok' && expense.dto.status === 'ok' ? 'ok' : 'insufficient_data';
    const reason: ForecastReason =
      income.dto.status !== 'ok' ? income.dto.reason : expense.dto.reason;

    const net = this.buildNet(income, expense, status, reason);
    const monthEndBalance = this.buildBalance(accountRows, balanceRows, {
      income,
      expense,
      status,
    });

    const dto: AnalyticsForecastDto = {
      currency,
      timezone,
      asOf,
      generatedAt: nowUtc.toISO() ?? '',
      horizon,
      horizonMonths: targetMonths,
      status,
      reason,
      income: income.dto,
      expense: expense.dto,
      categoryForecasts: this.categoryForecasts(
        historyRows,
        currentRows,
        timezone,
        windowMonths,
        engineTargets,
        targetMonths,
        horizon,
        currentMonth,
      ),
      net,
      monthEndBalance,
      dataQuality,
      assumptions: [
        'Dự báo chỉ dùng các tháng lịch đã kết thúc; tháng hiện tại chỉ tính phần còn lại sau hôm nay.',
        'Chỉ giao dịch thu nhập và chi tiêu cùng loại tiền được dùng; giao dịch chuyển tiền nội bộ không phải thu hay chi.',
        'Mô hình là thống kê thuần (trung bình lịch sử, trung bình có trọng số hoặc xu hướng tuyến tính); không dùng AI/LLM và không tự tạo giao dịch.',
        'Số dư cuối tháng = số dư hiện tại + thu nhập còn dự báo − chi tiêu còn dự báo trong tháng này.',
      ],
      limitations: [
        'Không dự đoán được sự kiện bất thường, thay đổi việc làm hay khoản chi lớn chưa từng xảy ra.',
        'Tháng không có giao dịch không được coi là tháng chi tiêu bằng 0; chúng bị loại khỏi mẫu.',
        'Số dư hiện tại dựa trên số dư ban đầu của tài khoản (không có ngày) cộng mọi giao dịch đã ghi nhận đến hiện tại.',
        'Dải tốt nhất/xấu nhất là sai số backtest đơn giản, không phải khoảng tin cậy thống kê.',
        'Độ chính xác trong quá khứ không bảo đảm kết quả tương lai; đây không phải tư vấn đầu tư.',
      ],
      estimated: true,
    };

    this.cache.set(key, dto);
    return dto;
  }

  async income(userId: string, query: ForecastQuery): Promise<AnalyticsForecastIncomeDto> {
    const forecast = await this.forecast(userId, query);
    return {
      ...this.contextOf(forecast),
      slice: 'income',
      status: forecast.status,
      reason: forecast.reason,
      income: forecast.income,
    };
  }

  async expenses(userId: string, query: ForecastQuery): Promise<AnalyticsForecastExpensesDto> {
    const forecast = await this.forecast(userId, query);
    return {
      ...this.contextOf(forecast),
      slice: 'expenses',
      status: forecast.status,
      reason: forecast.reason,
      expense: forecast.expense,
      categoryForecasts: forecast.categoryForecasts,
    };
  }

  async cashFlow(userId: string, query: ForecastQuery): Promise<AnalyticsForecastCashFlowDto> {
    const forecast = await this.forecast(userId, query);
    return {
      ...this.contextOf(forecast),
      slice: 'cash-flow',
      status: forecast.status,
      reason: forecast.reason,
      net: forecast.net,
      monthEndBalance: forecast.monthEndBalance,
    };
  }

  private contextOf(forecast: AnalyticsForecastDto): ForecastContextDto {
    return {
      currency: forecast.currency,
      timezone: forecast.timezone,
      asOf: forecast.asOf,
      generatedAt: forecast.generatedAt,
      horizon: forecast.horizon,
      horizonMonths: forecast.horizonMonths,
      dataQuality: forecast.dataQuality,
      assumptions: forecast.assumptions,
      limitations: forecast.limitations,
      estimated: forecast.estimated,
    };
  }

  private buildSeries(
    actuals: MonthActual[],
    key: SeriesKey,
    engineTargets: string[],
    horizonMonthsList: string[],
    options: SeriesOptions,
  ): BuiltSeries {
    const engine = forecastSeries(actuals, key, engineTargets, options.windowMonths);
    const full = new Map(engine.months.map((month) => [month.month, month.amount]));

    // Nothing is projected when the engine withholds a forecast: an empty list
    // is honest, a row of zeros would look like a real estimate.
    const months =
      engine.status === 'ok'
        ? this.projectMonths({
            full,
            fullTargets: horizonMonthsList,
            monthToDate: options.monthToDate,
            partialMonth: options.horizon === 'current_month' ? options.currentMonth : null,
          })
        : [];

    const horizonTotal =
      engine.status === 'ok' ? sum(months.map((month) => Number(month.amount))) : null;
    const currentFull = full.get(options.currentMonth) ?? null;
    const remainingCurrentMonth =
      engine.status === 'ok' && currentFull !== null
        ? Math.max(0, currentFull - options.monthToDate)
        : null;

    const dto: ForecastSeriesDto = {
      kind: key,
      status: engine.status,
      reason: engine.reason,
      model: engine.model,
      modelScores: engine.scores.map((score) => ({
        model: score.model,
        eligible: score.eligible,
        reason: score.reason,
        origins: score.origins,
        mae: money(score.mae),
        wapePercent: score.wapePercent,
      })),
      selectedBecause: engine.selectedBecause,
      confidence: engine.confidence,
      monthlyAverage: money(engine.monthlyAverage),
      monthsWithData: engine.monthsWithData,
      history: actuals.map((month) => ({
        month: month.month,
        amount: money(month[key]) ?? '0.00',
        hasTransactions: month.hasTransactions,
      })),
      months,
      horizonTotal: money(horizonTotal),
    };

    return {
      dto,
      engine,
      monthToDate: options.monthToDate,
      remainingCurrentMonth,
      horizonTotal,
    };
  }

  /**
   * Turns full-month forecasts into the horizon's figures. For the
   * `current_month` horizon the current month keeps only what is still expected:
   * the full-month forecast minus what was already recorded this month.
   */
  private projectMonths(input: {
    full: Map<string, number>;
    fullTargets: string[];
    monthToDate: number;
    partialMonth: string | null;
  }): ForecastMonthValueDto[] {
    return input.fullTargets.map((month) => {
      const fullAmount = input.full.get(month) ?? 0;
      const isPartial = input.partialMonth === month;
      const amount = isPartial ? Math.max(0, fullAmount - input.monthToDate) : fullAmount;
      return { month, amount: money(amount) ?? '0.00', isPartial };
    });
  }

  private buildNet(
    income: BuiltSeries,
    expense: BuiltSeries,
    status: 'ok' | 'insufficient_data',
    reason: ForecastReason,
  ): ForecastCashFlowDto {
    if (status !== 'ok' || income.horizonTotal === null || expense.horizonTotal === null) {
      return {
        status: 'insufficient_data',
        reason,
        model: null,
        base: null,
        best: null,
        worst: null,
        bandMethod: null,
      };
    }
    const base = income.horizonTotal - expense.horizonTotal;
    const incomeMae = income.engine.mae;
    const expenseMae = expense.engine.mae;
    const band =
      incomeMae !== null && expenseMae !== null ? Math.abs(incomeMae) + Math.abs(expenseMae) : null;

    return {
      status: 'ok',
      reason: null,
      model: income.engine.model === expense.engine.model ? income.engine.model : null,
      base: money(base),
      best: band === null ? null : money(base + band),
      worst: band === null ? null : money(base - band),
      bandMethod: band === null ? null : 'mae',
    };
  }

  private buildBalance(
    accounts: Array<{ id: string; initialBalance: Prisma.Decimal; isArchived: boolean }>,
    balanceRows: BalanceRow[],
    input: { income: BuiltSeries; expense: BuiltSeries; status: 'ok' | 'insufficient_data' },
  ): ForecastBalanceDto {
    if (accounts.length === 0) {
      return {
        status: 'insufficient_data',
        reason: 'no_accounts',
        currentBalance: null,
        remainingIncome: null,
        remainingExpense: null,
        projectedBalance: null,
        accountsIncluded: 0,
        accountsArchived: 0,
        transfersNetted: true,
      };
    }

    const accountIds = new Set(accounts.map((account) => account.id));
    let balance = accounts.reduce((total, account) => total + Number(account.initialBalance), 0);
    for (const row of balanceRows) {
      if (!accountIds.has(row.accountId)) continue;
      const amount = Number(row._sum.amount ?? 0);
      if (row.type === 'INCOME') balance += amount;
      else if (row.type === 'EXPENSE') balance -= amount;
      else if (row.type === 'TRANSFER') {
        balance += row.transferDirection === 'IN' ? amount : -amount;
      }
    }

    const currentBalance = money(balance);
    const accountsArchived = accounts.filter((account) => account.isArchived).length;

    if (input.status !== 'ok') {
      return {
        status: 'insufficient_data',
        reason: 'missing_series',
        currentBalance,
        remainingIncome: null,
        remainingExpense: null,
        projectedBalance: null,
        accountsIncluded: accounts.length,
        accountsArchived,
        transfersNetted: true,
      };
    }

    const remainingIncome = input.income.remainingCurrentMonth ?? 0;
    const remainingExpense = input.expense.remainingCurrentMonth ?? 0;
    return {
      status: 'ok',
      reason: null,
      currentBalance,
      remainingIncome: money(remainingIncome),
      remainingExpense: money(remainingExpense),
      projectedBalance: money(balance + remainingIncome - remainingExpense),
      accountsIncluded: accounts.length,
      accountsArchived,
      transfersNetted: true,
    };
  }

  private categoryForecasts(
    historyRows: ForecastRow[],
    currentRows: ForecastRow[],
    timezone: string,
    windowMonths: string[],
    engineTargets: string[],
    horizonMonthsList: string[],
    horizon: ForecastHorizon,
    currentMonth: string,
  ): ForecastCategoryDto[] {
    const groups = new Map<string, { name: string; rows: ForecastRow[] }>();
    for (const row of historyRows) {
      if (row.type !== 'EXPENSE') continue;
      const id = row.categoryId ?? 'uncategorised';
      const existing = groups.get(id);
      if (existing) existing.rows.push(row);
      else groups.set(id, { name: row.category?.name ?? 'Không phân loại', rows: [row] });
    }

    const candidates = [...groups.entries()]
      .map(([id, group]) => {
        const actuals = bucketByMonth(
          group.rows.map((row) => ({
            occurredAt: row.occurredAt,
            type: 'EXPENSE' as const,
            amount: row.amount.toFixed(2),
          })),
          timezone,
          windowMonths,
        );
        return {
          id,
          name: group.name,
          actuals,
          monthsWithData: actuals.filter((month) => month.hasTransactions).length,
          total: sum(actuals.map((month) => month.expense)),
        };
      })
      .filter((candidate) => candidate.monthsWithData >= 3)
      .sort((left, right) => right.total - left.total)
      .slice(0, CATEGORY_FORECAST_LIMIT);

    return candidates.map((candidate) => {
      const engine = forecastSeries(
        candidate.actuals,
        'expense',
        engineTargets,
        windowMonths.length,
      );
      const full = new Map(engine.months.map((month) => [month.month, month.amount]));
      const categoryMonthToDate = sum(
        currentRows
          .filter(
            (row) => row.type === 'EXPENSE' && (row.categoryId ?? 'uncategorised') === candidate.id,
          )
          .map((row) => Number(row.amount)),
      );
      const months =
        engine.status === 'ok'
          ? this.projectMonths({
              full,
              fullTargets: horizonMonthsList,
              monthToDate: categoryMonthToDate,
              partialMonth: horizon === 'current_month' ? currentMonth : null,
            })
          : [];
      const horizonTotal =
        engine.status === 'ok' ? sum(months.map((month) => Number(month.amount))) : null;

      return {
        categoryId: candidate.id === 'uncategorised' ? null : candidate.id,
        categoryName: candidate.name,
        status: engine.status,
        reason: engine.reason,
        model: engine.model,
        confidence: engine.confidence.level,
        monthsWithData: engine.monthsWithData,
        monthlyAverage: money(engine.monthlyAverage),
        months,
        horizonTotal: money(horizonTotal),
      };
    });
  }

  private dataQuality(actuals: MonthActual[], transactionCount: number): ForecastDataQualityDto {
    const monthsWithData = actuals.filter((month) => month.hasTransactions).length;
    const completeMonthsConsidered = actuals.length;
    const continuityPercent =
      completeMonthsConsidered > 0
        ? Math.round((monthsWithData / completeMonthsConsidered) * 100)
        : 0;
    return {
      completeMonthsConsidered,
      monthsWithData,
      missingMonths: actuals.filter((month) => !month.hasTransactions).map((month) => month.month),
      transactionCount,
      continuityPercent,
      level:
        monthsWithData >= 6 && continuityPercent >= 60
          ? 'good'
          : monthsWithData >= 3
            ? 'limited'
            : 'insufficient',
    };
  }

  private async context(userId: string): Promise<{ timezone: string; defaultCurrency: string }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { timezone: true, defaultCurrency: true },
    });
    const timezone = user && isValidTimezone(user.timezone) ? user.timezone : FALLBACK_TIMEZONE;
    return { timezone, defaultCurrency: user?.defaultCurrency ?? DEFAULT_CURRENCY };
  }

  /**
   * A cheap snapshot of everything the forecast depends on. Any create, edit or
   * delete of a transaction or account changes it, so cached forecasts cannot go
   * stale without touching the M2 write paths.
   */
  private async fingerprint(userId: string): Promise<string> {
    const [transactions, accounts] = await Promise.all([
      this.prisma.transaction.aggregate({
        where: { userId },
        _count: true,
        _max: { updatedAt: true },
      }),
      this.prisma.account.aggregate({
        where: { userId },
        _count: true,
        _max: { updatedAt: true },
        _sum: { initialBalance: true },
      }),
    ]);
    return [
      transactions._count,
      transactions._max.updatedAt?.getTime() ?? 0,
      accounts._count,
      accounts._max.updatedAt?.getTime() ?? 0,
      accounts._sum.initialBalance?.toFixed(2) ?? '0',
    ].join(':');
  }
}
