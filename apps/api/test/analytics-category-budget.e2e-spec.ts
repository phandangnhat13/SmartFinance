import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { DateTime } from 'luxon';
import request from 'supertest';
import type { SuperAgentTest } from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { ACCESS_TOKEN_COOKIE } from '../src/common/guards/jwt-auth.guard';
import { resolveMonthPeriod } from '../src/common/utils/period';
import { AuthService } from '../src/modules/auth/auth.service';

const TZ = 'Asia/Ho_Chi_Minh';

interface UserState {
  id: string;
  agent: SuperAgentTest;
  accountId: string;
  salaryCategoryId: string;
  foodCategoryId: string;
  transportCategoryId: string;
  coffeeCategoryId: string;
  subscriptionCategoryId: string;
  travelCategoryId: string;
  otherCategoryId: string;
  archivedCategoryId: string;
  systemSameNameCategoryId: string;
}

interface CategoryRow {
  categoryId: string | null;
  categoryName: string;
  isArchived: boolean;
  total: string;
  transactionCount: number;
  sharePercent: number;
  averageMonthly: string | null;
  previousTotal: string;
  changeAmount: string;
  changePercent: number | null;
  direction: 'increase' | 'decrease' | 'new' | 'removed';
  notableIncrease: boolean;
  isNew: boolean;
  isRemoved: boolean;
  rank: number | null;
}

interface CategoriesBody {
  currency: string;
  timezone: string;
  type: string;
  estimated: boolean;
  total: string;
  previousTotal: string;
  hasTransactions: boolean;
  monthsInPeriod: number;
  notableIncreasePercent: number;
  categories: CategoryRow[];
  trend: {
    categoryId: string;
    categoryName: string;
    rangeMonths: number;
    points: {
      month: string;
      amount: string;
      hasTransactions: boolean;
      changePercent: number | null;
    }[];
  } | null;
  period: { label: string; from: string; to: string; status: string };
  previousPeriod: { label: string };
}

interface BudgetItem {
  id: string;
  name: string;
  categoryId: string | null;
  categoryName: string | null;
  limitAmount: string;
  spent: string;
  remaining: string;
  usagePercent: number | null;
  status: string;
  warningThreshold: number | null;
  periodStart: string;
  periodEnd: string;
  totalDays: number;
  daysElapsed: number;
  daysRemaining: number;
  dailySpendingAverage: string | null;
  expectedSpend: string | null;
  variance: string | null;
  pacePercent: number | null;
  estimatedExhaustionDate: string | null;
  exhaustionProjection: string;
  transactionCount: number;
}

interface BudgetsBody {
  currency: string;
  timezone: string;
  month: string;
  asOf: string;
  monthStatus: string;
  assumesLimitCurrency: string;
  summary: Record<string, number>;
  items: BudgetItem[];
}

interface PaceBody {
  items: {
    budgetId: string;
    status: string;
    expectedSpend: string | null;
    variance: string | null;
    pacePercent: number | null;
    daysElapsed: number;
    daysRemaining: number;
    estimatedExhaustionDate: string | null;
    exhaustionProjection: string;
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
 * Category & budget analytics (M3b) against the isolated test database.
 * Past-month fixtures use fixed calendar dates; current-month fixtures use the
 * run's local month so statuses such as ON_TRACK/WARNING can be exercised.
 */
describe('Category & budget analytics API (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let authService: AuthService;
  let alice: UserState;
  let bob: UserState;
  let carol: UserState;
  const stamp = `${Date.now()}.${Math.floor(Math.random() * 1e6)}`;
  const currentMonth = resolveMonthPeriod(undefined, TZ);
  const nextMonth = DateTime.fromFormat(currentMonth.month, 'yyyy-MM', { zone: TZ })
    .plus({ months: 1 })
    .toFormat('yyyy-MM');

  function transaction(input: {
    userId: string;
    accountId: string;
    type: 'INCOME' | 'EXPENSE' | 'TRANSFER';
    amount: string;
    currency?: string;
    occurredAt: string | Date;
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
        description: 'Giao dịch kiểm thử M3b',
        occurredAt:
          typeof input.occurredAt === 'string' ? new Date(input.occurredAt) : input.occurredAt,
        categoryId: input.categoryId ?? null,
        transferGroupId: input.transferGroupId ?? null,
        transferDirection: input.transferDirection ?? null,
      },
    });
  }

  function category(data: {
    userId: string | null;
    name: string;
    type: 'INCOME' | 'EXPENSE';
    isSystem?: boolean;
    isArchived?: boolean;
    slug?: string;
  }) {
    return prisma.category.create({
      data: {
        userId: data.userId,
        name: data.name,
        type: data.type,
        isSystem: data.isSystem ?? false,
        isArchived: data.isArchived ?? false,
        slug: data.slug ?? null,
      },
    });
  }

  function budget(input: {
    userId: string;
    name: string;
    scopeKey: string;
    categoryId: string | null;
    month: string;
    limitAmount: string;
    warningThresholds?: number[];
  }) {
    const period = resolveMonthPeriod(input.month, TZ);
    return prisma.budget.create({
      data: {
        userId: input.userId,
        name: input.name,
        scopeKey: input.scopeKey,
        categoryId: input.categoryId,
        periodStart: period.periodStart,
        periodEnd: period.periodEnd,
        limitAmount: new Prisma.Decimal(input.limitAmount),
        warningThresholds: input.warningThresholds ?? [80, 100],
      },
    });
  }

  async function seedUser(email: string, displayName: string): Promise<UserState> {
    const session = await createSession(app, authService, email, displayName);
    const account = await prisma.account.create({
      data: { userId: session.id, name: 'Tiền mặt', type: 'CASH', currency: 'VND' },
    });
    const [salary, food, transport, coffee, subscription, travel, other, archived] =
      await Promise.all([
        category({ userId: session.id, name: 'Lương', type: 'INCOME' }),
        category({ userId: session.id, name: 'Ăn uống', type: 'EXPENSE' }),
        category({ userId: session.id, name: 'Đi lại', type: 'EXPENSE' }),
        category({ userId: session.id, name: 'Cà phê', type: 'EXPENSE' }),
        category({ userId: session.id, name: 'Đăng ký', type: 'EXPENSE' }),
        category({ userId: session.id, name: 'Du lịch', type: 'EXPENSE' }),
        category({ userId: session.id, name: 'Khác', type: 'EXPENSE' }),
        category({
          userId: session.id,
          name: 'Giải trí (lưu trữ)',
          type: 'EXPENSE',
          isArchived: true,
        }),
      ]);
    // A system category deliberately sharing its display name with the user's
    // own "Ăn uống" category: the two must never be merged.
    const systemSameName = await category({
      userId: null,
      name: 'Ăn uống',
      type: 'EXPENSE',
      isSystem: true,
    });
    return {
      ...session,
      accountId: account.id,
      salaryCategoryId: salary.id,
      foodCategoryId: food.id,
      transportCategoryId: transport.id,
      coffeeCategoryId: coffee.id,
      subscriptionCategoryId: subscription.id,
      travelCategoryId: travel.id,
      otherCategoryId: other.id,
      archivedCategoryId: archived.id,
      systemSameNameCategoryId: systemSameName.id,
    };
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false });
    configureApp(app);
    await app.init();

    prisma = app.get(PrismaService);
    authService = app.get(AuthService);

    alice = await seedUser(`catbudget.alice.${stamp}@example.com`, 'Alice Category');
    bob = await seedUser(`catbudget.bob.${stamp}@example.com`, 'Bob Category');
    carol = await seedUser(`catbudget.carol.${stamp}@example.com`, 'Carol Category');

    // February 2024 (previous period): expense 2,700,000; income 8,000,000.
    await transaction({
      userId: alice.id,
      accountId: alice.accountId,
      categoryId: alice.foodCategoryId,
      type: 'EXPENSE',
      amount: '1000000.00',
      occurredAt: '2024-02-10T03:00:00.000Z',
    });
    await transaction({
      userId: alice.id,
      accountId: alice.accountId,
      categoryId: alice.transportCategoryId,
      type: 'EXPENSE',
      amount: '1500000.00',
      occurredAt: '2024-02-15T03:00:00.000Z',
    });
    await transaction({
      userId: alice.id,
      accountId: alice.accountId,
      categoryId: alice.subscriptionCategoryId,
      type: 'EXPENSE',
      amount: '200000.00',
      occurredAt: '2024-02-20T03:00:00.000Z',
    });
    await transaction({
      userId: alice.id,
      accountId: alice.accountId,
      categoryId: alice.salaryCategoryId,
      type: 'INCOME',
      amount: '8000000.00',
      occurredAt: '2024-02-05T03:00:00.000Z',
    });

    // March 2024: expense 4,000,000 all in VND; income 10,000,000.
    await transaction({
      userId: alice.id,
      accountId: alice.accountId,
      categoryId: alice.foodCategoryId,
      type: 'EXPENSE',
      amount: '2000000.00',
      occurredAt: '2024-03-05T03:00:00.000Z',
    });
    await transaction({
      userId: alice.id,
      accountId: alice.accountId,
      categoryId: alice.transportCategoryId,
      type: 'EXPENSE',
      amount: '1000000.00',
      occurredAt: '2024-03-08T03:00:00.000Z',
    });
    await transaction({
      userId: alice.id,
      accountId: alice.accountId,
      categoryId: alice.coffeeCategoryId,
      type: 'EXPENSE',
      amount: '500000.00',
      occurredAt: '2024-03-10T03:00:00.000Z',
    });
    await transaction({
      userId: alice.id,
      accountId: alice.accountId,
      categoryId: alice.systemSameNameCategoryId,
      type: 'EXPENSE',
      amount: '400000.00',
      occurredAt: '2024-03-12T03:00:00.000Z',
    });
    await transaction({
      userId: alice.id,
      accountId: alice.accountId,
      categoryId: alice.archivedCategoryId,
      type: 'EXPENSE',
      amount: '100000.00',
      occurredAt: '2024-03-15T03:00:00.000Z',
    });
    await transaction({
      userId: alice.id,
      accountId: alice.accountId,
      categoryId: alice.salaryCategoryId,
      type: 'INCOME',
      amount: '10000000.00',
      occurredAt: '2024-03-05T03:00:00.000Z',
    });
    // Internal transfer — must never be counted as spending.
    await transaction({
      userId: alice.id,
      accountId: alice.accountId,
      type: 'TRANSFER',
      amount: '700000.00',
      occurredAt: '2024-03-18T03:00:00.000Z',
      transferGroupId: '33333333-4444-4555-8666-777777777777',
      transferDirection: 'OUT',
    });
    // USD spending — separated from VND totals and counted only for USD queries.
    await transaction({
      userId: alice.id,
      accountId: alice.accountId,
      categoryId: alice.foodCategoryId,
      type: 'EXPENSE',
      amount: '100.00',
      currency: 'USD',
      occurredAt: '2024-03-20T03:00:00.000Z',
    });

    // Current-month fixtures use today's date so the period is active.
    const todayStart = DateTime.now().setZone(TZ).startOf('day').toUTC().toJSDate();
    await transaction({
      userId: alice.id,
      accountId: alice.accountId,
      categoryId: alice.coffeeCategoryId,
      type: 'EXPENSE',
      amount: '850000.00',
      occurredAt: todayStart,
    });
    await transaction({
      userId: alice.id,
      accountId: alice.accountId,
      categoryId: alice.foodCategoryId,
      type: 'EXPENSE',
      amount: '100000.00',
      occurredAt: todayStart,
    });

    // March 2024 budgets (all ended by the time the test runs).
    await budget({
      userId: alice.id,
      name: 'Tổng chi tháng 3',
      scopeKey: 'ALL',
      categoryId: null,
      month: '2024-03',
      limitAmount: '4000000.00',
    });
    await budget({
      userId: alice.id,
      name: 'Ăn uống tháng 3',
      scopeKey: alice.foodCategoryId,
      categoryId: alice.foodCategoryId,
      month: '2024-03',
      limitAmount: '1000000.00',
    });
    await budget({
      userId: alice.id,
      name: 'Đi lại tháng 3',
      scopeKey: alice.transportCategoryId,
      categoryId: alice.transportCategoryId,
      month: '2024-03',
      limitAmount: '2000000.00',
    });
    await budget({
      userId: alice.id,
      name: 'Du lịch tháng 3 (không chi)',
      scopeKey: alice.travelCategoryId,
      categoryId: alice.travelCategoryId,
      month: '2024-03',
      limitAmount: '500000.00',
    });
    // The DTO refuses a zero limit, but the column allows it: the read path
    // must stay defensively correct.
    await budget({
      userId: alice.id,
      name: 'Khác tháng 3 (hạn mức 0)',
      scopeKey: alice.otherCategoryId,
      categoryId: alice.otherCategoryId,
      month: '2024-03',
      limitAmount: '0.00',
    });

    // Current-month budgets exercise time-derived states.
    await budget({
      userId: alice.id,
      name: 'Tổng chi tháng này',
      scopeKey: 'ALL',
      categoryId: null,
      month: currentMonth.month,
      limitAmount: '10000000.00',
    });
    await budget({
      userId: alice.id,
      name: 'Cà phê tháng này',
      scopeKey: alice.coffeeCategoryId,
      categoryId: alice.coffeeCategoryId,
      month: currentMonth.month,
      limitAmount: '1000000.00',
    });
    await budget({
      userId: alice.id,
      name: 'Du lịch tháng này (chưa chi)',
      scopeKey: alice.travelCategoryId,
      categoryId: alice.travelCategoryId,
      month: currentMonth.month,
      limitAmount: '200000.00',
    });
    await budget({
      userId: alice.id,
      name: 'Tháng sau',
      scopeKey: 'ALL',
      categoryId: null,
      month: nextMonth,
      limitAmount: '1000000.00',
    });

    // Bob's own March spending under a different category.
    await transaction({
      userId: bob.id,
      accountId: bob.accountId,
      categoryId: bob.foodCategoryId,
      type: 'EXPENSE',
      amount: '3000000.00',
      occurredAt: '2024-03-06T03:00:00.000Z',
    });

    // Carol exercises the local-midnight boundary.
    await transaction({
      userId: carol.id,
      accountId: carol.accountId,
      categoryId: carol.foodCategoryId,
      type: 'EXPENSE',
      amount: '100000.00',
      occurredAt: '2024-03-31T16:59:59.000Z', // 2024-03-31 23:59:59 HCM
    });
    await transaction({
      userId: carol.id,
      accountId: carol.accountId,
      categoryId: carol.foodCategoryId,
      type: 'EXPENSE',
      amount: '200000.00',
      occurredAt: '2024-03-31T17:00:00.000Z', // 2024-04-01 00:00 HCM
    });
    await budget({
      userId: carol.id,
      name: 'Carol tháng 3',
      scopeKey: 'ALL',
      categoryId: null,
      month: '2024-03',
      limitAmount: '1000000.00',
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('requires authentication on every new route', async () => {
    await request(app.getHttpServer()).get('/api/v1/analytics/categories').expect(401);
    await request(app.getHttpServer()).get('/api/v1/analytics/budgets').expect(401);
    await request(app.getHttpServer()).get('/api/v1/analytics/budget-pace').expect(401);
  });

  it('groups category spending by id, never by name', async () => {
    const response = await alice.agent
      .get('/api/v1/analytics/categories?period=month&month=2024-03')
      .expect(200);
    const body = response.body as CategoriesBody;

    expect(body).toMatchObject({
      currency: 'VND',
      timezone: TZ,
      type: 'EXPENSE',
      estimated: false,
      total: '4000000.00',
      previousTotal: '2700000.00',
      hasTransactions: true,
      monthsInPeriod: 1,
      notableIncreasePercent: 25,
    });

    const food = body.categories.find((row) => row.categoryId === alice.foodCategoryId);
    expect(food).toMatchObject({
      categoryName: 'Ăn uống',
      total: '2000000.00',
      previousTotal: '1000000.00',
      changePercent: 100,
      direction: 'increase',
      notableIncrease: true,
      sharePercent: 50,
      rank: 1,
      averageMonthly: '2000000.00',
      isArchived: false,
      isRemoved: false,
    });

    // Same display name as `food`, but a different id and its own total.
    const system = body.categories.find((row) => row.categoryId === alice.systemSameNameCategoryId);
    expect(system).toMatchObject({
      categoryName: 'Ăn uống',
      total: '400000.00',
      transactionCount: 1,
      isNew: true,
    });
    expect(body.categories.filter((row) => row.categoryName === 'Ăn uống')).toHaveLength(2);

    const transport = body.categories.find((row) => row.categoryId === alice.transportCategoryId);
    expect(transport).toMatchObject({
      total: '1000000.00',
      previousTotal: '1500000.00',
      changePercent: -33.33,
      direction: 'decrease',
      notableIncrease: false,
    });

    const coffee = body.categories.find((row) => row.categoryId === alice.coffeeCategoryId);
    expect(coffee).toMatchObject({
      total: '500000.00',
      previousTotal: '0.00',
      isNew: true,
      direction: 'new',
    });

    const subscription = body.categories.find(
      (row) => row.categoryId === alice.subscriptionCategoryId,
    );
    expect(subscription).toMatchObject({
      total: '0.00',
      previousTotal: '200000.00',
      direction: 'removed',
      isRemoved: true,
      rank: null,
      transactionCount: 0,
    });

    const archived = body.categories.find((row) => row.categoryId === alice.archivedCategoryId);
    expect(archived).toMatchObject({ isArchived: true, total: '100000.00' });

    // A category with no transactions in the period is not invented as a row.
    expect(body.categories.some((row) => row.categoryId === alice.travelCategoryId)).toBe(false);
  });

  it('never counts transfers, other currencies or other users', async () => {
    const response = await alice.agent
      .get('/api/v1/analytics/categories?period=month&month=2024-03&type=EXPENSE')
      .expect(200);
    const body = response.body as CategoriesBody;

    // 2,000,000 + 1,000,000 + 500,000 + 400,000 + 100,000; the 700,000 transfer
    // and the 100 USD expense are excluded.
    expect(body.total).toBe('4000000.00');
    expect(body.categories.reduce((sum, row) => sum + Number(row.total), 0)).toBe(4_000_000);

    const usd = await alice.agent
      .get('/api/v1/analytics/categories?period=month&month=2024-03&currency=USD')
      .expect(200);
    expect((usd.body as CategoriesBody).total).toBe('100.00');
    expect((usd.body as CategoriesBody).categories).toEqual([
      expect.objectContaining({ categoryId: alice.foodCategoryId, total: '100.00' }),
    ]);

    const bobResponse = await bob.agent
      .get('/api/v1/analytics/categories?period=month&month=2024-03')
      .expect(200);
    const bobBody = bobResponse.body as CategoriesBody;
    expect(bobBody.total).toBe('3000000.00');
    expect(bobBody.categories.some((row) => row.categoryId === alice.foodCategoryId)).toBe(false);
  });

  it('analyses income categories and their notable growth', async () => {
    const response = await alice.agent
      .get('/api/v1/analytics/categories?period=month&month=2024-03&type=INCOME')
      .expect(200);
    const body = response.body as CategoriesBody;

    expect(body.total).toBe('10000000.00');
    expect(body.previousTotal).toBe('8000000.00');
    expect(body.categories).toEqual([
      expect.objectContaining({
        categoryId: alice.salaryCategoryId,
        categoryName: 'Lương',
        total: '10000000.00',
        previousTotal: '8000000.00',
        changePercent: 25,
        notableIncrease: true,
        sharePercent: 100,
      }),
    ]);
  });

  it('returns a monthly series for one selected category only', async () => {
    const response = await alice.agent
      .get(
        `/api/v1/analytics/categories?period=month&month=2024-03&categoryId=${alice.foodCategoryId}&months=6`,
      )
      .expect(200);
    const body = response.body as CategoriesBody;

    expect(body.trend).not.toBeNull();
    expect(body.trend).toMatchObject({
      categoryId: alice.foodCategoryId,
      categoryName: 'Ăn uống',
      rangeMonths: 6,
    });
    expect(body.trend!.points.map((point) => point.month)).toEqual([
      '2023-10',
      '2023-11',
      '2023-12',
      '2024-01',
      '2024-02',
      '2024-03',
    ]);
    expect(body.trend!.points[4]).toMatchObject({
      month: '2024-02',
      amount: '1000000.00',
      hasTransactions: true,
    });
    expect(body.trend!.points[5]).toMatchObject({
      month: '2024-03',
      amount: '2000000.00',
      hasTransactions: true,
      changePercent: 100,
    });
    expect(body.trend!.points[3]).toMatchObject({
      month: '2024-01',
      amount: '0.00',
      hasTransactions: false,
      changePercent: null,
    });

    // Without a categoryId there is no trend payload at all.
    const noTrend = await alice.agent
      .get('/api/v1/analytics/categories?period=month&month=2024-03')
      .expect(200);
    expect((noTrend.body as CategoriesBody).trend).toBeNull();
  });

  it('uses local day boundaries for category totals', async () => {
    const march = await carol.agent
      .get('/api/v1/analytics/categories?period=month&month=2024-03')
      .expect(200);
    const april = await carol.agent
      .get('/api/v1/analytics/categories?period=month&month=2024-04')
      .expect(200);

    expect((march.body as CategoriesBody).total).toBe('100000.00');
    expect((april.body as CategoriesBody).total).toBe('200000.00');
  });

  it('classifies budgets from their own thresholds and the calendar', async () => {
    const response = await alice.agent.get('/api/v1/analytics/budgets?month=2024-03').expect(200);
    const body = response.body as BudgetsBody;

    expect(body).toMatchObject({
      currency: 'VND',
      timezone: TZ,
      month: '2024-03',
      monthStatus: 'complete',
      assumesLimitCurrency: 'VND',
    });
    expect(body.summary).toMatchObject({
      budgetCount: 5,
      exceededCount: 2,
      completedCount: 3,
      warningCount: 0,
      onTrackCount: 0,
      notStartedCount: 0,
    });

    const all = body.items.find((item) => item.name === 'Tổng chi tháng 3')!;
    expect(all).toMatchObject({
      categoryId: null,
      limitAmount: '4000000.00',
      spent: '4000000.00',
      remaining: '0.00',
      usagePercent: 100,
      status: 'EXCEEDED',
      periodStart: '2024-03-01',
      periodEnd: '2024-03-31',
      totalDays: 31,
      daysElapsed: 31,
      daysRemaining: 0,
      transactionCount: 5,
      exhaustionProjection: 'already_exceeded',
    });

    const food = body.items.find((item) => item.categoryId === alice.foodCategoryId)!;
    expect(food).toMatchObject({
      spent: '2000000.00',
      usagePercent: 200,
      status: 'EXCEEDED',
      categoryName: 'Ăn uống',
    });

    const transport = body.items.find((item) => item.categoryId === alice.transportCategoryId)!;
    expect(transport).toMatchObject({
      spent: '1000000.00',
      usagePercent: 50,
      status: 'COMPLETED',
      exhaustionProjection: 'period_ended',
      estimatedExhaustionDate: null,
    });

    const travel = body.items.find((item) => item.categoryId === alice.travelCategoryId)!;
    expect(travel).toMatchObject({
      spent: '0.00',
      remaining: '500000.00',
      usagePercent: 0,
      status: 'COMPLETED',
      transactionCount: 0,
    });

    const zeroLimit = body.items.find((item) => item.categoryId === alice.otherCategoryId)!;
    expect(zeroLimit).toMatchObject({
      limitAmount: '0.00',
      spent: '0.00',
      usagePercent: null,
      status: 'COMPLETED',
    });
  });

  it('scopes budget spending to the requested currency', async () => {
    const response = await alice.agent
      .get('/api/v1/analytics/budgets?month=2024-03&currency=USD')
      .expect(200);
    const body = response.body as BudgetsBody;

    expect(body.currency).toBe('USD');
    expect(body.items.find((item) => item.name === 'Tổng chi tháng 3')!.spent).toBe('100.00');
    expect(body.items.find((item) => item.categoryId === alice.foodCategoryId)!.spent).toBe(
      '100.00',
    );
    // A VND-only category has no USD spending at all.
    expect(body.items.find((item) => item.categoryId === alice.transportCategoryId)!.spent).toBe(
      '0.00',
    );
  });

  it('derives ON_TRACK, WARNING and NOT_STARTED from real time', async () => {
    const response = await alice.agent
      .get(`/api/v1/analytics/budgets?month=${currentMonth.month}`)
      .expect(200);
    const body = response.body as BudgetsBody;

    expect(body.monthStatus).toBe('in_progress');
    expect(body.asOf).toBe(DateTime.now().setZone(TZ).toISODate());

    const all = body.items.find((item) => item.name === 'Tổng chi tháng này')!;
    expect(all.status).toBe('ON_TRACK');
    expect(all.spent).toBe('950000.00');
    expect(all.exhaustionProjection).toBe('beyond_period');
    expect(all.estimatedExhaustionDate).toBeNull();
    expect(all.daysElapsed).toBeGreaterThanOrEqual(1);
    expect(all.daysElapsed).toBeLessThanOrEqual(all.totalDays);
    expect(all.daysRemaining).toBe(all.totalDays - all.daysElapsed);
    expect(Number(all.expectedSpend)).toBeCloseTo(
      (10_000_000 * all.daysElapsed) / all.totalDays,
      2,
    );

    const coffee = body.items.find((item) => item.categoryId === alice.coffeeCategoryId)!;
    expect(coffee).toMatchObject({
      status: 'WARNING',
      limitAmount: '1000000.00',
      spent: '850000.00',
      usagePercent: 85,
      warningThreshold: 80,
    });

    const noSpend = body.items.find((item) => item.categoryId === alice.travelCategoryId)!;
    expect(noSpend).toMatchObject({
      status: 'ON_TRACK',
      spent: '0.00',
      dailySpendingAverage: '0.00',
      exhaustionProjection: 'no_spending',
      estimatedExhaustionDate: null,
    });

    const futureResponse = await alice.agent
      .get(`/api/v1/analytics/budgets?month=${nextMonth}`)
      .expect(200);
    const future = (futureResponse.body as BudgetsBody).items.find(
      (item) => item.name === 'Tháng sau',
    )!;
    expect(future).toMatchObject({
      status: 'NOT_STARTED',
      daysElapsed: 0,
      daysRemaining: future.totalDays,
      expectedSpend: null,
      dailySpendingAverage: null,
      estimatedExhaustionDate: null,
      exhaustionProjection: 'not_started',
    });
  });

  it('reports the spending pace without inventing exhaustion dates', async () => {
    const response = await alice.agent
      .get('/api/v1/analytics/budget-pace?month=2024-03')
      .expect(200);
    const body = response.body as PaceBody;

    const byStatus = new Map(body.items.map((item) => [item.status, item]));
    expect(byStatus.get('EXCEEDED')?.exhaustionProjection).toBe('already_exceeded');
    expect(byStatus.get('EXCEEDED')?.estimatedExhaustionDate).toBeNull();

    const completed = body.items.filter((item) => item.status === 'COMPLETED');
    expect(completed).toHaveLength(3);
    for (const item of completed) {
      expect(item.exhaustionProjection).toBe('period_ended');
      expect(item.estimatedExhaustionDate).toBeNull();
    }

    const all = body.items.find((item) => item.expectedSpend === '4000000.00');
    expect(all).toBeDefined();
    expect(all!.variance).toBe('0.00');
    expect(all!.pacePercent).toBe(100);
  });

  it('does not mutate transactions, budgets or alerts when read', async () => {
    const before = await Promise.all([
      prisma.transaction.count({ where: { userId: alice.id } }),
      prisma.budget.count({ where: { userId: alice.id } }),
      prisma.budgetAlert.count(),
    ]);

    await alice.agent.get('/api/v1/analytics/categories?period=month&month=2024-03').expect(200);
    await alice.agent.get('/api/v1/analytics/budgets?month=2024-03').expect(200);
    await alice.agent.get('/api/v1/analytics/budget-pace?month=2024-03').expect(200);

    const after = await Promise.all([
      prisma.transaction.count({ where: { userId: alice.id } }),
      prisma.budget.count({ where: { userId: alice.id } }),
      prisma.budgetAlert.count(),
    ]);
    expect(after).toEqual(before);
  });

  it('rejects invalid filters with 400', async () => {
    await alice.agent.get('/api/v1/analytics/categories?type=TRANSFER').expect(400);
    await alice.agent.get('/api/v1/analytics/categories?categoryId=not-a-uuid').expect(400);
    await alice.agent.get('/api/v1/analytics/categories?months=5').expect(400);
    await alice.agent.get('/api/v1/analytics/categories?period=month&month=2024-13').expect(400);
    await alice.agent.get('/api/v1/analytics/categories?currency=US').expect(400);
    await alice.agent.get('/api/v1/analytics/categories?unexpected=1').expect(400);
    await alice.agent.get('/api/v1/analytics/budgets?month=2024-13').expect(400);
    await alice.agent.get('/api/v1/analytics/budgets?currency=US').expect(400);
    await alice.agent.get('/api/v1/analytics/budget-pace?month=13-2024').expect(400);
  });
});
