import { Injectable } from '@nestjs/common';
import type { SavingsCapacityDto, SavingsRecommendationsDto } from '@smart-finance/shared-types';
import { Prisma } from '@prisma/client';
import { DateTime } from 'luxon';
import { PrismaService } from '../../common/prisma/prisma.service';
import { moneyString, toDecimal } from '../../common/utils/money';
import { isValidTimezone } from '../../common/utils/period';
import { toGoalDto } from '../goals/goal.mapper';
import { SavingsRecommendationQuery } from './dto/insights.query';
import { InsightsService } from './insights.service';
import {
  buildRecommendations,
  computeCapacity,
  MAX_ANALYSIS_MONTHS,
  SAFETY_BUFFER_PERCENT,
  sumRecommended,
  type RecommendationGoalInput,
} from './savings-recommendation';

const DEFAULT_TIMEZONE = 'Asia/Ho_Chi_Minh';
const DEFAULT_CURRENCY = 'VND';

/**
 * Turns the user's own cash-flow history and their ACTIVE goals into a
 * rule-based monthly saving plan.
 *
 * Read-only by design: no recommendation is persisted, no goal status changes
 * and no contribution is recorded. The user confirms every real contribution
 * through the goals API.
 */
@Injectable()
export class SavingsRecommendationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly insights: InsightsService,
  ) {}

  async recommend(
    userId: string,
    query: SavingsRecommendationQuery,
  ): Promise<SavingsRecommendationsDto> {
    const { currency, timezone, today, capacity } = await this.capacityFor(userId, query.currency);

    const goals = await this.prisma.savingsGoal.findMany({
      where: { userId, currency },
      include: { contributions: { orderBy: { contributedAt: 'desc' } } },
      orderBy: { createdAt: 'asc' },
    });

    const excluded = { paused: 0, completed: 0, archived: 0 };
    const activeGoals: RecommendationGoalInput[] = [];
    goals.forEach((goal) => {
      const dto = toGoalDto(goal, { timezone, today });
      if (dto.status !== 'ACTIVE') {
        if (dto.status === 'PAUSED') excluded.paused += 1;
        else if (dto.status === 'COMPLETED') excluded.completed += 1;
        else excluded.archived += 1;
        return;
      }
      activeGoals.push({
        id: dto.id,
        name: dto.name,
        currency: dto.currency,
        displayStatus: dto.displayStatus,
        targetDate: dto.targetDate,
        monthsRemaining: dto.monthsRemaining,
        remaining: toDecimal(dto.remainingAmount),
        requiredMonthly:
          dto.requiredMonthlySaving === null ? null : toDecimal(dto.requiredMonthlySaving),
        createdAt: goal.createdAt,
      });
    });

    const assumed = query.assumedMonthlySaving;
    const budget = this.resolveBudget(assumed, capacity.suggestedMonthlySaving, capacity.status);
    const items = buildRecommendations(activeGoals, { budget, today });
    const allocated = sumRecommended(items);
    const leftover = budget === null ? null : budget.minus(allocated);

    return {
      currency,
      timezone,
      generatedAt: new Date().toISOString(),
      status: capacity.status,
      capacity,
      monthlyBudget: budget === null ? null : moneyString(budget),
      simulated: assumed !== undefined,
      simulatedMonthlySaving: assumed === undefined ? null : moneyString(toDecimal(assumed)),
      items,
      allocatedMonthly: moneyString(allocated),
      unallocatedMonthly: leftover === null ? null : moneyString(leftover),
      excluded,
      assumptions: this.assumptions(),
      limitations: this.limitations(capacity.confidence, assumed !== undefined),
    };
  }

  /**
   * The measured capacity alone, for callers that need the reference without a
   * goal allocation (the M2d plan simulator). Uses exactly the same window and
   * arithmetic as `recommend`.
   */
  async capacityFor(
    userId: string,
    requestedCurrency?: string,
  ): Promise<{
    currency: string;
    timezone: string;
    today: string;
    capacity: SavingsCapacityDto;
  }> {
    const { timezone, defaultCurrency } = await this.getContext(userId);
    const currency = (requestedCurrency ?? defaultCurrency).toUpperCase();
    const now = DateTime.now().setZone(timezone);
    const today = now.toFormat('yyyy-MM-dd');

    // The current month is still running, so it is excluded: averages only use
    // the completed months that actually have transactions.
    const monthly = await this.insights.monthly(userId, {
      month: now.minus({ months: 1 }).toFormat('yyyy-MM'),
      months: MAX_ANALYSIS_MONTHS,
      currency,
    });
    return { currency, timezone, today, capacity: computeCapacity(monthly.months, currency) };
  }

  private async getContext(userId: string): Promise<{ timezone: string; defaultCurrency: string }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { timezone: true, defaultCurrency: true },
    });
    const timezone = user && isValidTimezone(user.timezone) ? user.timezone : DEFAULT_TIMEZONE;
    return { timezone, defaultCurrency: user?.defaultCurrency ?? DEFAULT_CURRENCY };
  }

  /**
   * The simulation amount wins over the measured capacity; without it the
   * suggested capacity is used, and an unsupported history yields no budget at
   * all instead of an invented number.
   */
  private resolveBudget(
    assumed: string | undefined,
    suggested: string | null,
    status: SavingsRecommendationsDto['status'],
  ): Prisma.Decimal | null {
    if (assumed !== undefined) return toDecimal(assumed);
    if (status === 'available' && suggested !== null) return toDecimal(suggested);
    if (status === 'no_capacity') return new Prisma.Decimal(0);
    return null;
  }

  private assumptions(): string[] {
    return [
      `Phân tích tối đa ${MAX_ANALYSIS_MONTHS} tháng đã kết thúc gần nhất; tháng hiện tại đang diễn ra nên không được tính vào mức trung bình.`,
      'Chỉ những tháng có ít nhất một giao dịch được đưa vào trung bình; tháng không có dữ liệu không bị coi là tháng chi 0.',
      'Giao dịch chuyển tiền nội bộ (TRANSFER) không được tính là thu nhập hay chi tiêu.',
      `Khả năng tiết kiệm = dòng tiền ròng trung bình × (100% − ${SAFETY_BUFFER_PERCENT}%): ${SAFETY_BUFFER_PERCENT}% được giữ lại làm khoản dự phòng an toàn, không phân bổ cho mục tiêu.`,
      'Mỗi lần chỉ phân tích một loại tiền tệ; số tiền khác loại tiền không được cộng hoặc quy đổi.',
    ];
  }

  private limitations(
    confidence: SavingsRecommendationsDto['capacity']['confidence'],
    simulated: boolean,
  ): string[] {
    const items = [
      'Đây là ước tính từ dữ liệu đã ghi nhận, không phải cam kết bạn chắc chắn tiết kiệm được số tiền này.',
      'Chưa tính các nghĩa vụ sắp tới (nợ, hoá đơn định kỳ), lãi suất hay lạm phát.',
      'Thứ tự ưu tiên dựa trên hạn chót và thời điểm tạo mục tiêu; chưa có mức ưu tiên do người dùng tự chọn.',
      'Chỉ đề xuất cho mục tiêu đang thực hiện; mục tiêu tạm dừng, hoàn thành hoặc lưu trữ không được phân bổ.',
    ];
    if (confidence === 'low') {
      items.push('Dữ liệu hiện có ít hơn 3 tháng nên mức đề xuất có độ tin cậy thấp.');
    }
    if (simulated) {
      items.push(
        'Bạn đang xem mô phỏng với mức tiết kiệm tự nhập; hệ thống không ghi nhận khoản góp hay giao dịch nào.',
      );
    }
    return items;
  }
}
