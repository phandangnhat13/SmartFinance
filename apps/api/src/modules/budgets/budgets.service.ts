import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Budget, Category, Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { isPositiveMoney, moneyString, percentage, toDecimal } from '../../common/utils/money';
import { resolveMonthPeriod } from '../../common/utils/period';
import { CategoriesService } from '../categories/categories.service';
import { CreateBudgetDto, UpdateBudgetDto } from './dto/budget.dto';

type BudgetWithCategory = Budget & { category: Category | null };

@Injectable()
export class BudgetsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly categoriesService: CategoriesService,
  ) {}

  async list(userId: string, month?: string) {
    const timezone = await this.getTimezone(userId);
    const period = resolveMonthPeriod(month, timezone);
    const budgets = await this.prisma.budget.findMany({
      where: { userId, periodStart: period.periodStart },
      include: { category: true },
      orderBy: [{ categoryId: 'asc' }, { createdAt: 'asc' }],
    });
    return Promise.all(budgets.map((budget) => this.buildProgress(budget, timezone)));
  }

  async getProgress(userId: string, id: string) {
    const timezone = await this.getTimezone(userId);
    const budget = await this.getOwnedWithCategory(userId, id);
    return this.buildProgress(budget, timezone);
  }

  async create(userId: string, dto: CreateBudgetDto) {
    if (!isPositiveMoney(dto.limitAmount)) {
      throw new BadRequestException('Hạn mức phải lớn hơn 0');
    }
    const timezone = await this.getTimezone(userId);
    const period = resolveMonthPeriod(dto.month, timezone);

    if (dto.categoryId) {
      await this.categoriesService.getAccessibleOrThrow(userId, dto.categoryId, 'EXPENSE');
    }

    return this.prisma.budget.create({
      data: {
        userId,
        name: dto.name.trim(),
        categoryId: dto.categoryId ?? null,
        scopeKey: dto.categoryId ?? 'ALL',
        periodStart: period.periodStart,
        periodEnd: period.periodEnd,
        limitAmount: toDecimal(dto.limitAmount),
        warningThresholds: dto.warningThresholds ?? [80, 100],
      },
      include: { category: true },
    });
  }

  async update(userId: string, id: string, dto: UpdateBudgetDto) {
    await this.getOwnedWithCategory(userId, id);
    if (dto.limitAmount !== undefined && !isPositiveMoney(dto.limitAmount)) {
      throw new BadRequestException('Hạn mức phải lớn hơn 0');
    }
    return this.prisma.budget.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.limitAmount !== undefined ? { limitAmount: toDecimal(dto.limitAmount) } : {}),
        ...(dto.warningThresholds !== undefined
          ? { warningThresholds: [...dto.warningThresholds].sort((a, b) => a - b) }
          : {}),
      },
      include: { category: true },
    });
  }

  async remove(userId: string, id: string): Promise<void> {
    await this.getOwnedWithCategory(userId, id);
    await this.prisma.budget.delete({ where: { id } });
  }

  async buildProgress(budget: BudgetWithCategory, timezone: string) {
    const period = resolveMonthPeriod(budget.periodStart.toISOString().slice(0, 7), timezone);
    const where: Prisma.TransactionWhereInput = {
      userId: budget.userId,
      type: 'EXPENSE',
      occurredAt: { gte: period.start, lt: period.endExclusive },
      ...(budget.categoryId ? { categoryId: budget.categoryId } : {}),
    };
    const aggregate = await this.prisma.transaction.aggregate({
      where,
      _sum: { amount: true },
    });
    const spent = aggregate._sum.amount ?? new Prisma.Decimal(0);
    const limit = budget.limitAmount;
    const pct = percentage(spent, limit);
    const remaining = limit.minus(spent);

    const thresholds = [...budget.warningThresholds].sort((a, b) => a - b);
    const crossed = thresholds.filter((threshold) => pct >= threshold);
    if (crossed.length > 0) {
      // Unique (budgetId, threshold, periodStart) makes this idempotent: the
      // same threshold is recorded at most once per period.
      await this.prisma.budgetAlert.createMany({
        data: crossed.map((threshold) => ({
          budgetId: budget.id,
          threshold,
          periodStart: budget.periodStart,
        })),
        skipDuplicates: true,
      });
    }

    const status = pct >= 100 ? 'EXCEEDED' : crossed.length > 0 ? 'WARNING' : 'OK';
    return {
      id: budget.id,
      name: budget.name,
      categoryId: budget.categoryId,
      categoryName: budget.category?.name ?? null,
      periodStart: budget.periodStart.toISOString().slice(0, 10),
      periodEnd: budget.periodEnd.toISOString().slice(0, 10),
      limitAmount: moneyString(limit),
      spent: moneyString(spent),
      remaining: moneyString(remaining),
      percentage: pct,
      status,
      alerts: crossed.map((threshold) => ({
        threshold,
        message:
          threshold >= 100
            ? `Đã vượt ${threshold}% ngân sách "${budget.name}"`
            : `Đã dùng ${threshold}% ngân sách "${budget.name}"`,
      })),
    };
  }

  private async getOwnedWithCategory(userId: string, id: string): Promise<BudgetWithCategory> {
    const budget = await this.prisma.budget.findFirst({
      where: { id, userId },
      include: { category: true },
    });
    if (!budget) throw new NotFoundException('Không tìm thấy ngân sách');
    return budget;
  }

  async getTimezone(userId: string): Promise<string> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { timezone: true },
    });
    return user?.timezone ?? 'Asia/Ho_Chi_Minh';
  }
}
