import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { GoalContribution, SavingsGoal } from '@prisma/client';
import { Prisma } from '@prisma/client';
import type { GoalDto } from '@smart-finance/shared-types';
import { DateTime } from 'luxon';
import { PrismaService } from '../../common/prisma/prisma.service';
import { isPositiveMoney, moneyString, toDecimal } from '../../common/utils/money';
import { isValidTimezone } from '../../common/utils/period';
import type { GoalContext } from './goal.mapper';
import { goalStartDate, goalTargetDate, sumContributions, toGoalDto } from './goal.mapper';
import {
  CreateContributionDto,
  CreateGoalDto,
  UpdateContributionDto,
  UpdateGoalDto,
} from './dto/goal.dto';

const DEFAULT_TIMEZONE = 'Asia/Ho_Chi_Minh';
const DEFAULT_CURRENCY = 'VND';

type GoalWithContributions = SavingsGoal & { contributions: GoalContribution[] };
type Tx = Prisma.TransactionClient;

interface ServiceContext extends GoalContext {
  defaultCurrency: string;
}

const STATUS_PRIORITY: Record<GoalDto['displayStatus'], number> = {
  OVERDUE: 0,
  ACTIVE: 1,
  PAUSED: 2,
  COMPLETED: 3,
  ARCHIVED: 4,
};

@Injectable()
export class GoalsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    userId: string,
    options: { includeArchived?: boolean; currency?: string } = {},
  ): Promise<GoalDto[]> {
    const context = await this.getContext(userId);
    const goals = await this.prisma.savingsGoal.findMany({
      where: {
        userId,
        ...(options.includeArchived ? {} : { status: { not: 'ARCHIVED' } }),
        ...(options.currency ? { currency: options.currency } : {}),
      },
      include: { contributions: { orderBy: { contributedAt: 'desc' } } },
      orderBy: { createdAt: 'desc' },
    });
    return goals
      .map((goal) => toGoalDto(goal, context))
      .sort(
        (left, right) =>
          STATUS_PRIORITY[left.displayStatus] - STATUS_PRIORITY[right.displayStatus] ||
          (left.targetDate ?? '9999-12-31').localeCompare(right.targetDate ?? '9999-12-31') ||
          right.id.localeCompare(left.id),
      );
  }

  async get(userId: string, id: string): Promise<GoalDto> {
    const context = await this.getContext(userId);
    const goal = await this.getOwnedOrThrow(userId, id);
    return toGoalDto(goal, context);
  }

  async create(userId: string, dto: CreateGoalDto): Promise<GoalDto> {
    const context = await this.getContext(userId);
    if (!isPositiveMoney(dto.targetAmount)) {
      throw new BadRequestException('Số tiền mục tiêu phải lớn hơn 0');
    }
    const startDate = dto.startDate ?? context.today;
    if (dto.targetDate && dto.targetDate <= startDate) {
      throw new BadRequestException('Ngày đích phải sau ngày bắt đầu');
    }

    const goal = await this.prisma.savingsGoal.create({
      data: {
        userId,
        name: dto.name.trim(),
        description: dto.description?.trim() || null,
        targetAmount: toDecimal(dto.targetAmount),
        currency: dto.currency ?? context.defaultCurrency,
        startDate: this.parseDateOnly(startDate),
        targetDate: dto.targetDate ? this.parseDateOnly(dto.targetDate) : null,
      },
      include: { contributions: true },
    });
    return toGoalDto(goal, context);
  }

  async update(userId: string, id: string, dto: UpdateGoalDto): Promise<GoalDto> {
    const context = await this.getContext(userId);
    const goal = await this.getOwnedOrThrow(userId, id);
    if (goal.status === 'ARCHIVED') {
      throw new BadRequestException('Mục tiêu đã lưu trữ, không thể chỉnh sửa');
    }
    const saved = sumContributions(goal.contributions);
    const currentStart = goalStartDate(goal, context);
    const startDate = dto.startDate ?? currentStart;
    const targetDate = dto.targetDate ?? goalTargetDate(goal);

    if (targetDate && targetDate <= startDate) {
      throw new BadRequestException('Ngày đích phải sau ngày bắt đầu');
    }
    if (
      dto.startDate !== undefined &&
      dto.startDate !== currentStart &&
      goal.contributions.length > 0
    ) {
      throw new BadRequestException(
        'Không thể đổi ngày bắt đầu sau khi đã ghi nhận khoản góp tiền',
      );
    }

    let targetAmount: Prisma.Decimal | undefined;
    if (dto.targetAmount !== undefined) {
      if (!isPositiveMoney(dto.targetAmount)) {
        throw new BadRequestException('Số tiền mục tiêu phải lớn hơn 0');
      }
      targetAmount = toDecimal(dto.targetAmount);
      if (targetAmount.lessThan(saved)) {
        throw new BadRequestException('Số tiền mục tiêu không được thấp hơn số tiền đã tiết kiệm');
      }
    }

    if (dto.status !== undefined && dto.status !== goal.status) {
      this.assertStatusTransition(
        goal.status,
        dto.status,
        saved,
        targetAmount ?? goal.targetAmount,
      );
    }

    // A target change alone must keep COMPLETED in step with the saved total:
    // raising the target reopens the goal, lowering it to the saved total closes it.
    let status: SavingsGoal['status'] = dto.status ?? goal.status;
    if (dto.status === undefined) {
      const finalTarget = targetAmount ?? goal.targetAmount;
      if (status === 'ACTIVE' && saved.greaterThanOrEqualTo(finalTarget)) status = 'COMPLETED';
      else if (status === 'COMPLETED' && saved.lessThan(finalTarget)) status = 'ACTIVE';
    }

    const updated = await this.prisma.savingsGoal.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.description !== undefined ? { description: dto.description.trim() || null } : {}),
        ...(targetAmount !== undefined ? { targetAmount } : {}),
        ...(dto.startDate !== undefined ? { startDate: this.parseDateOnly(startDate) } : {}),
        ...(dto.targetDate !== undefined
          ? { targetDate: this.parseDateOnly(targetDate as string) }
          : {}),
        ...(status !== goal.status ? { status } : {}),
      },
      include: { contributions: { orderBy: { contributedAt: 'desc' } } },
    });
    return toGoalDto(updated, context);
  }

  async archive(userId: string, id: string): Promise<GoalDto> {
    const context = await this.getContext(userId);
    const goal = await this.getOwnedOrThrow(userId, id);
    if (goal.status === 'ARCHIVED') return toGoalDto(goal, context);
    const archived = await this.prisma.savingsGoal.update({
      where: { id },
      data: { status: 'ARCHIVED' },
      include: { contributions: { orderBy: { contributedAt: 'desc' } } },
    });
    return toGoalDto(archived, context);
  }

  async addContribution(
    userId: string,
    goalId: string,
    dto: CreateContributionDto,
  ): Promise<GoalDto> {
    const context = await this.getContext(userId);
    const updated = await this.prisma.$transaction(async (tx) => {
      const goal = await this.getOwnedOrThrow(userId, goalId, tx);
      if (goal.status !== 'ACTIVE') {
        throw new BadRequestException('Chỉ mục tiêu đang thực hiện mới có thể ghi nhận khoản góp');
      }
      if (!isPositiveMoney(dto.amount)) {
        throw new BadRequestException('Số tiền đóng góp phải lớn hơn 0');
      }
      const amount = toDecimal(dto.amount);
      const contributedAt = this.parseInstant(dto.contributedAt);
      this.assertContributionDate(contributedAt, goal, context);

      const saved = sumContributions(goal.contributions);
      this.assertWithinTarget(goal, saved, amount);

      await tx.goalContribution.create({
        data: {
          goalId,
          userId,
          amount,
          contributedAt,
          note: dto.note?.trim() || null,
        },
      });
      if (saved.plus(amount).greaterThanOrEqualTo(goal.targetAmount)) {
        await tx.savingsGoal.update({ where: { id: goalId }, data: { status: 'COMPLETED' } });
      }
      return this.getOwnedOrThrow(userId, goalId, tx);
    });
    return toGoalDto(updated, context);
  }

  async updateContribution(
    userId: string,
    goalId: string,
    contributionId: string,
    dto: UpdateContributionDto,
  ): Promise<GoalDto> {
    const context = await this.getContext(userId);
    const updated = await this.prisma.$transaction(async (tx) => {
      const goal = await this.getOwnedOrThrow(userId, goalId, tx);
      if (goal.status === 'ARCHIVED') {
        throw new BadRequestException('Mục tiêu đã lưu trữ, không thể sửa khoản góp');
      }
      const contribution = goal.contributions.find((item) => item.id === contributionId);
      if (!contribution) throw new NotFoundException('Không tìm thấy khoản góp');

      if (dto.amount !== undefined && !isPositiveMoney(dto.amount)) {
        throw new BadRequestException('Số tiền đóng góp phải lớn hơn 0');
      }
      const amount = dto.amount !== undefined ? toDecimal(dto.amount) : contribution.amount;
      const contributedAt =
        dto.contributedAt !== undefined
          ? this.parseInstant(dto.contributedAt)
          : contribution.contributedAt;
      this.assertContributionDate(contributedAt, goal, context);

      const otherSaved = sumContributions(
        goal.contributions.filter((item) => item.id !== contributionId),
      );
      this.assertWithinTarget(goal, otherSaved, amount);

      await tx.goalContribution.update({
        where: { id: contributionId },
        data: {
          amount,
          contributedAt,
          ...(dto.note !== undefined ? { note: dto.note.trim() || null } : {}),
        },
      });
      await this.syncCompletion(tx, goal, otherSaved.plus(amount));
      return this.getOwnedOrThrow(userId, goalId, tx);
    });
    return toGoalDto(updated, context);
  }

  async deleteContribution(
    userId: string,
    goalId: string,
    contributionId: string,
  ): Promise<GoalDto> {
    const context = await this.getContext(userId);
    const updated = await this.prisma.$transaction(async (tx) => {
      const goal = await this.getOwnedOrThrow(userId, goalId, tx);
      if (goal.status === 'ARCHIVED') {
        throw new BadRequestException('Mục tiêu đã lưu trữ, không thể xóa khoản góp');
      }
      const contribution = goal.contributions.find((item) => item.id === contributionId);
      if (!contribution) throw new NotFoundException('Không tìm thấy khoản góp');

      await tx.goalContribution.delete({ where: { id: contributionId } });
      const remainingSaved = sumContributions(
        goal.contributions.filter((item) => item.id !== contributionId),
      );
      await this.syncCompletion(tx, goal, remainingSaved);
      return this.getOwnedOrThrow(userId, goalId, tx);
    });
    return toGoalDto(updated, context);
  }

  private async getContext(userId: string): Promise<ServiceContext> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { timezone: true, defaultCurrency: true },
    });
    const timezone = user && isValidTimezone(user.timezone) ? user.timezone : DEFAULT_TIMEZONE;
    return {
      timezone,
      today: DateTime.now().setZone(timezone).toFormat('yyyy-MM-dd'),
      defaultCurrency: user?.defaultCurrency ?? DEFAULT_CURRENCY,
    };
  }

  private async getOwnedOrThrow(
    userId: string,
    id: string,
    client: PrismaService | Tx = this.prisma,
  ): Promise<GoalWithContributions> {
    const goal = await client.savingsGoal.findFirst({
      where: { id, userId },
      include: { contributions: { orderBy: { contributedAt: 'desc' } } },
    });
    if (!goal) throw new NotFoundException('Không tìm thấy mục tiêu tiết kiệm');
    return goal;
  }

  private parseDateOnly(value: string): Date {
    return new Date(`${value}T00:00:00.000Z`);
  }

  private parseInstant(value: string): Date {
    const instant = new Date(value);
    if (Number.isNaN(instant.getTime())) {
      throw new BadRequestException('Thời điểm đóng góp không hợp lệ');
    }
    return instant;
  }

  /**
   * Contributions represent money already set aside: never before the goal
   * started and never in the future (in the owner's timezone).
   */
  private assertContributionDate(
    contributedAt: Date,
    goal: SavingsGoal,
    context: GoalContext,
  ): void {
    const localDay = DateTime.fromJSDate(contributedAt, { zone: context.timezone }).toFormat(
      'yyyy-MM-dd',
    );
    if (localDay < goalStartDate(goal, context)) {
      throw new BadRequestException('Ngày góp không được trước ngày bắt đầu mục tiêu');
    }
    if (localDay > context.today) {
      throw new BadRequestException('Ngày góp không được ở tương lai');
    }
  }

  /** Overfunding is not supported: a contribution can never pass the target. */
  private assertWithinTarget(
    goal: SavingsGoal,
    saved: Prisma.Decimal,
    amount: Prisma.Decimal,
  ): void {
    const remaining = goal.targetAmount.minus(saved);
    if (remaining.lessThanOrEqualTo(0)) {
      throw new BadRequestException('Mục tiêu đã đạt số tiền cần thiết');
    }
    if (amount.greaterThan(remaining)) {
      throw new BadRequestException(`Số tiền vượt quá số còn thiếu (${moneyString(remaining)})`);
    }
  }

  /** Keeps COMPLETED in step with the actual total after an edit or delete. */
  private async syncCompletion(tx: Tx, goal: SavingsGoal, saved: Prisma.Decimal): Promise<void> {
    const reached = saved.greaterThanOrEqualTo(goal.targetAmount);
    if (reached && goal.status === 'ACTIVE') {
      await tx.savingsGoal.update({ where: { id: goal.id }, data: { status: 'COMPLETED' } });
    } else if (!reached && goal.status === 'COMPLETED') {
      await tx.savingsGoal.update({ where: { id: goal.id }, data: { status: 'ACTIVE' } });
    }
  }

  private assertStatusTransition(
    from: SavingsGoal['status'],
    to: SavingsGoal['status'],
    saved: Prisma.Decimal,
    targetAmount: Prisma.Decimal,
  ): void {
    if (from === 'ARCHIVED') {
      throw new BadRequestException('Mục tiêu đã lưu trữ không thể đổi trạng thái');
    }
    if (to === 'ACTIVE' && from === 'COMPLETED' && saved.greaterThanOrEqualTo(targetAmount)) {
      throw new BadRequestException(
        'Mục tiêu đã đạt số tiền cần thiết; hãy tăng số tiền mục tiêu trước khi tiếp tục',
      );
    }
    const allowed: Record<SavingsGoal['status'], SavingsGoal['status'][]> = {
      ACTIVE: ['PAUSED', 'COMPLETED', 'ARCHIVED'],
      PAUSED: ['ACTIVE', 'ARCHIVED'],
      COMPLETED: ['ACTIVE', 'ARCHIVED'],
      ARCHIVED: [],
    };
    if (!allowed[from].includes(to)) {
      throw new BadRequestException('Không thể chuyển mục tiêu sang trạng thái này');
    }
  }
}
