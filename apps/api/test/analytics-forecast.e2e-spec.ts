import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { DateTime } from 'luxon';
import request from 'supertest';
import type { SuperAgentTest } from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { ACCESS_TOKEN_COOKIE } from '../src/common/guards/jwt-auth.guard';
import { AuthService } from '../src/modules/auth/auth.service';

const TZ = 'Asia/Ho_Chi_Minh';
const BASE = '/api/v1/analytics/forecast';

interface ForecastSeries {
  kind: 'income' | 'expense';
  status: 'ok' | 'insufficient_data';
  reason: string | null;
  model: string | null;
  modelScores: {
    model: string;
    eligible: boolean;
    origins: number;
    mae: string | null;
    wapePercent: number | null;
  }[];
  selectedBecause: string | null;
  confidence: { level: string; score: number; basis: string[] };
  monthlyAverage: string | null;
  monthsWithData: number;
  history: { month: string; amount: string; hasTransactions: boolean }[];
  months: { month: string; amount: string; isPartial: boolean }[];
  horizonTotal: string | null;
}

interface ForecastBody {
  currency: string;
  timezone: string;
  asOf: string;
  generatedAt: string;
  horizon: string;
  horizonMonths: string[];
  status: 'ok' | 'insufficient_data';
  reason: string | null;
  income: ForecastSeries;
  expense: ForecastSeries;
  categoryForecasts: {
    categoryId: string | null;
    categoryName: string;
    status: string;
    model: string | null;
    confidence: string;
    monthsWithData: number;
    monthlyAverage: string | null;
    months: { month: string; amount: string; isPartial: boolean }[];
    horizonTotal: string | null;
  }[];
  net: {
    status: string;
    reason: string | null;
    model: string | null;
    base: string | null;
    best: string | null;
    worst: string | null;
    bandMethod: string | null;
  };
  monthEndBalance: {
    status: string;
    reason: string | null;
    currentBalance: string | null;
    remainingIncome: string | null;
    remainingExpense: string | null;
    projectedBalance: string | null;
    accountsIncluded: number;
    accountsArchived: number;
    transfersNetted: boolean;
  };
  dataQuality: {
    completeMonthsConsidered: number;
    monthsWithData: number;
    missingMonths: string[];
    transactionCount: number;
    continuityPercent: number;
    level: string;
  };
  assumptions: string[];
  limitations: string[];
  estimated: boolean;
}

interface Session {
  id: string;
  agent: SuperAgentTest;
}

async function createSession(
  application: NestExpressApplication,
  service: AuthService,
  email: string,
  displayName: string,
): Promise<Session> {
  const user = await service.register({ email, password: 'Password123!', displayName });
  const token = await service.issueAccessToken(user);
  const agent = request.agent(application.getHttpServer()) as unknown as SuperAgentTest;
  const jar = (agent as unknown as { jar: { setCookie(cookie: string): void } }).jar;
  jar.setCookie(`${ACCESS_TOKEN_COOKIE}=${token}; Path=/`);
  return { id: user.id, agent };
}

/**
 * Financial forecasting (M3c) against the isolated test database.
 *
 * Fixtures are built relative to the run's local month so the twelve-month
 * window, the current-month remainder and the month-end balance are exercised
 * with real data. Nothing is mocked: this is the actual service, Prisma and DB.
 */
describe('Financial forecasting API (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let authService: AuthService;

  const stamp = `${Date.now()}.${Math.floor(Math.random() * 1e6)}`;
  const now = DateTime.now().setZone(TZ);
  const currentMonth = now.toFormat('yyyy-MM');

  function monthsAgo(count: number): string {
    return now.minus({ months: count }).toFormat('yyyy-MM');
  }

  function instantOf(month: string): Date {
    return DateTime.fromFormat(`${month}-15 12:00`, 'yyyy-MM-dd HH:mm', { zone: TZ })
      .toUTC()
      .toJSDate();
  }

  function nextMonth(month: string): string {
    return DateTime.fromFormat(`${month}-01`, 'yyyy-MM-dd', { zone: TZ })
      .plus({ months: 1 })
      .toFormat('yyyy-MM');
  }

  function transaction(input: {
    userId: string;
    accountId: string;
    type: 'INCOME' | 'EXPENSE' | 'TRANSFER';
    amount: string;
    currency?: string;
    occurredAt: Date;
    categoryId?: string | null;
    transferGroupId?: string;
    transferDirection?: 'OUT' | 'IN';
  }) {
    return prisma.transaction.create({
      data: {
        userId: input.userId,
        accountId: input.accountId,
        type: input.type,
        amount: new Prisma.Decimal(input.amount),
        currency: input.currency ?? 'VND',
        description: 'Giao dịch kiểm thử M3c',
        occurredAt: input.occurredAt,
        categoryId: input.categoryId ?? null,
        transferGroupId: input.transferGroupId ?? null,
        transferDirection: input.transferDirection ?? null,
      },
    });
  }

  function account(input: {
    userId: string;
    name: string;
    initialBalance?: string;
    currency?: string;
    isArchived?: boolean;
  }) {
    return prisma.account.create({
      data: {
        userId: input.userId,
        name: input.name,
        type: 'CASH',
        currency: input.currency ?? 'VND',
        initialBalance: new Prisma.Decimal(input.initialBalance ?? '0'),
        isArchived: input.isArchived ?? false,
      },
    });
  }

  function category(userId: string, name: string, type: 'INCOME' | 'EXPENSE') {
    return prisma.category.create({ data: { userId, name, type } });
  }

  async function getForecast(
    agent: SuperAgentTest,
    query: Record<string, string> = {},
  ): Promise<ForecastBody> {
    const response = await agent.get(BASE).query(query).expect(200);
    return response.body as ForecastBody;
  }

  async function seedAlice() {
    const session = await createSession(
      app,
      authService,
      `forecast.alice.${stamp}@example.com`,
      'Alice Forecast',
    );
    const main = await account({ userId: session.id, name: 'Tiền mặt', initialBalance: '5000000' });
    const savings = await account({ userId: session.id, name: 'Tiết kiệm' });
    const archived = await account({
      userId: session.id,
      name: 'Tài khoản cũ',
      initialBalance: '200000',
      isArchived: true,
    });
    const usd = await account({
      userId: session.id,
      name: 'USD',
      currency: 'USD',
      initialBalance: '1000000',
    });
    const salary = await category(session.id, 'Lương', 'INCOME');
    const food = await category(session.id, 'Ăn uống', 'EXPENSE');
    const transport = await category(session.id, 'Đi lại', 'EXPENSE');
    const other = await category(session.id, 'Khác', 'EXPENSE');
    const oneOff = await category(session.id, 'Một lần', 'EXPENSE');

    // Six complete months of flat data: income 10,000,000, expense 3,000,000.
    for (let ago = 6; ago >= 1; ago -= 1) {
      const month = monthsAgo(ago);
      const at = instantOf(month);
      await transaction({
        userId: session.id,
        accountId: main.id,
        type: 'INCOME',
        amount: '10000000.00',
        occurredAt: at,
        categoryId: salary.id,
      });
      await transaction({
        userId: session.id,
        accountId: main.id,
        type: 'EXPENSE',
        amount: '1500000.00',
        occurredAt: at,
        categoryId: food.id,
      });
      await transaction({
        userId: session.id,
        accountId: main.id,
        type: 'EXPENSE',
        amount: '1000000.00',
        occurredAt: at,
        categoryId: transport.id,
      });
      if (ago === 1) {
        // Same monthly total, but a category that exists in a single month only.
        await transaction({
          userId: session.id,
          accountId: main.id,
          type: 'EXPENSE',
          amount: '300000.00',
          occurredAt: at,
          categoryId: other.id,
        });
        await transaction({
          userId: session.id,
          accountId: main.id,
          type: 'EXPENSE',
          amount: '200000.00',
          occurredAt: at,
          categoryId: oneOff.id,
        });
      } else {
        await transaction({
          userId: session.id,
          accountId: main.id,
          type: 'EXPENSE',
          amount: '500000.00',
          occurredAt: at,
          categoryId: other.id,
        });
      }
    }

    // Current month so far: income 2,000,000; expense 1,000,000.
    const moment = DateTime.now().setZone(TZ).toJSDate();
    await transaction({
      userId: session.id,
      accountId: main.id,
      type: 'INCOME',
      amount: '2000000.00',
      occurredAt: moment,
      categoryId: salary.id,
    });
    await transaction({
      userId: session.id,
      accountId: main.id,
      type: 'EXPENSE',
      amount: '400000.00',
      occurredAt: moment,
      categoryId: food.id,
    });
    await transaction({
      userId: session.id,
      accountId: main.id,
      type: 'EXPENSE',
      amount: '200000.00',
      occurredAt: moment,
      categoryId: transport.id,
    });
    await transaction({
      userId: session.id,
      accountId: main.id,
      type: 'EXPENSE',
      amount: '400000.00',
      occurredAt: moment,
      categoryId: other.id,
    });

    // Internal transfer: moves 1,000,000 between two same-currency accounts.
    const transferGroupId = randomUUID();
    await transaction({
      userId: session.id,
      accountId: main.id,
      type: 'TRANSFER',
      amount: '1000000.00',
      occurredAt: moment,
      transferGroupId,
      transferDirection: 'OUT',
    });
    await transaction({
      userId: session.id,
      accountId: savings.id,
      type: 'TRANSFER',
      amount: '1000000.00',
      occurredAt: moment,
      transferGroupId,
      transferDirection: 'IN',
    });

    // USD rows must never leak into the VND forecast.
    await transaction({
      userId: session.id,
      accountId: usd.id,
      type: 'INCOME',
      amount: '3000000.00',
      currency: 'USD',
      occurredAt: moment,
    });
    await transaction({
      userId: session.id,
      accountId: usd.id,
      type: 'EXPENSE',
      amount: '9000000.00',
      currency: 'USD',
      occurredAt: moment,
    });

    return { ...session, main, savings, archived, usd };
  }

  let alice: Awaited<ReturnType<typeof seedAlice>>;
  let bob: Session;
  let dave: Session;
  let erin: Session;
  let frank: Session;
  let gina: Session;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false });
    configureApp(app);
    await app.init();

    prisma = app.get(PrismaService);
    authService = app.get(AuthService);

    alice = await seedAlice();

    // Bob: separate VND and USD histories, no cross-currency mixing.
    bob = await createSession(
      app,
      authService,
      `forecast.bob.${stamp}@example.com`,
      'Bob Forecast',
    );
    const bobVnd = await account({ userId: bob.id, name: 'VND' });
    const bobUsd = await account({ userId: bob.id, name: 'USD', currency: 'USD' });
    const bobSalary = await category(bob.id, 'Thu nhập', 'INCOME');
    const bobSpend = await category(bob.id, 'Chi tiêu', 'EXPENSE');
    for (let ago = 3; ago >= 1; ago -= 1) {
      const at = instantOf(monthsAgo(ago));
      await transaction({
        userId: bob.id,
        accountId: bobVnd.id,
        type: 'INCOME',
        amount: '20000000.00',
        occurredAt: at,
        categoryId: bobSalary.id,
      });
      await transaction({
        userId: bob.id,
        accountId: bobVnd.id,
        type: 'EXPENSE',
        amount: '5000000.00',
        occurredAt: at,
        categoryId: bobSpend.id,
      });
      await transaction({
        userId: bob.id,
        accountId: bobUsd.id,
        type: 'INCOME',
        amount: '1000.00',
        currency: 'USD',
        occurredAt: at,
      });
      await transaction({
        userId: bob.id,
        accountId: bobUsd.id,
        type: 'EXPENSE',
        amount: '400.00',
        currency: 'USD',
        occurredAt: at,
      });
    }

    dave = await createSession(
      app,
      authService,
      `forecast.dave.${stamp}@example.com`,
      'Dave Empty',
    );

    erin = await createSession(
      app,
      authService,
      `forecast.erin.${stamp}@example.com`,
      'Erin No Income',
    );
    const erinAccount = await account({ userId: erin.id, name: 'Chi tiêu' });
    for (let ago = 3; ago >= 1; ago -= 1) {
      await transaction({
        userId: erin.id,
        accountId: erinAccount.id,
        type: 'EXPENSE',
        amount: '100.00',
        occurredAt: instantOf(monthsAgo(ago)),
      });
    }

    frank = await createSession(
      app,
      authService,
      `forecast.frank.${stamp}@example.com`,
      'Frank Short',
    );
    const frankAccount = await account({ userId: frank.id, name: 'Ngắn' });
    for (let ago = 2; ago >= 1; ago -= 1) {
      await transaction({
        userId: frank.id,
        accountId: frankAccount.id,
        type: 'INCOME',
        amount: '1000.00',
        occurredAt: instantOf(monthsAgo(ago)),
      });
      await transaction({
        userId: frank.id,
        accountId: frankAccount.id,
        type: 'EXPENSE',
        amount: '400.00',
        occurredAt: instantOf(monthsAgo(ago)),
      });
    }

    // Gina: a transaction exactly at the local start of a month, used to prove
    // bucketing follows the user's timezone.
    gina = await createSession(app, authService, `forecast.gina.${stamp}@example.com`, 'Gina Zone');
    const ginaAccount = await account({ userId: gina.id, name: 'Múi giờ' });
    for (const ago of [4, 3, 2]) {
      await transaction({
        userId: gina.id,
        accountId: ginaAccount.id,
        type: 'INCOME',
        amount: '5000000.00',
        occurredAt: instantOf(monthsAgo(ago)),
      });
      await transaction({
        userId: gina.id,
        accountId: ginaAccount.id,
        type: 'EXPENSE',
        amount: '1000000.00',
        occurredAt: instantOf(monthsAgo(ago)),
      });
    }
    const boundaryMonth = monthsAgo(1);
    const boundaryInstant = DateTime.fromFormat(`${boundaryMonth}-01`, 'yyyy-MM-dd', {
      zone: TZ,
    }).toUTC();
    await transaction({
      userId: gina.id,
      accountId: ginaAccount.id,
      type: 'EXPENSE',
      amount: '250000.00',
      occurredAt: boundaryInstant.toJSDate(),
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects anonymous access', async () => {
    await request(app.getHttpServer()).get(BASE).expect(401);
  });

  it('returns a forecast with model, confidence, backtest and data quality', async () => {
    const body = await getForecast(alice.agent);

    expect(body.currency).toBe('VND');
    expect(body.timezone).toBe(TZ);
    expect(body.horizon).toBe('current_month');
    expect(body.horizonMonths).toEqual([currentMonth]);
    expect(body.status).toBe('ok');
    expect(body.estimated).toBe(true);
    expect(body.assumptions.length).toBeGreaterThan(0);
    expect(body.assumptions.join(' ')).toMatch(/không dùng AI/);
    expect(body.limitations.length).toBeGreaterThan(0);

    expect(body.income.status).toBe('ok');
    expect(body.income.model).toBe('historical_average');
    expect(body.income.monthlyAverage).toBe('10000000.00');
    expect(body.income.confidence.level).toBe('high');
    expect(body.income.confidence.score).toBeGreaterThanOrEqual(70);
    expect(body.income.modelScores.length).toBe(3);
    expect(body.income.modelScores.every((score) => score.mae === '0.00')).toBe(true);

    expect(body.expense.status).toBe('ok');
    expect(body.expense.model).toBe('historical_average');
    expect(body.expense.monthlyAverage).toBe('3000000.00');
    expect(body.expense.history).toHaveLength(12);
    expect(body.expense.history.filter((point) => point.hasTransactions)).toHaveLength(6);
    expect(body.expense.history.find((point) => point.month === monthsAgo(6))?.amount).toBe(
      '3000000.00',
    );
    expect(
      body.expense.history.find((point) => point.month === monthsAgo(12))?.hasTransactions,
    ).toBe(false);

    expect(body.dataQuality.completeMonthsConsidered).toBe(12);
    expect(body.dataQuality.monthsWithData).toBe(6);
    expect(body.dataQuality.missingMonths).toHaveLength(6);
    expect(body.dataQuality.transactionCount).toBe(25);
    expect(body.dataQuality.continuityPercent).toBe(50);
    expect(body.dataQuality.level).toBe('limited');
  });

  it('forecasts only the remaining current month and labels it partial', async () => {
    const body = await getForecast(alice.agent);

    expect(body.income.months).toEqual([
      { month: currentMonth, amount: '8000000.00', isPartial: true },
    ]);
    expect(body.expense.months).toEqual([
      { month: currentMonth, amount: '2000000.00', isPartial: true },
    ]);
    expect(body.income.horizonTotal).toBe('8000000.00');
    expect(body.expense.horizonTotal).toBe('2000000.00');
    expect(body.net.status).toBe('ok');
    expect(body.net.base).toBe('6000000.00');
    expect(body.net.best).toBe('6000000.00');
    expect(body.net.worst).toBe('6000000.00');
    expect(body.net.bandMethod).toBe('mae');
  });

  it('computes month-end balance from current balance, transfers netted and remaining flows', async () => {
    const body = await getForecast(alice.agent);

    // 5,000,000 + 200,000 opening; 62,000,000 income; 19,000,000 expense;
    // the 1,000,000 transfer pair cancels out. USD account excluded by currency.
    expect(body.monthEndBalance.status).toBe('ok');
    expect(body.monthEndBalance.currentBalance).toBe('48200000.00');
    expect(body.monthEndBalance.remainingIncome).toBe('8000000.00');
    expect(body.monthEndBalance.remainingExpense).toBe('2000000.00');
    expect(body.monthEndBalance.projectedBalance).toBe('54200000.00');
    expect(body.monthEndBalance.accountsIncluded).toBe(3);
    expect(body.monthEndBalance.accountsArchived).toBe(1);
    expect(body.monthEndBalance.transfersNetted).toBe(true);
  });

  it('forecasts per-category expenses only for categories with enough history', async () => {
    const body = await getForecast(alice.agent);

    expect(body.categoryForecasts.map((item) => item.categoryName)).toEqual([
      'Ăn uống',
      'Đi lại',
      'Khác',
    ]);
    const food = body.categoryForecasts[0];
    expect(food.status).toBe('ok');
    expect(food.monthlyAverage).toBe('1500000.00');
    expect(food.months).toEqual([{ month: currentMonth, amount: '1100000.00', isPartial: true }]);
    const transport = body.categoryForecasts[1];
    expect(transport.months).toEqual([
      { month: currentMonth, amount: '800000.00', isPartial: true },
    ]);
  });

  it('supports the 3-month horizon without subtracting month-to-date', async () => {
    const body = await getForecast(alice.agent, { horizon: '3m' });
    const expected = [
      nextMonth(currentMonth),
      nextMonth(nextMonth(currentMonth)),
      nextMonth(nextMonth(nextMonth(currentMonth))),
    ];

    expect(body.horizon).toBe('3m');
    expect(body.horizonMonths).toEqual(expected);
    expect(body.income.months).toEqual(
      expected.map((month) => ({ month, amount: '10000000.00', isPartial: false })),
    );
    expect(body.expense.months).toEqual(
      expected.map((month) => ({ month, amount: '3000000.00', isPartial: false })),
    );
    expect(body.income.horizonTotal).toBe('30000000.00');
    expect(body.expense.horizonTotal).toBe('9000000.00');
    expect(body.net.base).toBe('21000000.00');
    // The balance always refers to the current month's remainder.
    expect(body.monthEndBalance.projectedBalance).toBe('54200000.00');
  });

  it('exposes income, expenses and cash-flow slices consistently', async () => {
    const full = await getForecast(alice.agent);
    const income = (await alice.agent.get(`${BASE}/income`).expect(200)).body;
    const expenses = (await alice.agent.get(`${BASE}/expenses`).expect(200)).body;
    const cashFlow = (await alice.agent.get(`${BASE}/cash-flow`).expect(200)).body;

    expect(income.slice).toBe('income');
    expect(income.income).toEqual(full.income);
    expect(income.currency).toBe(full.currency);

    expect(expenses.slice).toBe('expenses');
    expect(expenses.expense).toEqual(full.expense);
    expect(expenses.categoryForecasts).toEqual(full.categoryForecasts);

    expect(cashFlow.slice).toBe('cash-flow');
    expect(cashFlow.net).toEqual(full.net);
    expect(cashFlow.monthEndBalance).toEqual(full.monthEndBalance);
  });

  it('isolates currencies and never converts between them', async () => {
    const vnd = await getForecast(bob.agent);
    expect(vnd.currency).toBe('VND');
    expect(vnd.income.monthlyAverage).toBe('20000000.00');
    expect(vnd.expense.monthlyAverage).toBe('5000000.00');
    expect(vnd.monthEndBalance.currentBalance).toBe('45000000.00');

    const usd = await getForecast(bob.agent, { currency: 'usd' });
    expect(usd.currency).toBe('USD');
    expect(usd.income.monthlyAverage).toBe('1000.00');
    expect(usd.expense.monthlyAverage).toBe('400.00');
    expect(usd.income.months).toEqual([
      { month: currentMonth, amount: '1000.00', isPartial: true },
    ]);
    expect(usd.monthEndBalance.currentBalance).toBe('1800.00');
    expect(usd.monthEndBalance.projectedBalance).toBe('2400.00');
  });

  it('withholds forecasts when a user has no data or no accounts', async () => {
    const body = await getForecast(dave.agent);

    expect(body.status).toBe('insufficient_data');
    expect(body.reason).toBe('no_complete_months');
    expect(body.income.months).toEqual([]);
    expect(body.expense.months).toEqual([]);
    expect(body.income.horizonTotal).toBeNull();
    expect(body.net.status).toBe('insufficient_data');
    expect(body.net.base).toBeNull();
    expect(body.dataQuality.level).toBe('insufficient');
    expect(body.monthEndBalance.status).toBe('insufficient_data');
    expect(body.monthEndBalance.reason).toBe('no_accounts');
    expect(body.monthEndBalance.currentBalance).toBeNull();
  });

  it('reports a missing income series instead of inventing income', async () => {
    const body = await getForecast(erin.agent);

    expect(body.status).toBe('insufficient_data');
    expect(body.reason).toBe('no_income');
    expect(body.income.status).toBe('insufficient_data');
    expect(body.income.reason).toBe('no_income');
    expect(body.income.months).toEqual([]);
    expect(body.expense.status).toBe('ok');
    expect(body.net.base).toBeNull();
    expect(body.monthEndBalance.status).toBe('insufficient_data');
    expect(body.monthEndBalance.reason).toBe('missing_series');
    expect(body.monthEndBalance.currentBalance).toBe('-300.00');
  });

  it('withholds a forecast with fewer than three months of history', async () => {
    const body = await getForecast(frank.agent);
    expect(body.status).toBe('insufficient_data');
    expect(body.reason).toBe('too_few_months');
    expect(body.income.reason).toBe('too_few_months');
    expect(body.expense.reason).toBe('too_few_months');
    expect(body.income.months).toEqual([]);
    expect(body.expense.months).toEqual([]);
  });

  it('buckets transactions by the user timezone', async () => {
    const boundaryMonth = monthsAgo(1);
    const beforeBoundary = monthsAgo(2);
    const hcm = await getForecast(gina.agent);

    expect(hcm.timezone).toBe(TZ);
    expect(hcm.status).toBe('ok');
    expect(hcm.expense.history.find((point) => point.month === boundaryMonth)?.amount).toBe(
      '250000.00',
    );
    expect(hcm.expense.history.find((point) => point.month === beforeBoundary)?.amount).toBe(
      '1000000.00',
    );

    await prisma.user.update({ where: { id: gina.id }, data: { timezone: 'UTC' } });
    const utc = await getForecast(gina.agent);

    expect(utc.timezone).toBe('UTC');
    expect(utc.status).toBe('ok');
    expect(
      utc.expense.history.find((point) => point.month === boundaryMonth)?.hasTransactions,
    ).toBe(false);
    expect(utc.expense.history.find((point) => point.month === beforeBoundary)?.amount).toBe(
      '1250000.00',
    );

    // An invalid stored timezone falls back to the app default instead of failing.
    await prisma.user.update({ where: { id: gina.id }, data: { timezone: 'Not/AZone' } });
    const fallback = await getForecast(gina.agent);
    expect(fallback.timezone).toBe(TZ);
    expect(fallback.status).toBe('ok');
  });

  it('caches identical requests and invalidates on new data without mutating anything', async () => {
    const countBefore = await prisma.transaction.count({ where: { userId: alice.id } });
    const first = await getForecast(alice.agent);
    const second = await getForecast(alice.agent);
    expect(second.generatedAt).toBe(first.generatedAt);

    const countAfterReads = await prisma.transaction.count({ where: { userId: alice.id } });
    expect(countAfterReads).toBe(countBefore);

    // A new current-month expense changes the fingerprint: the next response
    // must be recomputed, with a smaller remainder and current balance.
    await transaction({
      userId: alice.id,
      accountId: alice.main.id,
      type: 'EXPENSE',
      amount: '100000.00',
      occurredAt: DateTime.now().setZone(TZ).toJSDate(),
      categoryId: bodyCategoryId(first),
    });
    const third = await getForecast(alice.agent);

    expect(third.expense.months[0].amount).toBe('1900000.00');
    expect(third.monthEndBalance.currentBalance).toBe('48100000.00');
    expect(third.monthEndBalance.projectedBalance).toBe('54200000.00');
    // The new row is in the current month, so the completed-month count is stable.
    expect(third.dataQuality.transactionCount).toBe(first.dataQuality.transactionCount);
  });

  function bodyCategoryId(body: ForecastBody): string {
    const food = body.categoryForecasts.find((item) => item.categoryName === 'Ăn uống');
    if (!food?.categoryId) throw new Error('Food category missing from forecast');
    return food.categoryId;
  }

  it('rejects invalid query parameters', async () => {
    await alice.agent.get(BASE).query({ horizon: '2y' }).expect(400);
    await alice.agent.get(BASE).query({ currency: 'VN' }).expect(400);
    await alice.agent.get(BASE).query({ currency: 'EURO' }).expect(400);
  });

  it('does not change balances while forecasting', async () => {
    const before = await prisma.account.findMany({
      where: { userId: alice.id },
      select: { id: true, initialBalance: true, updatedAt: true },
      orderBy: { id: 'asc' },
    });
    await getForecast(alice.agent, { horizon: '6m' });
    await alice.agent.get(`${BASE}/cash-flow`).expect(200);
    const after = await prisma.account.findMany({
      where: { userId: alice.id },
      select: { id: true, initialBalance: true, updatedAt: true },
      orderBy: { id: 'asc' },
    });
    expect(after).toEqual(before);
  });
});
