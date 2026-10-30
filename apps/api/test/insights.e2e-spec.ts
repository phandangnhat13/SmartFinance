import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { AI_TAXONOMY } from '@smart-finance/shared-types';
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
}

interface OverviewBody {
  currency: string;
  timezone: string;
  month: string;
  monthStatus: 'in_progress' | 'complete';
  periodStart: string;
  periodEnd: string;
  income: string;
  expense: string;
  net: string;
  savingsRate: number | null;
  transactionCount: number;
  estimated: boolean;
  previous: {
    month: string;
    income: string;
    expense: string;
    net: string;
    savingsRate: number | null;
    incomeChangePercent: number | null;
    expenseChangePercent: number | null;
  };
  availableCurrencies: string[];
}

interface MonthlyBody {
  currency: string;
  timezone: string;
  estimated: boolean;
  months: {
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

interface CategoriesBody {
  month: string;
  previousMonth: string;
  total: string;
  previousTotal: string;
  changePercent: number | null;
  thresholds: { notableIncreasePercent: number };
  items: {
    categoryId: string | null;
    categoryName: string;
    total: string;
    sharePercent: number;
    transactionCount: number;
    previousTotal: string;
    changeAmount: string;
    changePercent: number | null;
    notableIncrease: boolean;
    isNewSpending: boolean;
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
 * Insights are computed from real stored transactions, so these tests seed a
 * throwaway user in the isolated test database and never touch another user's
 * data. Times are chosen around the Asia/Ho_Chi_Minh month boundary:
 * 2024-12-31T17:00:00Z is 2025-01-01 00:00 local.
 */
describe('Insights API (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let authService: AuthService;
  let alice: UserState;
  let bob: UserState;
  const stamp = `${Date.now()}.${Math.floor(Math.random() * 1e6)}`;

  async function createAccounts(
    userId: string,
  ): Promise<{ vnd: string; savings: string; usd: string }> {
    const vnd = await prisma.account.create({
      data: { userId, name: 'Tiền mặt', type: 'CASH', currency: 'VND' },
    });
    const savings = await prisma.account.create({
      data: { userId, name: 'Tiết kiệm', type: 'BANK', currency: 'VND' },
    });
    const usd = await prisma.account.create({
      data: { userId, name: 'USD', type: 'BANK', currency: 'USD' },
    });
    return { vnd: vnd.id, savings: savings.id, usd: usd.id };
  }

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
        description: 'Giao dịch kiểm thử insights',
        occurredAt: new Date(input.occurredAt),
        categoryId: input.categoryId ?? null,
        transferGroupId: input.transferGroupId ?? null,
        transferDirection: input.transferDirection ?? null,
      },
    });
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false });
    configureApp(app);
    await app.init();

    prisma = app.get(PrismaService);
    authService = app.get(AuthService);

    // This suite runs after others that truncate users, so make sure the
    // system categories it references exist instead of relying on leftover
    // data from an earlier suite or run.
    for (const slug of ['food', 'transport']) {
      const item = AI_TAXONOMY.find((entry) => entry.slug === slug);
      if (!item) throw new Error(`AI_TAXONOMY is missing "${slug}"`);
      await prisma.category.upsert({
        where: { slug: item.slug },
        update: { name: item.name, type: item.type, isSystem: true, isArchived: false },
        create: {
          slug: item.slug,
          name: item.name,
          type: item.type,
          isSystem: true,
        },
      });
    }

    const registeredAlice = await createSession(
      app,
      authService,
      `insights.alice.${stamp}@example.com`,
      'Alice Insights',
    );
    const aliceAccounts = await createAccounts(registeredAlice.id);
    alice = {
      ...registeredAlice,
      vndAccountId: aliceAccounts.vnd,
      savingsAccountId: aliceAccounts.savings,
      usdAccountId: aliceAccounts.usd,
    };

    const registeredBob = await createSession(
      app,
      authService,
      `insights.bob.${stamp}@example.com`,
      'Bob Insights',
    );
    const bobAccounts = await createAccounts(registeredBob.id);
    bob = {
      ...registeredBob,
      vndAccountId: bobAccounts.vnd,
      savingsAccountId: bobAccounts.savings,
      usdAccountId: bobAccounts.usd,
    };

    const food = await prisma.category.findUnique({ where: { slug: 'food' } });
    const transport = await prisma.category.findUnique({ where: { slug: 'transport' } });
    if (!food || !transport) throw new Error('Seeded categories are required for this test');

    // January 2025 (Asia/Ho_Chi_Minh): income 5,000,000, expenses 2,300,000.
    await transaction({
      userId: alice.id,
      accountId: alice.vndAccountId,
      type: 'INCOME',
      amount: '5000000.00',
      currency: 'VND',
      occurredAt: '2025-01-02T03:00:00.000Z',
    });
    await transaction({
      userId: alice.id,
      accountId: alice.vndAccountId,
      type: 'EXPENSE',
      amount: '2000000.00',
      currency: 'VND',
      occurredAt: '2025-01-31T16:59:59.000Z',
      categoryId: food.id,
    });
    // 2025-01-01 00:00 local — belongs to January, not December.
    await transaction({
      userId: alice.id,
      accountId: alice.vndAccountId,
      type: 'EXPENSE',
      amount: '300000.00',
      currency: 'VND',
      occurredAt: '2024-12-31T17:00:00.000Z',
      categoryId: transport.id,
    });
    // 2024-12-31 23:59:59 local — the last instant of December.
    await transaction({
      userId: alice.id,
      accountId: alice.vndAccountId,
      type: 'EXPENSE',
      amount: '1000000.00',
      currency: 'VND',
      occurredAt: '2024-12-31T16:59:59.000Z',
      categoryId: food.id,
    });
    // 2025-02-01 00:00 local — February spending without any income.
    await transaction({
      userId: alice.id,
      accountId: alice.vndAccountId,
      type: 'EXPENSE',
      amount: '900000.00',
      currency: 'VND',
      occurredAt: '2025-01-31T17:00:00.000Z',
      categoryId: food.id,
    });

    // A USD income must never be added to the VND figures.
    await transaction({
      userId: alice.id,
      accountId: alice.usdAccountId,
      type: 'INCOME',
      amount: '1000.00',
      currency: 'USD',
      occurredAt: '2025-01-15T03:00:00.000Z',
    });

    // Internal transfer pair: a move between own accounts, not income/expense.
    const transferGroupId = '11111111-2222-4333-8444-555555555555';
    await transaction({
      userId: alice.id,
      accountId: alice.vndAccountId,
      type: 'TRANSFER',
      amount: '1000000.00',
      currency: 'VND',
      occurredAt: '2025-01-10T03:00:00.000Z',
      transferGroupId,
      transferDirection: 'OUT',
    });
    await transaction({
      userId: alice.id,
      accountId: alice.savingsAccountId,
      type: 'TRANSFER',
      amount: '1000000.00',
      currency: 'VND',
      occurredAt: '2025-01-10T03:00:00.000Z',
      transferGroupId,
      transferDirection: 'IN',
    });

    await transaction({
      userId: bob.id,
      accountId: bob.vndAccountId,
      type: 'INCOME',
      amount: '7000000.00',
      currency: 'VND',
      occurredAt: '2025-01-05T03:00:00.000Z',
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('computes monthly totals in the user timezone, excluding transfers and other currencies', async () => {
    const response = await alice.agent.get('/api/v1/insights/overview?month=2025-01').expect(200);
    const body = response.body as OverviewBody;

    expect(body).toMatchObject({
      currency: 'VND',
      timezone: 'Asia/Ho_Chi_Minh',
      month: '2025-01',
      monthStatus: 'complete',
      periodStart: '2025-01-01',
      periodEnd: '2025-01-31',
      income: '5000000.00',
      expense: '2300000.00',
      net: '2700000.00',
      savingsRate: 54,
      transactionCount: 3,
      estimated: false,
      previous: {
        month: '2024-12',
        income: '0.00',
        expense: '1000000.00',
        net: '-1000000.00',
        savingsRate: null,
        incomeChangePercent: null,
        expenseChangePercent: 130,
      },
    });
    expect(body.availableCurrencies).toEqual(['VND', 'USD']);
  });

  it('reports one currency at a time and offers the currencies the user owns', async () => {
    const usd = await alice.agent
      .get('/api/v1/insights/overview?month=2025-01&currency=USD')
      .expect(200);
    expect(usd.body).toMatchObject({
      currency: 'USD',
      income: '1000.00',
      expense: '0.00',
      net: '1000.00',
      savingsRate: 100,
      transactionCount: 1,
    });
  });

  it('returns a null savings rate when a month has expenses but no income', async () => {
    const response = await alice.agent.get('/api/v1/insights/overview?month=2025-02').expect(200);
    expect(response.body).toMatchObject({
      income: '0.00',
      expense: '900000.00',
      net: '-900000.00',
      savingsRate: null,
      previous: { month: '2025-01', expenseChangePercent: -60.87 },
    });
  });

  it('fills months without transactions and keeps the requested window', async () => {
    const response = await alice.agent
      .get('/api/v1/insights/monthly?month=2025-01&months=3')
      .expect(200);
    const body = response.body as MonthlyBody;

    expect(body.currency).toBe('VND');
    expect(body.estimated).toBe(false);
    expect(body.months.map((point) => point.month)).toEqual(['2024-11', '2024-12', '2025-01']);
    expect(body.months[0]).toMatchObject({
      monthStatus: 'complete',
      income: '0.00',
      expense: '0.00',
      savingsRate: null,
      transactionCount: 0,
      hasTransactions: false,
    });
    expect(body.months[1]).toMatchObject({
      income: '0.00',
      expense: '1000000.00',
      net: '-1000000.00',
      savingsRate: null,
      hasTransactions: true,
    });
    expect(body.months[2]).toMatchObject({
      income: '5000000.00',
      expense: '2300000.00',
      net: '2700000.00',
      savingsRate: 54,
      hasTransactions: true,
    });
  });

  it('compares category spending with the previous month and flags notable growth', async () => {
    const response = await alice.agent.get('/api/v1/insights/categories?month=2025-01').expect(200);
    const body = response.body as CategoriesBody;
    const food = await prisma.category.findUnique({ where: { slug: 'food' } });
    const transport = await prisma.category.findUnique({ where: { slug: 'transport' } });

    expect(body).toMatchObject({
      month: '2025-01',
      previousMonth: '2024-12',
      total: '2300000.00',
      previousTotal: '1000000.00',
      changePercent: 130,
      thresholds: { notableIncreasePercent: 25 },
    });
    expect(body.items).toHaveLength(2);

    const foodItem = body.items.find((item) => item.categoryId === food?.id);
    expect(foodItem).toMatchObject({
      categoryName: food?.name,
      total: '2000000.00',
      previousTotal: '1000000.00',
      changePercent: 100,
      notableIncrease: true,
      isNewSpending: false,
    });
    const transportItem = body.items.find((item) => item.categoryId === transport?.id);
    expect(transportItem).toMatchObject({
      total: '300000.00',
      previousTotal: '0.00',
      changePercent: null,
      notableIncrease: false,
      isNewSpending: true,
    });
    expect(body.items[0].categoryId).toBe(food?.id);
  });

  it('never includes another user in totals, series or categories', async () => {
    const overview = await bob.agent.get('/api/v1/insights/overview?month=2025-01').expect(200);
    expect(overview.body).toMatchObject({
      income: '7000000.00',
      expense: '0.00',
      transactionCount: 1,
    });

    const categories = await bob.agent.get('/api/v1/insights/categories?month=2025-01').expect(200);
    expect(categories.body.items).toHaveLength(0);
    expect(categories.body.total).toBe('0.00');

    const monthly = await bob.agent
      .get('/api/v1/insights/monthly?month=2025-01&months=1')
      .expect(200);
    expect(monthly.body.months[0]).toMatchObject({
      income: '7000000.00',
      expense: '0.00',
    });

    const aliceOverview = await alice.agent
      .get('/api/v1/insights/overview?month=2025-01')
      .expect(200);
    expect(aliceOverview.body.income).toBe('5000000.00');
  });

  it('requires authentication', async () => {
    await request(app.getHttpServer()).get('/api/v1/insights/overview').expect(401);
    await request(app.getHttpServer()).get('/api/v1/insights/monthly').expect(401);
    await request(app.getHttpServer()).get('/api/v1/insights/categories').expect(401);
  });

  it('rejects invalid query parameters', async () => {
    await alice.agent.get('/api/v1/insights/overview?month=2025-13').expect(400);
    await alice.agent.get('/api/v1/insights/overview?currency=VN').expect(400);
    await alice.agent.get('/api/v1/insights/monthly?months=0').expect(400);
    await alice.agent.get('/api/v1/insights/monthly?months=25').expect(400);
    await alice.agent.get('/api/v1/insights/monthly?months=abc').expect(400);
    await alice.agent.get('/api/v1/insights/categories?unknown=1').expect(400);
  });
});
