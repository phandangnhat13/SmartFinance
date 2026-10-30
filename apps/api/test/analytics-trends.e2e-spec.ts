import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import request from 'supertest';
import type { SuperAgentTest } from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { ACCESS_TOKEN_COOKIE } from '../src/common/guards/jwt-auth.guard';
import { AuthService } from '../src/modules/auth/auth.service';

interface UserState {
  id: string;
  agent: SuperAgentTest;
  vndAccountId: string;
  savingsAccountId: string;
  usdAccountId: string;
  salaryCategoryId: string;
  foodCategoryId: string;
  transportCategoryId: string;
}

interface PeriodBody {
  label: string;
  from: string;
  to: string;
  status: 'in_progress' | 'complete';
}

interface OverviewBody {
  currency: string;
  timezone: string;
  period: PeriodBody;
  income: string;
  expense: string;
  net: string;
  savingsRate: number | null;
  transactionCount: number;
  hasTransactions: boolean;
  estimated: boolean;
  previous: {
    period: PeriodBody;
    income: string;
    expense: string;
    net: string;
    savingsRate: number | null;
    transactionCount: number;
    hasTransactions: boolean;
  };
  changes: {
    income: { amount: string; percent: number | null };
    expense: { amount: string; percent: number | null };
    net: { amount: string; percent: number | null };
    savingsRatePoints: number | null;
  };
  availableCurrencies: string[];
}

interface TrendsBody {
  currency: string;
  timezone: string;
  rangeMonths: number;
  points: {
    month: string;
    monthStatus: 'in_progress' | 'complete';
    income: string;
    expense: string;
    net: string;
    savingsRate: number | null;
    transactionCount: number;
    hasTransactions: boolean;
  }[];
}

interface IncomeBody {
  total: string;
  averageMonthly: string | null;
  monthsWithIncome: number;
  highest: { month: string; amount: string } | null;
  lowest: { month: string; amount: string } | null;
  points: {
    month: string;
    amount: string;
    hasTransactions: boolean;
    changePercent: number | null;
  }[];
  sources: {
    categoryId: string | null;
    categoryName: string;
    total: string;
    sharePercent: number;
    transactionCount: number;
  }[];
}

interface ExpensesBody {
  total: string;
  averageMonthly: string | null;
  monthsWithExpense: number;
  highest: { month: string; amount: string } | null;
  lowest: { month: string; amount: string } | null;
  volatilityPercent: number | null;
  longestIncreasingStreak: number;
  currentIncreasingStreak: number;
  points: {
    month: string;
    amount: string;
    hasTransactions: boolean;
    changePercent: number | null;
  }[];
}

interface ComparisonBody {
  current: {
    period: PeriodBody;
    income: string;
    expense: string;
    net: string;
    savingsRate: number | null;
    transactionCount: number;
  };
  previous: {
    period: PeriodBody;
    income: string;
    expense: string;
    net: string;
    savingsRate: number | null;
    transactionCount: number;
  };
  changes: {
    income: { amount: string; percent: number | null };
    expense: { amount: string; percent: number | null };
    net: { amount: string; percent: number | null };
    savingsRatePoints: number | null;
  };
  notableCategoryChanges: {
    categoryId: string | null;
    categoryName: string;
    currentTotal: string;
    previousTotal: string;
    changeAmount: string;
    changePercent: number | null;
    direction: 'increase' | 'decrease' | 'new' | 'removed';
  }[];
}

async function createSession(
  application: NestExpressApplication,
  service: AuthService,
  email: string,
  displayName: string,
): Promise<{ id: string; agent: SuperAgentTest }> {
  const user = await service.register({ email, password: 'Password123!', displayName });
  const token = await service.issueAccessToken(user);
  const agent = request.agent(application.getHttpServer()) as unknown as SuperAgentTest;
  const jar = (agent as unknown as { jar: { setCookie(cookie: string): void } }).jar;
  jar.setCookie(`${ACCESS_TOKEN_COOKIE}=${token}; Path=/`);
  return { id: user.id, agent };
}

/**
 * Income/expense trend analytics (M3a) against the isolated test database.
 * Fixtures use fixed calendar dates so the expected figures are exact.
 */
describe('Analytics trends API (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let authService: AuthService;
  let alice: UserState;
  let bob: UserState;
  let carol: UserState;
  const stamp = `${Date.now()}.${Math.floor(Math.random() * 1e6)}`;

  function transaction(input: {
    userId: string;
    accountId: string;
    type: 'INCOME' | 'EXPENSE' | 'TRANSFER';
    amount: string;
    currency: string;
    occurredAt: string;
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
        currency: input.currency,
        description: 'Giao dịch kiểm thử xu hướng',
        occurredAt: new Date(input.occurredAt),
        categoryId: input.categoryId ?? null,
        transferGroupId: input.transferGroupId ?? null,
        transferDirection: input.transferDirection ?? null,
      },
    });
  }

  async function seedUser(email: string, displayName: string): Promise<UserState> {
    const session = await createSession(app, authService, email, displayName);
    const [vnd, savings, usd] = await Promise.all([
      prisma.account.create({
        data: { userId: session.id, name: 'Tiền mặt', type: 'CASH', currency: 'VND' },
      }),
      prisma.account.create({
        data: { userId: session.id, name: 'Tiết kiệm', type: 'BANK', currency: 'VND' },
      }),
      prisma.account.create({
        data: { userId: session.id, name: 'USD', type: 'BANK', currency: 'USD' },
      }),
    ]);
    const [salary, food, transport] = await Promise.all([
      prisma.category.create({
        data: { userId: session.id, name: 'Lương', type: 'INCOME' },
      }),
      prisma.category.create({
        data: { userId: session.id, name: 'Ăn uống', type: 'EXPENSE' },
      }),
      prisma.category.create({
        data: { userId: session.id, name: 'Đi lại', type: 'EXPENSE' },
      }),
    ]);
    return {
      ...session,
      vndAccountId: vnd.id,
      savingsAccountId: savings.id,
      usdAccountId: usd.id,
      salaryCategoryId: salary.id,
      foodCategoryId: food.id,
      transportCategoryId: transport.id,
    };
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false });
    configureApp(app);
    await app.init();

    prisma = app.get(PrismaService);
    authService = app.get(AuthService);

    alice = await seedUser(`trends.alice.${stamp}@example.com`, 'Alice Trends');
    bob = await seedUser(`trends.bob.${stamp}@example.com`, 'Bob Trends');
    carol = await seedUser(`trends.carol.${stamp}@example.com`, 'Carol Trends');

    // Alice — 2023-Q4 baseline: income 8,000,000, expense 3,000,000.
    await transaction({
      userId: alice.id,
      accountId: alice.vndAccountId,
      categoryId: alice.salaryCategoryId,
      type: 'INCOME',
      amount: '4000000.00',
      currency: 'VND',
      occurredAt: '2023-11-05T03:00:00.000Z',
    });
    await transaction({
      userId: alice.id,
      accountId: alice.vndAccountId,
      categoryId: alice.foodCategoryId,
      type: 'EXPENSE',
      amount: '1000000.00',
      currency: 'VND',
      occurredAt: '2023-11-20T03:00:00.000Z',
    });
    await transaction({
      userId: alice.id,
      accountId: alice.vndAccountId,
      categoryId: alice.salaryCategoryId,
      type: 'INCOME',
      amount: '4000000.00',
      currency: 'VND',
      occurredAt: '2023-12-05T03:00:00.000Z',
    });
    await transaction({
      userId: alice.id,
      accountId: alice.vndAccountId,
      categoryId: alice.foodCategoryId,
      type: 'EXPENSE',
      amount: '2000000.00',
      currency: 'VND',
      occurredAt: '2023-12-20T03:00:00.000Z',
    });

    // Alice — 2024-Q1: income 11,000,000, expense 8,000,000.
    await transaction({
      userId: alice.id,
      accountId: alice.vndAccountId,
      categoryId: alice.salaryCategoryId,
      type: 'INCOME',
      amount: '6000000.00',
      currency: 'VND',
      occurredAt: '2024-01-05T03:00:00.000Z',
    });
    await transaction({
      userId: alice.id,
      accountId: alice.vndAccountId,
      categoryId: alice.foodCategoryId,
      type: 'EXPENSE',
      amount: '1000000.00',
      currency: 'VND',
      occurredAt: '2024-01-10T03:00:00.000Z',
    });
    await transaction({
      userId: alice.id,
      accountId: alice.vndAccountId,
      categoryId: alice.transportCategoryId,
      type: 'EXPENSE',
      amount: '500000.00',
      currency: 'VND',
      occurredAt: '2024-01-20T03:00:00.000Z',
    });
    // Internal transfer pair — never income or expense.
    const transferGroupId = '22222222-3333-4444-8555-666666666666';
    await transaction({
      userId: alice.id,
      accountId: alice.vndAccountId,
      type: 'TRANSFER',
      amount: '2000000.00',
      currency: 'VND',
      occurredAt: '2024-01-15T03:00:00.000Z',
      transferGroupId,
      transferDirection: 'OUT',
    });
    await transaction({
      userId: alice.id,
      accountId: alice.savingsAccountId,
      type: 'TRANSFER',
      amount: '2000000.00',
      currency: 'VND',
      occurredAt: '2024-01-15T03:00:00.000Z',
      transferGroupId,
      transferDirection: 'IN',
    });
    // USD income — must never be added to the VND totals.
    await transaction({
      userId: alice.id,
      accountId: alice.usdAccountId,
      categoryId: alice.salaryCategoryId,
      type: 'INCOME',
      amount: '1000.00',
      currency: 'USD',
      occurredAt: '2024-01-12T03:00:00.000Z',
    });

    await transaction({
      userId: alice.id,
      accountId: alice.vndAccountId,
      categoryId: alice.salaryCategoryId,
      type: 'INCOME',
      amount: '5000000.00',
      currency: 'VND',
      occurredAt: '2024-02-05T03:00:00.000Z',
    });
    await transaction({
      userId: alice.id,
      accountId: alice.vndAccountId,
      categoryId: alice.foodCategoryId,
      type: 'EXPENSE',
      amount: '2000000.00',
      currency: 'VND',
      occurredAt: '2024-02-10T03:00:00.000Z',
    });
    await transaction({
      userId: alice.id,
      accountId: alice.vndAccountId,
      categoryId: alice.transportCategoryId,
      type: 'EXPENSE',
      amount: '500000.00',
      currency: 'VND',
      occurredAt: '2024-02-20T03:00:00.000Z',
    });

    // March has spending but no income, so its savings rate must be null.
    await transaction({
      userId: alice.id,
      accountId: alice.vndAccountId,
      categoryId: alice.foodCategoryId,
      type: 'EXPENSE',
      amount: '3000000.00',
      currency: 'VND',
      occurredAt: '2024-03-10T03:00:00.000Z',
    });
    await transaction({
      userId: alice.id,
      accountId: alice.vndAccountId,
      categoryId: alice.transportCategoryId,
      type: 'EXPENSE',
      amount: '1000000.00',
      currency: 'VND',
      occurredAt: '2024-03-20T03:00:00.000Z',
    });

    // Bob has his own figures; Alice's responses must never include them.
    await transaction({
      userId: bob.id,
      accountId: bob.vndAccountId,
      categoryId: bob.salaryCategoryId,
      type: 'INCOME',
      amount: '9000000.00',
      currency: 'VND',
      occurredAt: '2024-01-05T03:00:00.000Z',
    });
    await transaction({
      userId: bob.id,
      accountId: bob.vndAccountId,
      categoryId: bob.foodCategoryId,
      type: 'EXPENSE',
      amount: '1000000.00',
      currency: 'VND',
      occurredAt: '2024-03-05T03:00:00.000Z',
    });

    // Carol exercises the local-midnight boundary.
    // 2024-03-31 23:59:59 HCM (UTC+7) belongs to March.
    await transaction({
      userId: carol.id,
      accountId: carol.vndAccountId,
      categoryId: carol.foodCategoryId,
      type: 'EXPENSE',
      amount: '100000.00',
      currency: 'VND',
      occurredAt: '2024-03-31T16:59:59.000Z',
    });
    // 2024-04-01 00:00 HCM belongs to April.
    await transaction({
      userId: carol.id,
      accountId: carol.vndAccountId,
      categoryId: carol.foodCategoryId,
      type: 'EXPENSE',
      amount: '200000.00',
      currency: 'VND',
      occurredAt: '2024-03-31T17:00:00.000Z',
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('requires authentication', async () => {
    await request(app.getHttpServer()).get('/api/v1/analytics/overview').expect(401);
    await request(app.getHttpServer()).get('/api/v1/analytics/trends').expect(401);
    await request(app.getHttpServer()).get('/api/v1/analytics/income').expect(401);
    await request(app.getHttpServer()).get('/api/v1/analytics/expenses').expect(401);
    await request(app.getHttpServer()).get('/api/v1/analytics/period-comparison').expect(401);
  });

  it('computes a quarter overview while excluding transfers and other currencies', async () => {
    const response = await alice.agent
      .get('/api/v1/analytics/overview?period=quarter&quarter=2024-Q1')
      .expect(200);
    const body = response.body as OverviewBody;

    expect(body).toMatchObject({
      currency: 'VND',
      timezone: 'Asia/Ho_Chi_Minh',
      period: {
        kind: 'quarter',
        label: '2024-Q1',
        from: '2024-01-01',
        to: '2024-03-31',
        status: 'complete',
      },
      income: '11000000.00',
      expense: '8000000.00',
      net: '3000000.00',
      savingsRate: 27.27,
      transactionCount: 8,
      hasTransactions: true,
      estimated: false,
      previous: {
        period: { label: '2023-Q4', from: '2023-10-01', to: '2023-12-31' },
        income: '8000000.00',
        expense: '3000000.00',
        net: '5000000.00',
        savingsRate: 62.5,
        transactionCount: 4,
        hasTransactions: true,
      },
      changes: {
        income: { amount: '3000000.00', percent: 37.5 },
        expense: { amount: '5000000.00', percent: 166.67 },
        net: { amount: '-2000000.00', percent: -40 },
        savingsRatePoints: -35.23,
      },
      availableCurrencies: ['VND', 'USD'],
    });
  });

  it('separates currencies and reports the USD figures on their own', async () => {
    const response = await alice.agent
      .get('/api/v1/analytics/overview?period=month&month=2024-01&currency=USD')
      .expect(200);
    const body = response.body as OverviewBody;

    expect(body).toMatchObject({
      currency: 'USD',
      income: '1000.00',
      expense: '0.00',
      net: '1000.00',
      transactionCount: 1,
    });
  });

  it('handles zero income and a zero previous baseline without dividing by zero', async () => {
    const response = await alice.agent
      .get('/api/v1/analytics/overview?period=month&month=2024-03')
      .expect(200);
    const body = response.body as OverviewBody;

    expect(body).toMatchObject({
      income: '0.00',
      expense: '4000000.00',
      net: '-4000000.00',
      savingsRate: null,
      transactionCount: 2,
      previous: {
        income: '5000000.00',
        expense: '2500000.00',
        savingsRate: 50,
      },
      changes: {
        income: { amount: '-5000000.00', percent: -100 },
        expense: { amount: '1500000.00', percent: 60 },
        net: { amount: '-6500000.00', percent: -260 },
        savingsRatePoints: null,
      },
    });
  });

  it('uses local day boundaries for month totals', async () => {
    const march = await carol.agent
      .get('/api/v1/analytics/overview?period=month&month=2024-03')
      .expect(200);
    const april = await carol.agent
      .get('/api/v1/analytics/overview?period=month&month=2024-04')
      .expect(200);

    expect((march.body as OverviewBody).expense).toBe('100000.00');
    expect((april.body as OverviewBody).expense).toBe('200000.00');
  });

  it('returns every month in the trend window and never interpolates missing data', async () => {
    const response = await alice.agent
      .get('/api/v1/analytics/trends?months=6&month=2024-03')
      .expect(200);
    const body = response.body as TrendsBody;

    expect(body.rangeMonths).toBe(6);
    expect(body.points.map((point) => point.month)).toEqual([
      '2023-10',
      '2023-11',
      '2023-12',
      '2024-01',
      '2024-02',
      '2024-03',
    ]);

    expect(body.points[0]).toMatchObject({
      month: '2023-10',
      income: '0.00',
      expense: '0.00',
      net: '0.00',
      transactionCount: 0,
      hasTransactions: false,
    });
    expect(body.points[3]).toMatchObject({
      month: '2024-01',
      income: '6000000.00',
      expense: '1500000.00',
      net: '4500000.00',
      transactionCount: 3,
      hasTransactions: true,
    });
    // March has expenses but no income: this is a measured zero, not "no data".
    expect(body.points[5]).toMatchObject({
      month: '2024-03',
      income: '0.00',
      expense: '4000000.00',
      hasTransactions: true,
    });
  });

  it('analyses income by month and by category, never inferring a source from text', async () => {
    const response = await alice.agent
      .get('/api/v1/analytics/income?months=6&month=2024-03')
      .expect(200);
    const body = response.body as IncomeBody;

    expect(body).toMatchObject({
      total: '19000000.00',
      averageMonthly: '4750000.00',
      monthsWithIncome: 4,
      highest: { month: '2024-01', amount: '6000000.00' },
      lowest: { month: '2023-11', amount: '4000000.00' },
    });
    expect(body.points.map((point) => point.changePercent)).toEqual([
      null,
      null,
      0,
      50,
      -16.67,
      -100,
    ]);
    expect(body.sources).toEqual([
      {
        categoryId: alice.salaryCategoryId,
        categoryName: 'Lương',
        total: '19000000.00',
        sharePercent: 100,
        transactionCount: 4,
      },
    ]);
  });

  it('analyses expenses without judging the user and counts increasing runs', async () => {
    const response = await alice.agent
      .get('/api/v1/analytics/expenses?months=6&month=2024-03')
      .expect(200);
    const body = response.body as ExpensesBody;

    expect(body).toMatchObject({
      total: '11000000.00',
      averageMonthly: '2200000.00',
      monthsWithExpense: 5,
      highest: { month: '2024-03', amount: '4000000.00' },
      lowest: { month: '2023-11', amount: '1000000.00' },
      longestIncreasingStreak: 2,
      currentIncreasingStreak: 2,
    });
    expect(body.volatilityPercent).toBeCloseTo(46.8, 1);
    expect(body.points.map((point) => point.changePercent)).toEqual([
      null,
      null,
      100,
      -25,
      66.67,
      60,
    ]);
  });

  it('compares quarters and lists the category movements that explain the change', async () => {
    const response = await alice.agent
      .get('/api/v1/analytics/period-comparison?period=quarter&quarter=2024-Q1')
      .expect(200);
    const body = response.body as ComparisonBody;

    expect(body.current).toMatchObject({
      period: { label: '2024-Q1' },
      income: '11000000.00',
      expense: '8000000.00',
      net: '3000000.00',
      savingsRate: 27.27,
      transactionCount: 8,
    });
    expect(body.previous).toMatchObject({
      period: { label: '2023-Q4' },
      income: '8000000.00',
      expense: '3000000.00',
    });
    expect(body.changes.expense).toEqual({ amount: '5000000.00', percent: 166.67 });

    const food = body.notableCategoryChanges.find(
      (item) => item.categoryId === alice.foodCategoryId,
    );
    expect(food).toMatchObject({
      categoryName: 'Ăn uống',
      currentTotal: '6000000.00',
      previousTotal: '3000000.00',
      changeAmount: '3000000.00',
      changePercent: 100,
      direction: 'increase',
    });
    const transport = body.notableCategoryChanges.find(
      (item) => item.categoryId === alice.transportCategoryId,
    );
    expect(transport).toMatchObject({
      categoryName: 'Đi lại',
      currentTotal: '2000000.00',
      previousTotal: '0.00',
      changePercent: null,
      direction: 'new',
    });
  });

  it('never mixes one user’s data into another user’s analytics', async () => {
    const aliceResponse = await alice.agent
      .get('/api/v1/analytics/overview?period=quarter&quarter=2024-Q1')
      .expect(200);
    const bobResponse = await bob.agent
      .get('/api/v1/analytics/overview?period=quarter&quarter=2024-Q1')
      .expect(200);

    expect((aliceResponse.body as OverviewBody).income).toBe('11000000.00');
    expect((bobResponse.body as OverviewBody).income).toBe('9000000.00');
    expect((bobResponse.body as OverviewBody).expense).toBe('1000000.00');

    const bobTrends = await bob.agent
      .get('/api/v1/analytics/trends?months=6&month=2024-03')
      .expect(200);
    expect((bobTrends.body as TrendsBody).points[3]).toMatchObject({
      month: '2024-01',
      income: '9000000.00',
      transactionCount: 1,
    });
  });

  it('rejects invalid filters with 400', async () => {
    await alice.agent.get('/api/v1/analytics/overview?period=week').expect(400);
    await alice.agent.get('/api/v1/analytics/overview?period=custom').expect(400);
    await alice.agent
      .get('/api/v1/analytics/overview?period=custom&from=2024-03-01&to=2024-02-01')
      .expect(400);
    await alice.agent.get('/api/v1/analytics/overview?period=month&month=2024-13').expect(400);
    await alice.agent.get('/api/v1/analytics/overview?period=quarter&quarter=2024-Q5').expect(400);
    await alice.agent.get('/api/v1/analytics/overview?currency=US').expect(400);
    await alice.agent.get('/api/v1/analytics/overview?unexpected=1').expect(400);
    await alice.agent.get('/api/v1/analytics/trends?months=5').expect(400);
    await alice.agent.get('/api/v1/analytics/trends?months=6&month=2999-01').expect(400);
  });
});
