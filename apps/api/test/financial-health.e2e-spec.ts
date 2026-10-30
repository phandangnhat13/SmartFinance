import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import type {
  FinancialHealthBreakdownDto,
  FinancialHealthDto,
  FinancialHealthHistoryDto,
} from '@smart-finance/shared-types';
import { DateTime } from 'luxon';
import request from 'supertest';
import type { SuperAgentTest } from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { ACCESS_TOKEN_COOKIE } from '../src/common/guards/jwt-auth.guard';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { resolveMonthPeriod } from '../src/common/utils/period';
import { AuthService } from '../src/modules/auth/auth.service';

const TZ = 'Asia/Ho_Chi_Minh';
const BASE = '/api/v1/analytics/financial-health';
const HEALTH_GROUPS = ['cash-flow', 'budget', 'savings', 'stability', 'forecast-risk'];

interface Session {
  id: string;
  agent: SuperAgentTest;
}

async function createSession(
  application: NestExpressApplication,
  service: AuthService,
  email: string,
  displayName: string,
  timezone = TZ,
): Promise<Session> {
  const user = await service.register({ email, password: 'Password123!', displayName });
  if (timezone !== TZ) {
    await application
      .get(PrismaService)
      .user.update({ where: { id: user.id }, data: { timezone } });
  }
  const token = await service.issueAccessToken(user);
  const agent = request.agent(application.getHttpServer()) as unknown as SuperAgentTest;
  const jar = (agent as unknown as { jar: { setCookie(cookie: string): void } }).jar;
  jar.setCookie(`${ACCESS_TOKEN_COOKIE}=${token}; Path=/`);
  return { id: user.id, agent };
}

/**
 * Financial health score (M3d) against the isolated test database.
 *
 * Three users exercise a healthy profile, a struggling profile and a profile
 * with only budgets/goals; a fourth checks currency isolation. All figures come
 * from the real services and database — nothing is mocked.
 */
describe('Financial health API (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let authService: AuthService;

  const stamp = `${Date.now()}.${Math.floor(Math.random() * 1e6)}`;
  const now = DateTime.now().setZone(TZ);
  const currentMonth = now.toFormat('yyyy-MM');

  function monthsAgo(count: number): string {
    return now.minus({ months: count }).toFormat('yyyy-MM');
  }

  function monthsAhead(count: number): string {
    return now.plus({ months: count }).toFormat('yyyy-MM');
  }

  /** Goal dates are DATE columns stored as UTC midnight, as the goals service does. */
  function dateOnly(value: string): Date {
    return new Date(`${value}T00:00:00.000Z`);
  }

  function firstDay(month: string): string {
    return `${month}-01`;
  }

  function lastDay(month: string): string {
    return DateTime.fromFormat(`${month}-01`, 'yyyy-MM-dd', { zone: TZ })
      .endOf('month')
      .toFormat('yyyy-MM-dd');
  }

  function instantOf(month: string): Date {
    return DateTime.fromFormat(`${month}-15 12:00`, 'yyyy-MM-dd HH:mm', { zone: TZ })
      .toUTC()
      .toJSDate();
  }

  function account(input: {
    userId: string;
    name: string;
    initialBalance?: string;
    currency?: string;
  }) {
    return prisma.account.create({
      data: {
        userId: input.userId,
        name: input.name,
        type: 'CASH',
        currency: input.currency ?? 'VND',
        initialBalance: new Prisma.Decimal(input.initialBalance ?? '0'),
      },
    });
  }

  function transaction(input: {
    userId: string;
    accountId: string;
    type: 'INCOME' | 'EXPENSE';
    amount: string;
    currency?: string;
    occurredAt: Date;
  }) {
    return prisma.transaction.create({
      data: {
        userId: input.userId,
        accountId: input.accountId,
        type: input.type,
        amount: new Prisma.Decimal(input.amount),
        currency: input.currency ?? 'VND',
        description: 'Giao dịch kiểm thử M3d',
        occurredAt: input.occurredAt,
      },
    });
  }

  async function budget(input: {
    userId: string;
    name: string;
    month: string;
    limit: string;
    warningThresholds?: number[];
  }) {
    const period = resolveMonthPeriod(input.month, TZ);
    return prisma.budget.create({
      data: {
        userId: input.userId,
        scopeKey: 'ALL',
        name: input.name,
        periodStart: period.periodStart,
        periodEnd: period.periodEnd,
        limitAmount: new Prisma.Decimal(input.limit),
        warningThresholds: input.warningThresholds ?? [80, 100],
      },
    });
  }

  async function goal(input: {
    userId: string;
    name: string;
    target: string;
    startDate: Date;
    targetDate: Date;
    contribution?: string;
    contributionAt?: Date;
    status?: 'ACTIVE' | 'PAUSED';
  }) {
    const created = await prisma.savingsGoal.create({
      data: {
        userId: input.userId,
        name: input.name,
        targetAmount: new Prisma.Decimal(input.target),
        currency: 'VND',
        startDate: input.startDate,
        targetDate: input.targetDate,
        status: input.status ?? 'ACTIVE',
      },
    });
    if (input.contribution && input.contributionAt) {
      await prisma.goalContribution.create({
        data: {
          goalId: created.id,
          userId: input.userId,
          amount: new Prisma.Decimal(input.contribution),
          contributedAt: input.contributionAt,
        },
      });
    }
    return created;
  }

  async function health(
    agent: SuperAgentTest,
    query: Record<string, string> = {},
  ): Promise<FinancialHealthDto> {
    const response = await agent.get(BASE).query(query).expect(200);
    return response.body as FinancialHealthDto;
  }

  async function seedAlice() {
    const session = await createSession(
      app,
      authService,
      `health.alice.${stamp}@example.com`,
      'Alice Health',
    );
    const main = await account({
      userId: session.id,
      name: 'Tiền mặt',
      initialBalance: '20000000',
    });
    await account({ userId: session.id, name: 'USD', currency: 'USD', initialBalance: '100000' });

    // Six complete months: income 10M, expense 7M (30% saving rate).
    for (let ago = 6; ago >= 1; ago -= 1) {
      const at = instantOf(monthsAgo(ago));
      await transaction({
        userId: session.id,
        accountId: main.id,
        type: 'INCOME',
        amount: '10000000.00',
        occurredAt: at,
      });
      await transaction({
        userId: session.id,
        accountId: main.id,
        type: 'EXPENSE',
        amount: '7000000.00',
        occurredAt: at,
      });
    }

    // Current month: income 2M, expense 1M (half of the 2M budget).
    const moment = DateTime.now().setZone(TZ).toJSDate();
    await transaction({
      userId: session.id,
      accountId: main.id,
      type: 'INCOME',
      amount: '2000000.00',
      occurredAt: moment,
    });
    await transaction({
      userId: session.id,
      accountId: main.id,
      type: 'EXPENSE',
      amount: '1000000.00',
      occurredAt: moment,
    });

    // Current and previous three budgets, all well within their limits so the
    // recomputed history can score every month it returns.
    for (const month of [currentMonth, monthsAgo(1), monthsAgo(2), monthsAgo(3)]) {
      await budget({ userId: session.id, name: `Ngân sách ${month}`, month, limit: '10000000' });
    }

    // One on-track goal: 12M over 12 months, 6M saved at the halfway point.
    await goal({
      userId: session.id,
      name: 'Mục tiêu riêng của Alice',
      target: '12000000',
      startDate: dateOnly(firstDay(monthsAgo(6))),
      targetDate: dateOnly(lastDay(monthsAhead(6))),
      contribution: '6000000',
      contributionAt: instantOf(monthsAgo(5)),
    });

    return session;
  }

  async function seedBob() {
    const session = await createSession(
      app,
      authService,
      `health.bob.${stamp}@example.com`,
      'Bob Health',
    );
    const main = await account({ userId: session.id, name: 'Ví', initialBalance: '0' });

    // Three complete months: income 10M, expense 11M (negative cash flow).
    for (let ago = 3; ago >= 1; ago -= 1) {
      const at = instantOf(monthsAgo(ago));
      await transaction({
        userId: session.id,
        accountId: main.id,
        type: 'INCOME',
        amount: '10000000.00',
        occurredAt: at,
      });
      await transaction({
        userId: session.id,
        accountId: main.id,
        type: 'EXPENSE',
        amount: '11000000.00',
        occurredAt: at,
      });
    }
    await transaction({
      userId: session.id,
      accountId: main.id,
      type: 'EXPENSE',
      amount: '1500000.00',
      occurredAt: DateTime.now().setZone(TZ).toJSDate(),
    });

    await budget({
      userId: session.id,
      name: 'Ngân sách vượt',
      month: currentMonth,
      limit: '1000000',
    });

    // A goal whose deadline already passed with nothing saved.
    await goal({
      userId: session.id,
      name: 'Mục tiêu trễ',
      target: '5000000',
      startDate: dateOnly(firstDay(monthsAgo(6))),
      targetDate: dateOnly(lastDay(monthsAgo(1))),
    });

    return session;
  }

  async function seedCarol() {
    const session = await createSession(
      app,
      authService,
      `health.carol.${stamp}@example.com`,
      'Carol Health',
    );
    await account({ userId: session.id, name: 'Ví', initialBalance: '5000000' });
    await budget({
      userId: session.id,
      name: 'Ngân sách tháng',
      month: currentMonth,
      limit: '1000000',
    });
    await goal({
      userId: session.id,
      name: 'Mục tiêu',
      target: '10000000',
      startDate: dateOnly(firstDay(monthsAgo(1))),
      targetDate: dateOnly(lastDay(monthsAhead(6))),
      contribution: '1000000',
      contributionAt: DateTime.now().setZone(TZ).toJSDate(),
    });
    return session;
  }

  let alice: Session;
  let bob: Session;
  let carol: Session;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false });
    configureApp(app);
    await app.init();

    prisma = app.get(PrismaService);
    authService = app.get(AuthService);

    alice = await seedAlice();
    bob = await seedBob();
    carol = await seedCarol();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('scores all five groups for a healthy profile with a public formula', async () => {
    const body = await health(alice.agent, { currency: 'VND' });

    expect(body.currency).toBe('VND');
    expect(body.timezone).toBe(TZ);
    expect(body.estimated).toBe(true);
    expect(body.historyAvailable).toBe(false);
    expect(body.formula).toContain('60%');
    expect(body.groups.map((group) => group.key)).toEqual(HEALTH_GROUPS);
    expect(body.groups.reduce((sum, group) => sum + group.weight, 0)).toBe(100);

    const byKey = Object.fromEntries(body.groups.map((group) => [group.key, group]));
    expect(byKey['cash-flow'].status).toBe('scored');
    expect(byKey['cash-flow'].score).toBe(100);
    expect(byKey['cash-flow'].evidence.find((item) => item.key === 'savings_rate')?.value).toBe(
      '30%',
    );
    expect(byKey.budget.status).toBe('scored');
    expect(byKey.budget.score).toBe(100);
    expect(byKey.savings.status).toBe('scored');
    expect(byKey.savings.score).toBe(100);
    expect(byKey.stability.status).toBe('scored');
    expect(byKey.stability.score).toBe(80);
    expect(byKey['forecast-risk'].status).toBe('scored');
    expect(byKey['forecast-risk'].score).toBe(90);

    expect(body.overall.status).toBe('scored');
    expect(body.overall.score).toBe(95);
    expect(body.overall.classification).toBe('EXCELLENT');
    expect(body.overall.availableWeight).toBe(100);
    expect(body.overall.explanation).toContain('95/100');
    expect(body.recommendations).toEqual([]);
    expect(body.dataQuality.monthsWithData).toBe(6);
    expect(body.dataQuality.completeMonthsConsidered).toBe(12);
    expect(body.dataQuality.scoredGroups).toBe(5);
  });

  it('scores a struggling profile and returns actionable, evidence-based advice', async () => {
    const body = await health(bob.agent, { currency: 'VND' });
    const byKey = Object.fromEntries(body.groups.map((group) => [group.key, group]));

    expect(byKey['cash-flow'].score).toBe(20);
    expect(byKey.budget.score).toBe(0);
    expect(byKey.savings.score).toBe(0);
    expect(byKey.stability.score).toBe(0);
    expect(byKey['forecast-risk'].score).toBe(0);
    expect(body.overall.status).toBe('scored');
    expect(body.overall.score).toBe(5);
    expect(body.overall.classification).toBe('NEEDS_ATTENTION');

    const ids = body.recommendations.map((item) => item.id);
    expect(ids).toContain('cash-flow-savings-rate');
    expect(ids).toContain('budget-exceeded');
    expect(ids).toContain('savings-overdue');
    expect(ids).toContain('stability-emergency-fund');
    expect(ids).toContain('forecast-negative');
    expect(body.recommendations.every((item) => item.requiresConfirmation)).toBe(true);
    expect(body.recommendations.every((item) => item.impact.length > 0)).toBe(true);
    expect(body.recommendations.every((item) => item.module.length > 0)).toBe(true);
    expect(body.recommendations[0].severity).toBe('high');
  });

  it('withholds the total when fewer than three groups have data', async () => {
    const body = await health(carol.agent, { currency: 'VND' });
    const byKey = Object.fromEntries(body.groups.map((group) => [group.key, group]));

    expect(byKey['cash-flow'].status).toBe('insufficient_data');
    expect(byKey['cash-flow'].score).toBeNull();
    expect(byKey.stability.status).toBe('insufficient_data');
    expect(byKey['forecast-risk'].status).toBe('insufficient_data');
    // These two are measured, not gaps: they keep real scores even though the
    // profile as a whole has too little data for a total.
    expect(byKey.budget.score).toBe(100);
    expect(byKey.savings.status).toBe('scored');
    expect(byKey.savings.score).toBe(50);

    expect(body.overall.status).toBe('insufficient_data');
    expect(body.overall.score).toBeNull();
    expect(body.overall.classification).toBe('INSUFFICIENT_DATA');
    expect(body.overall.availableWeight).toBe(40);
  });

  it('isolates currencies instead of mixing them', async () => {
    const body = await health(alice.agent, { currency: 'USD' });
    const byKey = Object.fromEntries(body.groups.map((group) => [group.key, group]));
    expect(body.currency).toBe('USD');
    expect(byKey['cash-flow'].score).toBeNull();
    // Budgets carry no currency: M3b reads the limit in the requested currency,
    // so the month's budget still applies while spending is USD-only (zero).
    expect(byKey.budget.score).toBe(100);
    expect(byKey.savings.score).toBeNull();
    expect(byKey.stability.score).toBeNull();
    expect(byKey['forecast-risk'].score).toBeNull();
    expect(body.overall.status).toBe('insufficient_data');
    expect(body.dataQuality.monthsWithData).toBe(0);
  });

  it('never lets one owner read another owner data', async () => {
    const body = await health(carol.agent, { currency: 'VND' });
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain('Mục tiêu riêng của Alice');
    expect(body.dataQuality.transactionCount).toBe(0);
    // Carol has exactly her own single budget, not Alice's four.
    const budgetGroup = body.groups.find((group) => group.key === 'budget');
    expect(budgetGroup?.evidence.find((item) => item.key === 'budgets')?.value).toBe('1');
  });

  it('returns a breakdown that matches the score and explains missing groups', async () => {
    const body = (await alice.agent.get(`${BASE}/breakdown`).query({ currency: 'VND' }).expect(200))
      .body as FinancialHealthBreakdownDto;
    expect(body.availableWeight).toBe(100);
    expect(body.contributions).toHaveLength(5);
    expect(body.contributions.reduce((sum, item) => sum + item.contribution, 0)).toBeCloseTo(
      body.overall.weightedScore as number,
      1,
    );
    expect(body.missingGroups).toEqual([]);
    expect(body.formula).toContain('Điểm tổng');
    expect(body.recommendations).toEqual([]);

    const carolBody = (
      await carol.agent.get(`${BASE}/breakdown`).query({ currency: 'VND' }).expect(200)
    ).body as FinancialHealthBreakdownDto;
    expect(carolBody.overall.status).toBe('insufficient_data');
    expect(carolBody.missingGroups.map((item) => item.group)).toEqual([
      'cash-flow',
      'stability',
      'forecast-risk',
    ]);
    expect(carolBody.missingGroups.every((item) => item.reason.length > 0)).toBe(true);
  });

  it('recomputes cash-flow and budget history for complete months only', async () => {
    const body = (
      await alice.agent.get(`${BASE}/history`).query({ currency: 'VND', months: '3' }).expect(200)
    ).body as FinancialHealthHistoryDto;

    expect(body.method).toBe('recomputed');
    expect(body.availableGroups).toEqual(['cash-flow', 'budget']);
    expect(body.overall).toBeNull();
    expect(body.months).toHaveLength(3);
    expect(body.months[0].month).toBe(monthsAgo(3));
    expect(body.months[2].month).toBe(monthsAgo(1));
    for (const point of body.months) {
      expect(point.cashFlow.status).toBe('scored');
      expect(point.cashFlow.score).toBe(100);
      expect(point.budget.status).toBe('scored');
      expect(point.hasTransactions).toBe(true);
    }
    expect(body.limitations.join(' ')).toContain('Dòng tiền');

    const one = (
      await alice.agent.get(`${BASE}/history`).query({ currency: 'VND', months: '1' }).expect(200)
    ).body as FinancialHealthHistoryDto;
    expect(one.months).toHaveLength(1);
  });

  it('is deterministic and does not mutate any data', async () => {
    const before = {
      transactions: await prisma.transaction.count({ where: { userId: alice.id } }),
      accounts: await prisma.account.findMany({
        where: { userId: alice.id },
        select: { id: true, updatedAt: true, initialBalance: true },
        orderBy: { id: 'asc' },
      }),
      budgets: await prisma.budget.count({ where: { userId: alice.id } }),
      goals: await prisma.savingsGoal.count({ where: { userId: alice.id } }),
    };

    const first = await health(alice.agent, { currency: 'VND' });
    const second = await health(alice.agent, { currency: 'VND' });

    expect({ ...first, generatedAt: '' }).toEqual({ ...second, generatedAt: '' });

    const after = {
      transactions: await prisma.transaction.count({ where: { userId: alice.id } }),
      accounts: await prisma.account.findMany({
        where: { userId: alice.id },
        select: { id: true, updatedAt: true, initialBalance: true },
        orderBy: { id: 'asc' },
      }),
      budgets: await prisma.budget.count({ where: { userId: alice.id } }),
      goals: await prisma.savingsGoal.count({ where: { userId: alice.id } }),
    };
    expect(after).toEqual(before);
  });

  it('rejects invalid currency and history length', async () => {
    await alice.agent.get(BASE).query({ currency: 'US' }).expect(400);
    await alice.agent.get(`${BASE}/breakdown`).query({ currency: '' }).expect(400);
    await alice.agent.get(`${BASE}/history`).query({ months: '0' }).expect(400);
    await alice.agent.get(`${BASE}/history`).query({ months: '13' }).expect(400);
    await alice.agent.get(`${BASE}/history`).query({ months: 'abc' }).expect(400);
  });

  it('requires authentication', async () => {
    await request(app.getHttpServer()).get(BASE).expect(401);
    await request(app.getHttpServer()).get(`${BASE}/history`).expect(401);
  });
});
