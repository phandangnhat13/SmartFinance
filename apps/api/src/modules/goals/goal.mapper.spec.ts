import type { SavingsGoal } from '@prisma/client';
import { Prisma } from '@prisma/client';
import {
  goalDisplayStatus,
  monthsRemaining,
  requiredMonthlySaving,
  toGoalDto,
} from './goal.mapper';

const TODAY = '2026-10-30';

function goal(overrides: Partial<SavingsGoal> = {}): SavingsGoal {
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
  };
}

function withContributions(goalRecord: SavingsGoal, amounts: string[]) {
  return {
    ...goalRecord,
    contributions: amounts.map((amount, index) => ({
      id: `contribution-${index}`,
      goalId: goalRecord.id,
      userId: goalRecord.userId,
      amount: new Prisma.Decimal(amount),
      contributedAt: new Date(`2026-10-${String(10 + index).padStart(2, '0')}T03:00:00.000Z`),
      note: null,
      createdAt: new Date('2026-10-10T03:00:00.000Z'),
    })),
  };
}

describe('goal mapper', () => {
  it('computes saved, remaining, percentage and the required monthly saving', () => {
    const dto = toGoalDto(withContributions(goal(), ['2000000.00', '4000000.00']), {
      timezone: 'Asia/Ho_Chi_Minh',
      today: TODAY,
    });

    expect(dto).toMatchObject({
      savedAmount: '6000000.00',
      remainingAmount: '24000000.00',
      percentage: 20,
      currency: 'VND',
      startDate: '2026-10-01',
      targetDate: '2027-06-30',
      status: 'ACTIVE',
      displayStatus: 'ACTIVE',
      isOverdue: false,
      monthsRemaining: 8,
      requiredMonthlySaving: '3000000.00',
    });
    expect(dto.contributions[0]).toMatchObject({ id: 'contribution-1', amount: '4000000.00' });
  });

  it('marks an active goal past its target date as overdue and stops asking for money', () => {
    const dto = toGoalDto(withContributions(goal({ targetDate: new Date('2026-10-29') }), []), {
      timezone: 'Asia/Ho_Chi_Minh',
      today: TODAY,
    });

    expect(dto).toMatchObject({
      displayStatus: 'OVERDUE',
      isOverdue: true,
      monthsRemaining: 0,
      requiredMonthlySaving: null,
    });
  });

  it('does not divide by zero when the deadline is today or absent', () => {
    const dueToday = toGoalDto(
      withContributions(goal({ targetDate: new Date('2026-10-30') }), []),
      {
        timezone: 'Asia/Ho_Chi_Minh',
        today: TODAY,
      },
    );
    expect(dueToday).toMatchObject({
      displayStatus: 'ACTIVE',
      isOverdue: false,
      monthsRemaining: 0,
      requiredMonthlySaving: null,
    });

    const noDate = toGoalDto(withContributions(goal({ targetDate: null }), []), {
      timezone: 'Asia/Ho_Chi_Minh',
      today: TODAY,
    });
    expect(noDate).toMatchObject({
      targetDate: null,
      monthsRemaining: null,
      requiredMonthlySaving: null,
    });
  });

  it('asks for nothing once completed and stays null while paused', () => {
    const completed = toGoalDto(withContributions(goal({ status: 'COMPLETED' }), ['30000000.00']), {
      timezone: 'Asia/Ho_Chi_Minh',
      today: TODAY,
    });
    expect(completed).toMatchObject({
      displayStatus: 'COMPLETED',
      remainingAmount: '0.00',
      requiredMonthlySaving: '0.00',
    });

    const paused = toGoalDto(withContributions(goal({ status: 'PAUSED' }), []), {
      timezone: 'Asia/Ho_Chi_Minh',
      today: TODAY,
    });
    expect(paused).toMatchObject({
      displayStatus: 'PAUSED',
      monthsRemaining: 8,
      requiredMonthlySaving: null,
    });
  });

  it('never reports a negative remaining amount, even for legacy overfunded goals', () => {
    const dto = toGoalDto(withContributions(goal(), ['35000000.00']), {
      timezone: 'Asia/Ho_Chi_Minh',
      today: TODAY,
    });
    expect(dto.remainingAmount).toBe('0.00');
    expect(dto.percentage).toBe(116.67);
    expect(dto.requiredMonthlySaving).toBe('0.00');
  });

  it('keeps an archived goal archived and ignores overdue for non-active statuses', () => {
    expect(goalDisplayStatus('ARCHIVED', false)).toBe('ARCHIVED');
    expect(goalDisplayStatus('PAUSED', false)).toBe('PAUSED');
    expect(goalDisplayStatus('ACTIVE', true)).toBe('OVERDUE');
    expect(monthsRemaining(TODAY, null)).toBeNull();
    expect(requiredMonthlySaving('COMPLETED', new Prisma.Decimal(0), 0)).toBe('0.00');
  });

  it('falls back to the creation date when a legacy goal has no startDate', () => {
    const dto = toGoalDto(withContributions(goal({ startDate: null }), []), {
      timezone: 'Asia/Ho_Chi_Minh',
      today: TODAY,
    });
    // 2026-10-01T02:00Z is 2026-10-01 09:00 in Asia/Ho_Chi_Minh.
    expect(dto.startDate).toBe('2026-10-01');
  });
});
