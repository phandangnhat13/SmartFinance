import { Prisma } from '@prisma/client';
import type { PrismaService } from '../../common/prisma/prisma.service';
import type { InsightsService } from './insights.service';
import { SavingsRecommendationService } from './savings-recommendation.service';

function createPrismaMock() {
  return {
    user: {
      findUnique: jest.fn().mockResolvedValue({
        timezone: 'Asia/Ho_Chi_Minh',
        defaultCurrency: 'VND',
      }),
    },
    savingsGoal: { findMany: jest.fn().mockResolvedValue([]) },
  };
}

type PrismaMock = ReturnType<typeof createPrismaMock>;

interface MonthlyRow {
  month: string;
  monthStatus: 'complete' | 'in_progress';
  income: string;
  expense: string;
  net: string;
  savingsRate: number | null;
  transactionCount: number;
  hasTransactions: boolean;
}

function activeMonths(): MonthlyRow[] {
  return [
    {
      month: '2026-09',
      monthStatus: 'complete' as const,
      income: '10000000.00',
      expense: '4000000.00',
      net: '6000000.00',
      savingsRate: 60,
      transactionCount: 4,
      hasTransactions: true,
    },
  ];
}

function createInsightsMock(months: MonthlyRow[] = activeMonths()) {
  return {
    monthly: jest.fn().mockResolvedValue({
      currency: 'VND',
      timezone: 'Asia/Ho_Chi_Minh',
      estimated: false,
      months,
    }),
  };
}

type InsightsMock = ReturnType<typeof createInsightsMock>;

function createService(prisma: PrismaMock, insights: InsightsMock): SavingsRecommendationService {
  return new SavingsRecommendationService(
    prisma as unknown as PrismaService,
    insights as unknown as InsightsService,
  );
}

interface ContributionRow {
  id: string;
  goalId: string;
  userId: string;
  amount: Prisma.Decimal;
  contributedAt: Date;
  note: string | null;
  createdAt: Date;
}

function contributionRow(amount: string, goalId = 'goal-1'): ContributionRow {
  return {
    id: `contribution-${amount}`,
    goalId,
    userId: 'user-1',
    amount: new Prisma.Decimal(amount),
    contributedAt: new Date('2026-10-15T00:00:00.000Z'),
    note: null,
    createdAt: new Date('2026-10-15T00:00:00.000Z'),
  };
}

interface GoalRowOverrides {
  id?: string;
  name?: string;
  currency?: string;
  status?: 'ACTIVE' | 'COMPLETED' | 'ARCHIVED' | 'PAUSED';
  targetAmount?: string;
  targetDate?: Date | null;
  createdAt?: Date;
  contributions?: ContributionRow[];
}

function goalRow(overrides: GoalRowOverrides = {}) {
  return {
    id: overrides.id ?? 'goal-1',
    userId: 'user-1',
    name: overrides.name ?? 'Mua laptop',
    description: null,
    targetAmount: new Prisma.Decimal(overrides.targetAmount ?? '30000000.00'),
    currency: overrides.currency ?? 'VND',
    startDate: new Date('2026-10-01T00:00:00.000Z'),
    targetDate:
      overrides.targetDate === undefined
        ? new Date('2027-06-30T00:00:00.000Z')
        : overrides.targetDate,
    status: overrides.status ?? 'ACTIVE',
    createdAt: overrides.createdAt ?? new Date('2026-10-01T00:00:00.000Z'),
    updatedAt: new Date('2026-10-01T00:00:00.000Z'),
    contributions: overrides.contributions ?? [contributionRow('6000000.00')],
  };
}

describe('SavingsRecommendationService', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-10-30T03:00:00.000Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('analyses the previous six complete months of the signed-in user in one currency', async () => {
    const prisma = createPrismaMock();
    prisma.savingsGoal.findMany.mockResolvedValue([goalRow()]);
    const insights = createInsightsMock();

    const result = await createService(prisma, insights).recommend('user-1', {});

    expect(insights.monthly).toHaveBeenCalledWith('user-1', {
      month: '2026-09',
      months: 6,
      currency: 'VND',
    });
    expect(prisma.savingsGoal.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'user-1', currency: 'VND' } }),
    );
    expect(result).toMatchObject({
      currency: 'VND',
      timezone: 'Asia/Ho_Chi_Minh',
      status: 'available',
      simulated: false,
      simulatedMonthlySaving: null,
      monthlyBudget: '4800000.00',
      allocatedMonthly: '3000000.00',
      unallocatedMonthly: '1800000.00',
    });
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      goalId: 'goal-1',
      recommendedMonthlySaving: '3000000.00',
      feasibility: 'ON_TRACK',
      priority: 1,
    });
  });

  it('honours the requested currency', async () => {
    const prisma = createPrismaMock();
    const insights = createInsightsMock();

    const result = await createService(prisma, insights).recommend('user-1', {
      currency: 'usd',
    });

    expect(result.currency).toBe('USD');
    expect(insights.monthly).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ currency: 'USD' }),
    );
    expect(prisma.savingsGoal.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'user-1', currency: 'USD' } }),
    );
  });

  it('never allocates to paused, completed or archived goals', async () => {
    const prisma = createPrismaMock();
    prisma.savingsGoal.findMany.mockResolvedValue([
      goalRow({ id: 'active', name: 'Đang thực hiện' }),
      goalRow({ id: 'paused', name: 'Tạm dừng', status: 'PAUSED' }),
      goalRow({ id: 'completed', name: 'Hoàn thành', status: 'COMPLETED' }),
      goalRow({ id: 'archived', name: 'Lưu trữ', status: 'ARCHIVED' }),
    ]);
    const insights = createInsightsMock();

    const result = await createService(prisma, insights).recommend('user-1', {});

    expect(result.items.map((item) => item.goalId)).toEqual(['active']);
    expect(result.excluded).toEqual({ paused: 1, completed: 1, archived: 1 });
  });

  it('returns insufficient_data and no budget instead of inventing a capacity', async () => {
    const prisma = createPrismaMock();
    prisma.savingsGoal.findMany.mockResolvedValue([goalRow()]);
    const insights = createInsightsMock([
      {
        month: '2026-09',
        monthStatus: 'complete',
        income: '0.00',
        expense: '0.00',
        net: '0.00',
        savingsRate: null,
        transactionCount: 0,
        hasTransactions: false,
      },
    ]);

    const result = await createService(prisma, insights).recommend('user-1', {});

    expect(result).toMatchObject({
      status: 'insufficient_data',
      monthlyBudget: null,
      unallocatedMonthly: null,
      allocatedMonthly: '0.00',
    });
    expect(result.capacity.reason).toBe('no_complete_months');
    expect(result.items[0].feasibility).toBe('INSUFFICIENT_DATA');
    expect(result.items[0].recommendedMonthlySaving).toBeNull();
    expect(result.limitations.join(' ')).toContain('độ tin cậy thấp');
  });

  it('treats a negative average cash flow as no capacity, not a zero expense month', async () => {
    const prisma = createPrismaMock();
    prisma.savingsGoal.findMany.mockResolvedValue([goalRow()]);
    const insights = createInsightsMock([
      {
        month: '2026-09',
        monthStatus: 'complete',
        income: '5000000.00',
        expense: '6000000.00',
        net: '-1000000.00',
        savingsRate: -20,
        transactionCount: 3,
        hasTransactions: true,
      },
    ]);

    const result = await createService(prisma, insights).recommend('user-1', {});

    expect(result.status).toBe('no_capacity');
    expect(result.capacity.suggestedMonthlySaving).toBe('0.00');
    expect(result.monthlyBudget).toBe('0.00');
    expect(result.items[0].feasibility).toBe('NOT_FEASIBLE');
  });

  it('simulates with a user-provided amount and never writes to the database', async () => {
    const prisma = createPrismaMock();
    prisma.savingsGoal.findMany.mockResolvedValue([goalRow()]);
    const insights = createInsightsMock();

    const result = await createService(prisma, insights).recommend('user-1', {
      assumedMonthlySaving: '2000000',
    });

    expect(result).toMatchObject({
      simulated: true,
      simulatedMonthlySaving: '2000000.00',
      monthlyBudget: '2000000.00',
      allocatedMonthly: '2000000.00',
      unallocatedMonthly: '0.00',
    });
    expect(result.items[0]).toMatchObject({
      recommendedMonthlySaving: '2000000.00',
      feasibility: 'AT_RISK',
    });
    // The measured capacity is still reported unchanged.
    expect(result.capacity.suggestedMonthlySaving).toBe('4800000.00');
    // Only reads were available on the mock; any write would have thrown.
    expect(prisma.savingsGoal).not.toHaveProperty('update');
  });

  it('lists an ACTIVE goal without a deadline and finances it from the budget', async () => {
    const prisma = createPrismaMock();
    prisma.savingsGoal.findMany.mockResolvedValue([goalRow({ targetDate: null })]);
    const insights = createInsightsMock();

    const result = await createService(prisma, insights).recommend('user-1', {});

    expect(result.items[0]).toMatchObject({
      targetDate: null,
      monthsRemaining: null,
      requiredMonthlySaving: null,
      feasibility: 'ON_TRACK',
      recommendedMonthlySaving: '4800000.00',
    });
  });
});
