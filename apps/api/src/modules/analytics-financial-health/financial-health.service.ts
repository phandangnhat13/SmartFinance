import { Injectable } from '@nestjs/common';
import type {
  FinancialHealthBreakdownDto,
  FinancialHealthDataQualityDto,
  FinancialHealthDto,
  FinancialHealthHistoryDto,
  FinancialHealthHistoryPointDto,
  FinancialHealthOverallDto,
  HealthGroupDto,
  HealthRecommendationDto,
} from '@smart-finance/shared-types';
import { DateTime } from 'luxon';
import { PrismaService } from '../../common/prisma/prisma.service';
import { isValidTimezone } from '../../common/utils/period';
import { AnalyticsForecastService } from '../analytics-forecast/analytics-forecast.service';
import { CategoryBudgetAnalyticsService } from '../analytics-category-budget/category-budget-analytics.service';
import { InsightsService } from '../insights/insights.service';
import { SavingsProgressService } from '../savings/savings-progress.service';
import type {
  FinancialHealthQuery,
  FinancialHealthHistoryQuery,
} from './dto/financial-health.query';
import {
  HEALTH_GROUP_ORDER,
  HEALTH_WEIGHTS,
  buildHealthRecommendations,
  combineHealthGroups,
  scoreBudget,
  scoreCashFlow,
  scoreForecastRisk,
  scoreSavings,
  scoreStability,
  toHealthGroup,
  type BudgetHealthInput,
  type CashFlowInput,
  type ForecastRiskInput,
  type HealthMonthPoint,
  type SavingsHealthInput,
  type StabilityInput,
} from './financial-health-engine';

const FALLBACK_TIMEZONE = 'Asia/Ho_Chi_Minh';
const DEFAULT_CURRENCY = 'VND';
/** Complete months analysed by the current score. */
const ANALYSIS_MONTHS = 12;
/** Default length of the recomputed history. */
const DEFAULT_HISTORY_MONTHS = 6;
export const MAX_HEALTH_HISTORY_MONTHS = 12;

interface HealthSnapshot {
  currency: string;
  timezone: string;
  asOf: string;
  generatedAt: string;
  overall: FinancialHealthOverallDto;
  groups: HealthGroupDto[];
  recommendations: HealthRecommendationDto[];
  dataQuality: FinancialHealthDataQualityDto;
}

/**
 * Financial health score (M3d).
 *
 * A read-only composition layer: cash flow, budgets, savings progress and the
 * M3c forecast are read from the services that already own those rules, then
 * scored by the pure engine. No transaction, balance, budget or goal is ever
 * written. Currency is never mixed and every month is bucketed in the user's
 * timezone by the underlying services.
 */
@Injectable()
export class FinancialHealthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly insights: InsightsService,
    private readonly budgets: CategoryBudgetAnalyticsService,
    private readonly savings: SavingsProgressService,
    private readonly forecast: AnalyticsForecastService,
  ) {}

  async health(userId: string, query: FinancialHealthQuery): Promise<FinancialHealthDto> {
    const snapshot = await this.snapshot(userId, query.currency);
    return {
      ...this.metadata(snapshot),
      overall: snapshot.overall,
      groups: snapshot.groups,
      recommendations: snapshot.recommendations,
      historyAvailable: false,
    };
  }

  async breakdown(
    userId: string,
    query: FinancialHealthQuery,
  ): Promise<FinancialHealthBreakdownDto> {
    const snapshot = await this.snapshot(userId, query.currency);
    return {
      ...this.metadata(snapshot),
      overall: snapshot.overall,
      groups: snapshot.groups,
      contributions: snapshot.groups
        .filter((group) => group.status === 'scored' && group.score !== null)
        .map((group) => ({
          group: group.key,
          score: group.score as number,
          weight: group.weight,
          contribution: group.contribution as number,
        })),
      availableWeight: snapshot.overall.availableWeight,
      missingGroups: snapshot.groups
        .filter((group) => group.status !== 'scored')
        .map((group) => ({
          group: group.key,
          reason: group.missingData.join(' ') || group.explanation,
        })),
      recommendations: snapshot.recommendations,
    };
  }

  /**
   * Recomputes the cash-flow and budget groups for the last N complete months.
   * The other three groups need data that only exists "now" (live forecast,
   * current goal status), so they are excluded rather than guessed; the history
   * therefore has no total score. Persisting full snapshots would need a table
   * and a migration, which is deliberately out of scope for M3d.
   */
  async history(
    userId: string,
    query: FinancialHealthHistoryQuery,
  ): Promise<FinancialHealthHistoryDto> {
    const { timezone, defaultCurrency } = await this.context(userId);
    const currency = (query.currency ?? defaultCurrency).toUpperCase() || DEFAULT_CURRENCY;
    const wanted = query.months ?? DEFAULT_HISTORY_MONTHS;
    const now = DateTime.now().setZone(timezone);
    const previousMonth = now.minus({ months: 1 }).toFormat('yyyy-MM');

    const monthly = await this.insights.monthly(userId, {
      months: wanted + ANALYSIS_MONTHS - 1,
      month: previousMonth,
      currency,
    });
    const points = monthly.months;
    const start = Math.max(0, points.length - wanted);
    const targets = points.slice(start);

    const budgetMonths = await Promise.all(
      targets.map((point) => this.budgets.budgets(userId, { currency, month: point.month })),
    );

    const months: FinancialHealthHistoryPointDto[] = targets.map((point, index) => {
      const pointIndex = start + index;
      const window = points.slice(Math.max(0, pointIndex - (ANALYSIS_MONTHS - 1)), pointIndex + 1);
      const healthMonths = this.toHealthMonths(window);
      const budgetDto = budgetMonths[index];
      const cashFlow = toHealthGroup(
        'cash-flow',
        scoreCashFlow({ months: healthMonths }, currency),
      );
      const budget = toHealthGroup('budget', scoreBudget(this.toBudgetInput(budgetDto, currency)));

      return {
        month: point.month,
        income: point.income,
        expense: point.expense,
        net: point.net,
        savingsRate: point.savingsRate,
        hasTransactions: point.hasTransactions,
        cashFlow,
        budget,
      };
    });

    return {
      currency,
      timezone,
      asOf: now.toISODate()!,
      generatedAt: new Date().toISOString(),
      method: 'recomputed',
      months,
      availableGroups: ['cash-flow', 'budget'],
      overall: null,
      limitations: [
        'Lịch sử được tính lại từ dữ liệu đã lưu, không phải ảnh chụp được lưu tự động.',
        'Chỉ nhóm Dòng tiền và Ngân sách tái tạo được cho từng tháng; Sức khỏe tiết kiệm, Ổn định tài chính và Rủi ro dự báo chỉ có ở ảnh chụp hiện tại.',
        'Vì vậy lịch sử không có điểm tổng và không thể so sánh trực tiếp với điểm hiện tại.',
        'Điểm của tháng cũ dùng ngân sách của tháng đó nhưng trạng thái mục tiêu/ngân sách được đọc tại thời điểm hiện tại.',
      ],
    };
  }

  /* -------------------------------- internals -------------------------------- */

  private async snapshot(
    userId: string,
    requestedCurrency: string | undefined,
  ): Promise<HealthSnapshot> {
    const { timezone, defaultCurrency } = await this.context(userId);
    const currency = (requestedCurrency ?? defaultCurrency).toUpperCase() || DEFAULT_CURRENCY;
    const now = DateTime.now().setZone(timezone);
    const previousMonth = now.minus({ months: 1 }).toFormat('yyyy-MM');

    const [monthly, budgetDto, savingsDto, forecastDto] = await Promise.all([
      this.insights.monthly(userId, {
        months: ANALYSIS_MONTHS,
        month: previousMonth,
        currency,
      }),
      this.budgets.budgets(userId, { currency }),
      this.savings.progress(userId, { currency }),
      this.forecast.forecast(userId, { currency, horizon: 'current_month' }),
    ]);

    const healthMonths = this.toHealthMonths(monthly.months);
    const cashFlowInput: CashFlowInput = { months: healthMonths };
    const budgetInput = this.toBudgetInput(budgetDto, currency);
    const savingsInput: SavingsHealthInput = {
      currency,
      goals: savingsDto.goals.map((goal) => ({
        goalId: goal.goalId,
        name: goal.name,
        progressStatus: goal.progressStatus,
        requiredMonthlySaving:
          goal.requiredMonthlySaving === null ? null : Number(goal.requiredMonthlySaving),
        remainingAmount: Number(goal.remainingAmount),
      })),
      archived: savingsDto.excluded.archived,
    };
    const stabilityInput: StabilityInput = {
      currency,
      currentBalance:
        forecastDto.monthEndBalance.currentBalance === null
          ? null
          : Number(forecastDto.monthEndBalance.currentBalance),
      accountsIncluded: forecastDto.monthEndBalance.accountsIncluded,
      months: healthMonths,
    };
    const forecastInput: ForecastRiskInput = {
      currency,
      status: forecastDto.status,
      reason: forecastDto.reason,
      income: {
        confidenceScore: forecastDto.income.confidence.score,
        confidenceLevel: forecastDto.income.confidence.level,
        model: forecastDto.income.model,
        monthsWithData: forecastDto.income.monthsWithData,
      },
      expense: {
        confidenceScore: forecastDto.expense.confidence.score,
        confidenceLevel: forecastDto.expense.confidence.level,
        model: forecastDto.expense.model,
        monthsWithData: forecastDto.expense.monthsWithData,
      },
      net: {
        status: forecastDto.net.status,
        base: this.optionalNumber(forecastDto.net.base),
        best: this.optionalNumber(forecastDto.net.best),
        worst: this.optionalNumber(forecastDto.net.worst),
      },
      balance: {
        status: forecastDto.monthEndBalance.status,
        currentBalance: this.optionalNumber(forecastDto.monthEndBalance.currentBalance),
        projectedBalance: this.optionalNumber(forecastDto.monthEndBalance.projectedBalance),
      },
    };

    const groups = [
      toHealthGroup('cash-flow', scoreCashFlow(cashFlowInput, currency)),
      toHealthGroup('budget', scoreBudget(budgetInput)),
      toHealthGroup('savings', scoreSavings(savingsInput)),
      toHealthGroup('stability', scoreStability(stabilityInput)),
      toHealthGroup('forecast-risk', scoreForecastRisk(forecastInput)),
    ].sort(
      (left, right) => HEALTH_GROUP_ORDER.indexOf(left.key) - HEALTH_GROUP_ORDER.indexOf(right.key),
    );

    const overall = combineHealthGroups(groups);
    const recommendations = buildHealthRecommendations({
      currency,
      groups,
      cashFlow: cashFlowInput,
      budgets: budgetInput,
      savings: savingsInput,
      stability: stabilityInput,
      forecast: forecastInput,
    });

    const monthsWithData = healthMonths.filter((month) => month.hasTransactions).length;
    const transactionCount = monthly.months.reduce((sum, month) => sum + month.transactionCount, 0);
    const dataQuality = {
      level:
        monthsWithData >= 6
          ? ('good' as const)
          : monthsWithData >= 3
            ? ('limited' as const)
            : ('insufficient' as const),
      monthsWithData,
      completeMonthsConsidered: healthMonths.length,
      transactionCount,
      scoredGroups: groups.filter((group) => group.status === 'scored').length,
      totalGroups: groups.length,
    };

    return {
      currency,
      timezone,
      asOf: now.toISODate()!,
      generatedAt: new Date().toISOString(),
      overall,
      groups,
      recommendations,
      dataQuality,
    };
  }

  private metadata(snapshot: HealthSnapshot) {
    return {
      currency: snapshot.currency,
      timezone: snapshot.timezone,
      asOf: snapshot.asOf,
      generatedAt: snapshot.generatedAt,
      estimated: true as const,
      formula:
        'Điểm tổng = Σ(điểm nhóm × trọng số) ÷ Σ(trọng số của các nhóm có dữ liệu). ' +
        'Trọng số: Dòng tiền 25%, Ngân sách 20%, Tiết kiệm 20%, Ổn định 20%, Rủi ro dự báo 15%. ' +
        'Chỉ tính điểm tổng khi có ít nhất 3 nhóm có dữ liệu và ít nhất 60% trọng số khả dụng.',
      scoringRules: [
        `Dòng tiền: tỷ lệ tiết kiệm 30%/20%/10%/0% lần lượt được 50/42/32/20 điểm (âm: 0); tháng không âm tối đa 30 điểm; biến động thu nhập tối đa 20 điểm.`,
        'Ngân sách: vượt hạn mức 0 điểm, gần hạn mức 50 điểm, còn lại 100 điểm; lấy trung bình các ngân sách trong tháng.',
        'Tiết kiệm: đúng tiến độ/hoàn thành 100 điểm, chậm tiến độ 50 điểm, quá hạn 0 điểm; mục tiêu tạm dừng và chưa đủ dữ liệu bị loại.',
        'Ổn định: quỹ dự phòng ≥ 6 tháng 100 điểm, ≥ 3 tháng 80, ≥ 1 tháng 55, > 0 30, ≤ 0 0.',
        'Rủi ro dự báo: trung bình điểm tin cậy của dự báo thu và chi, trừ 25 điểm nếu dòng tiền ròng dự báo âm và 25 điểm nếu số dư cuối tháng dự kiến âm.',
        'Xếp loại: Xuất sắc ≥ 85, Tốt ≥ 70, Trung bình ≥ 50, Cần cải thiện < 50; Chưa đủ dữ liệu khi không tính được điểm tổng.',
      ],
      dataQuality: snapshot.dataQuality,
      assumptions: [
        'Chỉ dùng dữ liệu người dùng đã ghi; không tạo, sửa hoặc xóa giao dịch.',
        'Tháng không có giao dịch bị loại khỏi mẫu thay vì tính là 0.',
        'Mỗi loại tiền được chấm riêng; không quy đổi tỷ giá.',
        'Đây là chỉ báo nội bộ theo quy tắc công khai, không phải điểm tín dụng hay quyết định cho vay.',
      ],
      limitations: [
        'Không có dữ liệu tài sản hoặc khoản nợ ngoài hệ thống.',
        'Mục tiêu tiết kiệm phản ánh các khoản góp đã ghi nhận.',
        'Dự báo là thống kê từ quá khứ, không bảo đảm kết quả tương lai.',
        'Điểm thay đổi khi dữ liệu thay đổi và không được lưu lịch sử tự động.',
        'Nhóm thiếu dữ liệu không bao giờ được tính là 0 điểm.',
      ],
    };
  }

  private toHealthMonths(
    months: Array<{
      month: string;
      income: string;
      expense: string;
      hasTransactions: boolean;
    }>,
  ): HealthMonthPoint[] {
    return months.map((month) => ({
      month: month.month,
      income: Number(month.income),
      expense: Number(month.expense),
      hasTransactions: month.hasTransactions,
    }));
  }

  private toBudgetInput(
    budgets: Awaited<ReturnType<CategoryBudgetAnalyticsService['budgets']>>,
    currency: string,
  ): BudgetHealthInput {
    return {
      month: budgets.month,
      currency,
      items: budgets.items.map((item) => ({
        id: item.id,
        name: item.name,
        status: item.status,
        limit: Number(item.limitAmount),
        spent: Number(item.spent),
        usagePercent: item.usagePercent,
      })),
    };
  }

  private optionalNumber(value: string | null): number | null {
    return value === null ? null : Number(value);
  }

  private async context(userId: string): Promise<{ timezone: string; defaultCurrency: string }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { timezone: true, defaultCurrency: true },
    });
    const timezone = user && isValidTimezone(user.timezone) ? user.timezone : FALLBACK_TIMEZONE;
    return { timezone, defaultCurrency: user?.defaultCurrency ?? DEFAULT_CURRENCY };
  }
}

/** Exposed for the UI copy and tests; the five weights always sum to 100. */
export const HEALTH_WEIGHT_TOTAL = Object.values(HEALTH_WEIGHTS).reduce(
  (sum, weight) => sum + weight,
  0,
);
