import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { GoalContribution, SavingsGoal } from '@prisma/client';
import { Prisma } from '@prisma/client';
import type { PrismaService } from '../../common/prisma/prisma.service';
import { GoalsService } from './goals.service';

function createPrismaMock() {
  const prisma = {
    user: {
      findUnique: jest.fn().mockResolvedValue({
        timezone: 'Asia/Ho_Chi_Minh',
        defaultCurrency: 'VND',
      }),
    },
    savingsGoal: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    goalContribution: {
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    $transaction: jest.fn(),
  };
  prisma.$transaction.mockImplementation(async (callback: unknown) =>
    (callback as (tx: typeof prisma) => Promise<unknown>)(prisma),
  );
  return prisma;
}

type PrismaMock = ReturnType<typeof createPrismaMock>;

function createService(prisma: PrismaMock): GoalsService {
  return new GoalsService(prisma as unknown as PrismaService);
}

function contribution(amount: string, id = `contribution-${amount}`): GoalContribution {
  return {
    id,
    goalId: 'goal-1',
    userId: 'user-1',
    amount: new Prisma.Decimal(amount),
    contributedAt: new Date('2026-10-10T03:00:00.000Z'),
    note: null,
    createdAt: new Date('2026-10-10T03:00:00.000Z'),
  };
}

function goal(
  overrides: Partial<SavingsGoal> = {},
  contributions: GoalContribution[] = [],
): SavingsGoal & { contributions: GoalContribution[] } {
  return {
    id: 'goal-1',
    userId: 'user-1',
    name: 'Mua laptop',
    description: null,
    targetAmount: new Prisma.Decimal('30000000.00'),
    currency: 'VND',
    startDate: new Date('2026-10-01T00:00:00.000Z'),
    targetDate: new Date('2027-06-30T00:00:00.000Z'),
    status: 'ACTIVE',
    createdAt: new Date('2026-10-01T02:00:00.000Z'),
    updatedAt: new Date('2026-10-01T02:00:00.000Z'),
    ...overrides,
    contributions,
  };
}

describe('GoalsService', () => {
  let prisma: PrismaMock;
  let service: GoalsService;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-10-30T03:00:00.000Z'));
    prisma = createPrismaMock();
    service = createService(prisma);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('create', () => {
    it('fills the start date and currency from the user context and trims text', async () => {
      prisma.savingsGoal.create.mockImplementation(
        async ({ data }: { data: Record<string, unknown> }) => ({
          ...goal(),
          ...data,
          contributions: [],
        }),
      );

      const dto = await service.create('user-1', {
        name: '  Mua laptop  ',
        description: '   ',
        targetAmount: '30000000',
      });

      const data = prisma.savingsGoal.create.mock.calls[0][0].data;
      expect(data).toMatchObject({
        userId: 'user-1',
        name: 'Mua laptop',
        description: null,
        currency: 'VND',
        startDate: new Date('2026-10-30T00:00:00.000Z'),
        targetDate: null,
      });
      expect(dto).toMatchObject({
        startDate: '2026-10-30',
        targetDate: null,
        currency: 'VND',
        displayStatus: 'ACTIVE',
        requiredMonthlySaving: null,
      });
    });

    it('accepts an explicit currency and dates', async () => {
      prisma.savingsGoal.create.mockImplementation(
        async ({ data }: { data: Record<string, unknown> }) => ({
          ...goal(),
          ...data,
          contributions: [],
        }),
      );

      const dto = await service.create('user-1', {
        name: 'Du lịch',
        targetAmount: '15000000',
        currency: 'USD',
        startDate: '2026-11-01',
        targetDate: '2027-05-01',
      });

      const data = prisma.savingsGoal.create.mock.calls[0][0].data;
      expect(data.currency).toBe('USD');
      expect(data.startDate).toEqual(new Date('2026-11-01T00:00:00.000Z'));
      expect(data.targetDate).toEqual(new Date('2027-05-01T00:00:00.000Z'));
      expect(dto).toMatchObject({
        startDate: '2026-11-01',
        targetDate: '2027-05-01',
        monthsRemaining: 7,
      });
    });

    it('rejects a non-positive target and a deadline that is not after the start', async () => {
      await expect(
        service.create('user-1', { name: 'X', targetAmount: '0' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        service.create('user-1', {
          name: 'X',
          targetAmount: '1000',
          startDate: '2026-11-01',
          targetDate: '2026-11-01',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.savingsGoal.create).not.toHaveBeenCalled();
    });
  });

  describe('list and isolation', () => {
    it('scopes the query to the signed-in user and sorts overdue goals first', async () => {
      prisma.savingsGoal.findMany.mockResolvedValue([
        goal({ id: 'paused', status: 'PAUSED', targetDate: null }),
        goal({ id: 'active' }),
        goal({ id: 'overdue', targetDate: new Date('2026-10-01') }),
      ]);

      const items = await service.list('user-1', { currency: 'VND' });

      const where = prisma.savingsGoal.findMany.mock.calls[0][0].where;
      expect(where).toMatchObject({
        userId: 'user-1',
        currency: 'VND',
        status: { not: 'ARCHIVED' },
      });
      expect(items.map((item) => item.displayStatus)).toEqual(['OVERDUE', 'ACTIVE', 'PAUSED']);
    });

    it('includes archived goals only when asked and never drops the user filter', async () => {
      prisma.savingsGoal.findMany.mockResolvedValue([]);
      await service.list('user-1', { includeArchived: true });
      expect(prisma.savingsGoal.findMany.mock.calls[0][0].where).toEqual({ userId: 'user-1' });
    });

    it("reports another user's goal as not found", async () => {
      prisma.savingsGoal.findFirst.mockResolvedValue(null);
      await expect(service.get('user-2', 'goal-1')).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.savingsGoal.findFirst.mock.calls[0][0].where).toEqual({
        id: 'goal-1',
        userId: 'user-2',
      });
    });
  });

  describe('update', () => {
    it('rejects a target below the saved amount', async () => {
      prisma.savingsGoal.findFirst.mockResolvedValue(goal({}, [contribution('5000000.00')]));
      await expect(
        service.update('user-1', 'goal-1', { targetAmount: '4000000' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.savingsGoal.update).not.toHaveBeenCalled();
    });

    it('rejects changing the start date after contributions exist', async () => {
      prisma.savingsGoal.findFirst.mockResolvedValue(goal({}, [contribution('1000000.00')]));
      await expect(
        service.update('user-1', 'goal-1', { startDate: '2026-10-05' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects a deadline that is not after the start date', async () => {
      prisma.savingsGoal.findFirst.mockResolvedValue(goal());
      await expect(
        service.update('user-1', 'goal-1', { targetDate: '2026-09-01' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('allows pausing an active goal and reports the paused state', async () => {
      prisma.savingsGoal.findFirst.mockResolvedValue(goal());
      prisma.savingsGoal.update.mockResolvedValue(goal({ status: 'PAUSED' }));

      const dto = await service.update('user-1', 'goal-1', { status: 'PAUSED' });

      expect(prisma.savingsGoal.update.mock.calls[0][0].data).toEqual({ status: 'PAUSED' });
      expect(dto.displayStatus).toBe('PAUSED');
      expect(dto.requiredMonthlySaving).toBeNull();
    });

    it('keeps the status in step when only the target amount changes', async () => {
      prisma.savingsGoal.findFirst.mockResolvedValue(
        goal({ status: 'COMPLETED' }, [contribution('10000000.00')]),
      );
      prisma.savingsGoal.update.mockResolvedValue(
        goal({ status: 'ACTIVE' }, [contribution('10000000.00')]),
      );
      await service.update('user-1', 'goal-1', { targetAmount: '20000000' });
      expect(prisma.savingsGoal.update.mock.calls[0][0].data).toMatchObject({
        status: 'ACTIVE',
      });

      prisma.savingsGoal.findFirst.mockResolvedValue(
        goal({ status: 'ACTIVE' }, [contribution('10000000.00')]),
      );
      prisma.savingsGoal.update.mockResolvedValue(
        goal({ status: 'COMPLETED' }, [contribution('10000000.00')]),
      );
      await service.update('user-1', 'goal-1', { targetAmount: '10000000' });
      expect(prisma.savingsGoal.update.mock.calls[1][0].data).toMatchObject({
        status: 'COMPLETED',
      });
    });

    it('rejects reactivating a fully funded completed goal and any change to an archived one', async () => {
      prisma.savingsGoal.findFirst.mockResolvedValue(
        goal({ status: 'COMPLETED' }, [contribution('30000000.00')]),
      );
      await expect(service.update('user-1', 'goal-1', { status: 'ACTIVE' })).rejects.toBeInstanceOf(
        BadRequestException,
      );

      prisma.savingsGoal.findFirst.mockResolvedValue(goal({ status: 'ARCHIVED' }));
      await expect(service.update('user-1', 'goal-1', { name: 'Khác' })).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  });

  describe('addContribution', () => {
    it('records a contribution and auto-completes the goal when the target is reached', async () => {
      const before = goal({}, [contribution('29000000.00')]);
      const after = goal({ status: 'COMPLETED' }, [
        contribution('29000000.00'),
        contribution('1000000.00', 'contribution-new'),
      ]);
      prisma.savingsGoal.findFirst.mockResolvedValueOnce(before).mockResolvedValueOnce(after);

      const dto = await service.addContribution('user-1', 'goal-1', {
        amount: '1000000',
        contributedAt: '2026-10-30T09:00:00+07:00',
      });

      const created = prisma.goalContribution.create.mock.calls[0][0].data;
      expect(created).toMatchObject({ goalId: 'goal-1', userId: 'user-1' });
      expect(created.amount.toString()).toBe('1000000');
      expect(prisma.savingsGoal.update).toHaveBeenCalledWith({
        where: { id: 'goal-1' },
        data: { status: 'COMPLETED' },
      });
      expect(dto.displayStatus).toBe('COMPLETED');
      expect(dto.requiredMonthlySaving).toBe('0.00');
    });

    it('never lets a contribution pass the remaining amount', async () => {
      prisma.savingsGoal.findFirst.mockResolvedValue(goal({}, [contribution('29000000.00')]));
      await expect(
        service.addContribution('user-1', 'goal-1', {
          amount: '2000000',
          contributedAt: '2026-10-30T09:00:00+07:00',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.goalContribution.create).not.toHaveBeenCalled();
    });

    it('rejects contributions to paused or completed goals', async () => {
      for (const status of ['PAUSED', 'COMPLETED'] as const) {
        prisma.savingsGoal.findFirst.mockResolvedValue(goal({ status }));
        await expect(
          service.addContribution('user-1', 'goal-1', {
            amount: '100000',
            contributedAt: '2026-10-30T09:00:00+07:00',
          }),
        ).rejects.toBeInstanceOf(BadRequestException);
      }
    });

    it('rejects dates before the start and dates in the future', async () => {
      prisma.savingsGoal.findFirst.mockResolvedValue(goal());
      await expect(
        service.addContribution('user-1', 'goal-1', {
          amount: '100000',
          contributedAt: '2026-09-30T09:00:00+07:00',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        service.addContribution('user-1', 'goal-1', {
          amount: '100000',
          contributedAt: '2026-10-31T09:00:00+07:00',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects an unknown goal of another user', async () => {
      prisma.savingsGoal.findFirst.mockResolvedValue(null);
      await expect(
        service.addContribution('user-2', 'goal-1', {
          amount: '100000',
          contributedAt: '2026-10-30T09:00:00+07:00',
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('updateContribution and deleteContribution', () => {
    it('rejects an edit that would overfund the goal', async () => {
      prisma.savingsGoal.findFirst.mockResolvedValue(
        goal({}, [contribution('5000000.00', 'c1'), contribution('5000000.00', 'c2')]),
      );
      await expect(
        service.updateContribution('user-1', 'goal-1', 'c1', { amount: '26000000' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.goalContribution.update).not.toHaveBeenCalled();
    });

    it('completes an active goal when an edit fills it and reopens a completed one when it no longer is', async () => {
      prisma.savingsGoal.findFirst
        .mockResolvedValueOnce(
          goal({}, [contribution('5000000.00', 'c1'), contribution('1000000.00', 'c2')]),
        )
        .mockResolvedValueOnce(goal({ status: 'COMPLETED' }));
      prisma.savingsGoal.update.mockResolvedValue(goal({ status: 'COMPLETED' }));

      await service.updateContribution('user-1', 'goal-1', 'c1', { amount: '29000000' });
      expect(prisma.savingsGoal.update).toHaveBeenCalledWith({
        where: { id: 'goal-1' },
        data: { status: 'COMPLETED' },
      });

      prisma.savingsGoal.update.mockClear();
      prisma.savingsGoal.findFirst
        .mockResolvedValueOnce(
          goal({ status: 'COMPLETED' }, [
            contribution('5000000.00', 'c1'),
            contribution('25000000.00', 'c2'),
          ]),
        )
        .mockResolvedValueOnce(goal({ status: 'ACTIVE' }));
      prisma.savingsGoal.update.mockResolvedValue(goal({ status: 'ACTIVE' }));

      await service.updateContribution('user-1', 'goal-1', 'c1', { amount: '4000000' });
      expect(prisma.savingsGoal.update).toHaveBeenCalledWith({
        where: { id: 'goal-1' },
        data: { status: 'ACTIVE' },
      });
    });

    it('reports an unknown contribution with a 404', async () => {
      prisma.savingsGoal.findFirst.mockResolvedValue(goal());
      await expect(
        service.updateContribution('user-1', 'goal-1', 'missing', { amount: '1000' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('deletes a contribution and reopens the goal when it drops below the target', async () => {
      prisma.savingsGoal.findFirst
        .mockResolvedValueOnce(
          goal({ status: 'COMPLETED' }, [
            contribution('1000000.00', 'c1'),
            contribution('29000000.00', 'c2'),
          ]),
        )
        .mockResolvedValueOnce(goal({ status: 'ACTIVE' }, [contribution('29000000.00', 'c2')]));
      prisma.savingsGoal.update.mockResolvedValue(goal({ status: 'ACTIVE' }));

      const dto = await service.deleteContribution('user-1', 'goal-1', 'c1');

      expect(prisma.goalContribution.delete).toHaveBeenCalledWith({ where: { id: 'c1' } });
      expect(prisma.savingsGoal.update).toHaveBeenCalledWith({
        where: { id: 'goal-1' },
        data: { status: 'ACTIVE' },
      });
      expect(dto).toMatchObject({ savedAmount: '29000000.00', displayStatus: 'ACTIVE' });
    });

    it('refuses to touch contributions of an archived goal', async () => {
      prisma.savingsGoal.findFirst.mockResolvedValue(goal({ status: 'ARCHIVED' }));
      await expect(service.deleteContribution('user-1', 'goal-1', 'c1')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  });
});
