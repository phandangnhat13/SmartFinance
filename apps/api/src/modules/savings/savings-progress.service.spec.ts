import { NotFoundException } from '@nestjs/common';
import { Prisma, type GoalContribution, type SavingsGoal } from '@prisma/client';
import type { PrismaService } from '../../common/prisma/prisma.service';
import { SavingsProgressService } from './savings-progress.service';

type GoalRow = SavingsGoal & { contributions: GoalContribution[] };

function contribution(amount: string, contributedAt: string, goalId = 'goal-1'): GoalContribution {
  return {
    id: `contribution-${contributedAt}`,
    goalId,
    userId: 'user-1',
    amount: new Prisma.Decimal(amount),
    contributedAt: new Date(contributedAt),
    note: null,
    createdAt: new Date(contributedAt),
  };
}

function goalRow(overrides: Partial<GoalRow> = {}): GoalRow {
  return {
    id: 'goal-1',
    userId: 'user-1',
    name: 'Mua laptop',
    description: null,
    targetAmount: new Prisma.Decimal('12000000'),
    currency: 'VND',
    startDate: new Date('2026-01-01T00:00:00.000Z'),
    targetDate: new Date('2027-01-01T00:00:00.000Z'),
    status: 'ACTIVE',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    contributions: [contribution('5000000', '2026-03-01T00:00:00.000Z')],
    ...overrides,
  };
}

function createPrismaMock() {
  return {
    user: {
      findUnique: jest.fn().mockResolvedValue({
        timezone: 'Asia/Ho_Chi_Minh',
        defaultCurrency: 'VND',
      }),
    },
    savingsGoal: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null),
    },
    goalContribution: {
      findMany: jest.fn().mockResolvedValue([]),
      aggregate: jest.fn().mockResolvedValue({ _sum: { amount: null } }),
    },
  };
}

type PrismaMock = ReturnType<typeof createPrismaMock>;

function createService(prisma: PrismaMock): SavingsProgressService {
  return new SavingsProgressService(prisma as unknown as PrismaService);
}

describe('SavingsProgressService', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-10-30T03:00:00.000Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('contextFor', () => {
    it('uses the owner timezone and default currency', async () => {
      const service = createService(createPrismaMock());
      await expect(service.contextFor('user-1')).resolves.toEqual({
        timezone: 'Asia/Ho_Chi_Minh',
        today: '2026-10-30',
        defaultCurrency: 'VND',
      });
    });

    it('falls back to safe defaults when the user row is missing', async () => {
      const prisma = createPrismaMock();
      prisma.user.findUnique.mockResolvedValue(null);
      const service = createService(prisma);
      await expect(service.contextFor('user-1')).resolves.toEqual({
        timezone: 'Asia/Ho_Chi_Minh',
        today: '2026-10-30',
        defaultCurrency: 'VND',
      });
    });
  });

  describe('progress', () => {
    function seed(): PrismaMock {
      const prisma = createPrismaMock();
      prisma.savingsGoal.findMany.mockResolvedValue([
        goalRow({
          id: 'goal-overdue',
          name: 'Quá hạn',
          targetAmount: new Prisma.Decimal('6000000'),
          targetDate: new Date('2026-06-01T00:00:00.000Z'),
          contributions: [contribution('1000000', '2026-02-01T00:00:00.000Z', 'goal-overdue')],
        }),
        goalRow({
          id: 'goal-on-track',
          name: 'Đúng tiến độ',
          startDate: new Date('2026-10-01T00:00:00.000Z'),
          targetDate: new Date('2027-10-01T00:00:00.000Z'),
          contributions: [contribution('5000000', '2026-10-05T00:00:00.000Z', 'goal-on-track')],
        }),
        goalRow({
          id: 'goal-at-risk',
          name: 'Chậm tiến độ',
          targetDate: new Date('2026-11-15T00:00:00.000Z'),
          contributions: [contribution('6000000', '2026-03-01T00:00:00.000Z', 'goal-at-risk')],
        }),
        goalRow({
          id: 'goal-paused',
          name: 'Tạm dừng',
          status: 'PAUSED',
          targetAmount: new Prisma.Decimal('10000000'),
          contributions: [contribution('2000000', '2026-03-01T00:00:00.000Z', 'goal-paused')],
        }),
        goalRow({
          id: 'goal-completed',
          name: 'Hoàn thành',
          status: 'COMPLETED',
          targetAmount: new Prisma.Decimal('5000000'),
          targetDate: null,
          contributions: [contribution('5000000', '2026-03-01T00:00:00.000Z', 'goal-completed')],
        }),
        goalRow({
          id: 'goal-no-deadline',
          name: 'Chưa có hạn',
          targetAmount: new Prisma.Decimal('3000000'),
          targetDate: null,
          contributions: [],
        }),
        goalRow({
          id: 'goal-archived',
          name: 'Đã lưu trữ',
          status: 'ARCHIVED',
          targetAmount: new Prisma.Decimal('1000000'),
          contributions: [],
        }),
      ]);
      return prisma;
    }

    it('scopes the query to the owner and the requested currency', async () => {
      const prisma = seed();
      const service = createService(prisma);
      await service.progress('user-1', { currency: 'usd' });
      expect(prisma.savingsGoal.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: 'user-1', currency: 'USD' } }),
      );
    });

    it('classifies, orders and totals the goals in one currency', async () => {
      const service = createService(seed());
      const result = await service.progress('user-1', {});

      expect(result.currency).toBe('VND');
      expect(result.today).toBe('2026-10-30');
      expect(result.excluded).toEqual({ archived: 1 });
      expect(result.goals.map((goal) => goal.goalId)).toEqual([
        'goal-overdue',
        'goal-at-risk',
        'goal-on-track',
        'goal-no-deadline',
        'goal-paused',
        'goal-completed',
      ]);
      expect(result.goals.map((goal) => goal.progressStatus)).toEqual([
        'OVERDUE',
        'AT_RISK',
        'ON_TRACK',
        'INSUFFICIENT_DATA',
        'PAUSED',
        'COMPLETED',
      ]);

      expect(result.summary).toMatchObject({
        activeGoals: 4,
        onTrack: 1,
        atRisk: 1,
        overdue: 1,
        completed: 1,
        paused: 1,
        insufficientData: 1,
        totalTargetAmount: '48000000.00',
        totalSavedAmount: '19000000.00',
        totalRemainingAmount: '29000000.00',
        overallPercentage: 39.58,
      });
      expect(result.rules.length).toBeGreaterThan(0);
      expect(result.limitations.join(' ')).toContain('VND');
    });

    it('never returns archived goals in the list or the totals', async () => {
      const service = createService(seed());
      const result = await service.progress('user-1', {});
      expect(result.goals.some((goal) => goal.goalId === 'goal-archived')).toBe(false);
      expect(result.summary.totalSavedAmount).toBe('19000000.00');
    });
  });

  describe('goalProgress', () => {
    it('throws when the goal belongs to someone else', async () => {
      const prisma = createPrismaMock();
      prisma.savingsGoal.findFirst.mockResolvedValue(null);
      const service = createService(prisma);
      await expect(service.goalProgress('user-1', 'goal-1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(prisma.savingsGoal.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'goal-1', userId: 'user-1' } }),
      );
    });

    it('returns the progress of one owned goal', async () => {
      const prisma = createPrismaMock();
      prisma.savingsGoal.findFirst.mockResolvedValue(goalRow());
      const service = createService(prisma);
      const result = await service.goalProgress('user-1', 'goal-1');
      expect(result.goalId).toBe('goal-1');
      expect(result.savedAmount).toBe('5000000.00');
    });
  });

  describe('contributionHistory', () => {
    function seedHistory(): PrismaMock {
      const prisma = createPrismaMock();
      prisma.goalContribution.findMany.mockResolvedValue([
        {
          ...contribution('500000', '2026-10-01T00:00:00.000Z'),
          goal: { name: 'Mua laptop' },
        },
        {
          ...contribution('2000000', '2026-09-10T00:00:00.000Z'),
          goal: { name: 'Mua laptop' },
        },
        {
          ...contribution('1000000', '2026-08-15T00:00:00.000Z'),
          goal: { name: 'Mua laptop' },
        },
      ]);
      prisma.goalContribution.aggregate.mockResolvedValue({
        _sum: { amount: new Prisma.Decimal('4000000') },
      });
      return prisma;
    }

    it('builds monthly totals with an opening balance before the window', async () => {
      const service = createService(seedHistory());
      const result = await service.contributionHistory('user-1', { months: 3 });

      expect(result.currency).toBe('VND');
      expect(result.monthCount).toBe(3);
      expect(result.fromMonth).toBe('2026-08');
      expect(result.toMonth).toBe('2026-10');
      expect(result.openingAmount).toBe('4000000.00');
      expect(result.totalAmount).toBe('3500000.00');
      expect(result.totalCount).toBe(3);
      expect(result.months).toEqual([
        { month: '2026-08', amount: '1000000.00', count: 1, cumulativeAmount: '5000000.00' },
        { month: '2026-09', amount: '2000000.00', count: 1, cumulativeAmount: '7000000.00' },
        { month: '2026-10', amount: '500000.00', count: 1, cumulativeAmount: '7500000.00' },
      ]);
      expect(result.items[0].goalName).toBe('Mua laptop');
      expect(result.truncated).toBe(false);
    });

    it('uses the goal currency when a goal filter is supplied', async () => {
      const prisma = seedHistory();
      prisma.savingsGoal.findFirst.mockResolvedValue({
        id: '11111111-1111-1111-1111-111111111111',
        currency: 'USD',
      });
      const service = createService(prisma);
      const result = await service.contributionHistory('user-1', {
        goalId: '11111111-1111-1111-1111-111111111111',
      });
      expect(result.currency).toBe('USD');
      expect(result.goalId).toBe('11111111-1111-1111-1111-111111111111');
      expect(prisma.goalContribution.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            userId: 'user-1',
            goalId: '11111111-1111-1111-1111-111111111111',
            goal: { currency: 'USD' },
          }),
        }),
      );
    });

    it('rejects a goal filter the user does not own', async () => {
      const prisma = createPrismaMock();
      prisma.savingsGoal.findFirst.mockResolvedValue(null);
      const service = createService(prisma);
      await expect(
        service.contributionHistory('user-1', {
          goalId: '11111111-1111-1111-1111-111111111111',
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('defaults to the last twelve months', async () => {
      const service = createService(seedHistory());
      const result = await service.contributionHistory('user-1', {});
      expect(result.monthCount).toBe(12);
      expect(result.fromMonth).toBe('2025-11');
      expect(result.months).toHaveLength(12);
    });
  });
});
