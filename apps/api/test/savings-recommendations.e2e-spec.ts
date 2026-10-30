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
import { AuthService } from '../src/modules/auth/auth.service';

const TIMEZONE = 'Asia/Ho_Chi_Minh';

interface ItemBody {
  goalId: string;
  goalName: string;
  currency: string;
  displayStatus: 'ACTIVE' | 'COMPLETED' | 'ARCHIVED' | 'PAUSED' | 'OVERDUE';
  targetDate: string | null;
  monthsRemaining: number | null;
  remainingAmount: string;
  requiredMonthlySaving: string | null;
  recommendedMonthlySaving: string | null;
  estimatedCompletionDate: string | null;
  feasibility: 'ON_TRACK' | 'AT_RISK' | 'NOT_FEASIBLE' | 'INSUFFICIENT_DATA';
  priority: number;
  priorityReason: string;
  explanation: string;
}

interface RecommendationsBody {
  currency: string;
  timezone: string;
  generatedAt: string;
  status: 'available' | 'no_capacity' | 'insufficient_data';
  capacity: {
    status: string;
    reason: 'no_complete_months' | 'no_income' | null;
    currency: string;
    monthsAnalyzed: number;
    analyzedMonths: string[];
    averageMonthlyIncome: string | null;
    averageMonthlyExpense: string | null;
    averageNetCashFlow: string | null;
    historicalSavingsRate: number | null;
    safetyBufferPercent: number;
    safetyBufferAmount: string | null;
    suggestedMonthlySaving: string | null;
    isPositive: boolean;
    confidence: 'high' | 'medium' | 'low';
  };
  monthlyBudget: string | null;
  simulated: boolean;
  simulatedMonthlySaving: string | null;
  items: ItemBody[];
  allocatedMonthly: string;
  unallocatedMonthly: string | null;
  excluded: { paused: number; completed: number; archived: number };
  assumptions: string[];
  limitations: string[];
}

interface UserState {
  id: string;
  agent: SuperAgentTest;
  vndAccountId: string;
  usdAccountId: string;
}

/** Local date (Asia/Ho_Chi_Minh) at an offset of whole months/days. */
function localDate(offset: { months?: number; days?: number } = {}): string {
  return DateTime.now()
    .setZone(TIMEZONE)
    .plus({ months: offset.months ?? 0, days: offset.days ?? 0 })
    .toFormat('yyyy-MM-dd');
}

/** A fixed instant at local noon on a day inside a month offset, so the
 * timezone day matches the date part and the month always exists. */
function localNoonInMonth(monthOffset: number, day = 10): string {
  return (
    DateTime.now()
      .setZone(TIMEZONE)
      .startOf('month')
      .plus({ months: monthOffset })
      .set({ day, hour: 12, minute: 0, second: 0, millisecond: 0 })
      .toISO() ?? ''
  );
}

function localNoonDaysAgo(days: number): string {
  return (
    DateTime.now()
      .setZone(TIMEZONE)
      .minus({ days })
      .set({ hour: 12, minute: 0, second: 0, millisecond: 0 })
      .toISO() ?? ''
  );
}

async function createSession(
  application: NestExpressApplication,
  service: AuthService,
  email: string,
  displayName: string,
): Promise<UserState> {
  const user = await service.register({ email, password: 'Password123!', displayName });
  const token = await service.issueAccessToken(user);
  const agent = request.agent(application.getHttpServer()) as unknown as SuperAgentTest;
  const jar = (agent as unknown as { jar: { setCookie(cookie: string): void } }).jar;
  jar.setCookie(`${ACCESS_TOKEN_COOKIE}=${token}; Path=/`);
  return { id: user.id, agent, vndAccountId: '', usdAccountId: '' };
}

/**
 * Savings recommendations are derived from the last completed months of real
 * transactions, so the data is seeded relative to "today" in Asia/Ho_Chi_Minh.
 * The current (in-progress) month is deliberately seeded with an outlier to
 * prove it is never averaged in.
 */
describe('Savings recommendations API (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let authService: AuthService;
  let alice: UserState;
  let bob: UserState;
  let carol: UserState;
  const stamp = `${Date.now()}.${Math.floor(Math.random() * 1e6)}`;

  let nearGoalId = '';
  let farGoalId = '';

  async function createAccounts(userId: string): Promise<{ vnd: string; usd: string }> {
    const vnd = await prisma.account.create({
      data: { userId, name: 'Tiền mặt', type: 'CASH', currency: 'VND' },
    });
    const usd = await prisma.account.create({
      data: { userId, name: 'USD', type: 'BANK', currency: 'USD' },
    });
    return { vnd: vnd.id, usd: usd.id };
  }

  function transaction(input: {
    userId: string;
    accountId: string;
    type: 'INCOME' | 'EXPENSE' | 'TRANSFER';
    amount: string;
    currency: string;
    occurredAt: string;
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
        description: 'Giao dịch kiểm thử đề xuất tiết kiệm',
        occurredAt: new Date(input.occurredAt),
        transferGroupId: input.transferGroupId ?? null,
        transferDirection: input.transferDirection ?? null,
      },
    });
  }

  async function seedStableCashFlow(user: UserState): Promise<void> {
    // Three completed months: income 10,000,000 and expenses 4,000,000 each.
    for (const offset of [-1, -2, -3]) {
      await transaction({
        userId: user.id,
        accountId: user.vndAccountId,
        type: 'INCOME',
        amount: '10000000.00',
        currency: 'VND',
        occurredAt: localNoonInMonth(offset, 5),
      });
      await transaction({
        userId: user.id,
        accountId: user.vndAccountId,
        type: 'EXPENSE',
        amount: '4000000.00',
        currency: 'VND',
        occurredAt: localNoonInMonth(offset, 20),
      });
      // Moving 5,000,000 between own accounts must never count as income or expense.
      await transaction({
        userId: user.id,
        accountId: user.vndAccountId,
        type: 'TRANSFER',
        amount: '5000000.00',
        currency: 'VND',
        occurredAt: localNoonInMonth(offset, 12),
        transferGroupId: `7c7c7c7c-0000-4000-8000-00000000000${offset === -1 ? 1 : offset === -2 ? 2 : 3}`,
        transferDirection: 'OUT',
      });
    }
    // The in-progress month holds an outlier that must be excluded entirely.
    await transaction({
      userId: user.id,
      accountId: user.vndAccountId,
      type: 'INCOME',
      amount: '99000000.00',
      currency: 'VND',
      occurredAt: localNoonInMonth(0, 1),
    });
  }

  async function createGoal(input: Record<string, unknown>) {
    const response = await alice.agent.post('/api/v1/goals').send(input).expect(201);
    return (response.body as { goal: { id: string; targetDate: string | null } }).goal;
  }

  async function contribute(goalId: string, amount: string, daysAgo = 2) {
    await alice.agent
      .post(`/api/v1/goals/${goalId}/contributions`)
      .send({ amount, contributedAt: localNoonDaysAgo(daysAgo) })
      .expect(201);
  }

  async function recommendations(agent: SuperAgentTest, query = ''): Promise<RecommendationsBody> {
    const response = await agent
      .get(`/api/v1/insights/savings-recommendations${query}`)
      .expect(200);
    return response.body as RecommendationsBody;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false });
    configureApp(app);
    await app.init();

    prisma = app.get(PrismaService);
    authService = app.get(AuthService);

    alice = await createSession(
      app,
      authService,
      `savings.alice.${stamp}@example.com`,
      'Alice Savings',
    );
    bob = await createSession(app, authService, `savings.bob.${stamp}@example.com`, 'Bob Savings');
    carol = await createSession(
      app,
      authService,
      `savings.carol.${stamp}@example.com`,
      'Carol Savings',
    );

    const aliceAccounts = await createAccounts(alice.id);
    alice.vndAccountId = aliceAccounts.vnd;
    alice.usdAccountId = aliceAccounts.usd;
    await seedStableCashFlow(alice);

    const bobAccounts = await createAccounts(bob.id);
    bob.vndAccountId = bobAccounts.vnd;
    bob.usdAccountId = bobAccounts.usd;

    const carolAccounts = await createAccounts(carol.id);
    carol.vndAccountId = carolAccounts.vnd;
    carol.usdAccountId = carolAccounts.usd;
    await seedStableCashFlow(carol);

    // A USD transaction in a completed month proves currencies stay separate.
    await transaction({
      userId: alice.id,
      accountId: alice.usdAccountId,
      type: 'INCOME',
      amount: '1000.00',
      currency: 'USD',
      occurredAt: localNoonInMonth(-1, 15),
    });

    // Nearest deadline: 12,000,000 over 6 months → 2,000,000/month required.
    const near = await createGoal({
      name: 'Mua laptop',
      targetAmount: '12000000',
      startDate: localDate({ days: -120 }),
      targetDate: localDate({ months: 6 }),
    });
    nearGoalId = near.id;

    // Further deadline with saving already recorded: 30,000,000 over 12 months
    // → 2,500,000/month required.
    const far = await createGoal({
      name: 'Quỹ dự phòng',
      targetAmount: '36000000',
      startDate: localDate({ days: -120 }),
      targetDate: localDate({ months: 12 }),
    });
    farGoalId = far.id;
    await contribute(far.id, '6000000.00');

    // Statuses that must never receive an allocation.
    const paused = await createGoal({
      name: 'Tạm dừng',
      targetAmount: '9000000',
      startDate: localDate({ days: -60 }),
      targetDate: localDate({ months: 4 }),
    });
    await alice.agent.patch(`/api/v1/goals/${paused.id}`).send({ status: 'PAUSED' }).expect(200);

    const completed = await createGoal({
      name: 'Đã xong',
      targetAmount: '5000000',
      startDate: localDate({ days: -60 }),
      targetDate: localDate({ months: 2 }),
    });
    await contribute(completed.id, '5000000.00', 1);

    const archived = await createGoal({
      name: 'Lưu trữ',
      targetAmount: '7000000',
      startDate: localDate({ days: -60 }),
      targetDate: localDate({ months: 3 }),
    });
    await alice.agent.delete(`/api/v1/goals/${archived.id}`).expect(200);

    // A USD goal belongs to another currency bucket.
    await createGoal({
      name: 'MacBook',
      targetAmount: '2000',
      currency: 'USD',
      startDate: localDate({ days: -30 }),
      targetDate: localDate({ months: 8 }),
    });

    // Carol: an overdue goal and a goal without a deadline share one budget.
    await carol.agent
      .post('/api/v1/goals')
      .send({
        name: 'Quá hạn',
        targetAmount: '10000000',
        startDate: localDate({ days: -90 }),
        targetDate: localDate({ days: -1 }),
      })
      .expect(201)
      .then(async (response) => {
        const goalId = (response.body as { goal: { id: string } }).goal.id;
        await carol.agent
          .post(`/api/v1/goals/${goalId}/contributions`)
          .send({ amount: '1000000', contributedAt: localNoonDaysAgo(2) })
          .expect(201);
        await carol.agent
          .post('/api/v1/goals')
          .send({
            name: 'Không hạn',
            targetAmount: '8000000',
            startDate: localDate({ days: -30 }),
          })
          .expect(201);
      });

    // Bob holds a goal so the isolation test can prove it never leaks to alice.
    await bob.agent
      .post('/api/v1/goals')
      .send({ name: 'Của Bob', targetAmount: '1000000' })
      .expect(201);
  });

  afterAll(async () => {
    await app.close();
  });

  it('derives the capacity from the last completed months only', async () => {
    const body = await recommendations(alice.agent);

    expect(body).toMatchObject({
      currency: 'VND',
      timezone: TIMEZONE,
      status: 'available',
      simulated: false,
      simulatedMonthlySaving: null,
      monthlyBudget: '4800000.00',
      capacity: {
        status: 'available',
        reason: null,
        currency: 'VND',
        monthsAnalyzed: 3,
        averageMonthlyIncome: '10000000.00',
        averageMonthlyExpense: '4000000.00',
        averageNetCashFlow: '6000000.00',
        historicalSavingsRate: 60,
        safetyBufferPercent: 20,
        safetyBufferAmount: '1200000.00',
        suggestedMonthlySaving: '4800000.00',
        isPositive: true,
        confidence: 'high',
      },
    });
    // The in-progress month and the transfers were left out of the averages.
    expect(body.capacity.analyzedMonths).not.toContain(
      DateTime.now().setZone(TIMEZONE).toFormat('yyyy-MM'),
    );
    expect(body.capacity.analyzedMonths).toHaveLength(3);
    expect(body.generatedAt).toBeTruthy();
    expect(Number.isNaN(Date.parse(body.generatedAt))).toBe(false);
    expect(body.assumptions.length).toBeGreaterThan(0);
    expect(body.limitations.length).toBeGreaterThan(0);
  });

  it('allocates in deadline order without ever exceeding the capacity', async () => {
    const body = await recommendations(alice.agent);

    expect(body.items.map((item) => [item.goalId, item.priority])).toEqual([
      [nearGoalId, 1],
      [farGoalId, 2],
    ]);
    expect(body.items.map((item) => item.recommendedMonthlySaving)).toEqual([
      '2000000.00',
      '2500000.00',
    ]);
    expect(body.items.every((item) => item.feasibility === 'ON_TRACK')).toBe(true);
    expect(body.items[0].estimatedCompletionDate).toBe(body.items[0].targetDate);
    expect(body.items[1].estimatedCompletionDate).toBe(body.items[1].targetDate);
    expect(body.items[0].priorityReason).toContain(body.items[0].targetDate ?? '');
    expect(body.allocatedMonthly).toBe('4500000.00');
    expect(body.unallocatedMonthly).toBe('300000.00');

    const allocated = body.items.reduce(
      (sum, item) => sum + Number(item.recommendedMonthlySaving ?? '0'),
      0,
    );
    expect(allocated).toBeLessThanOrEqual(Number(body.monthlyBudget));
  });

  it('excludes paused, completed and archived goals without touching them', async () => {
    const body = await recommendations(alice.agent);

    expect(body.excluded).toEqual({ paused: 1, completed: 1, archived: 1 });
    const ids = body.items.map((item) => item.goalId);
    expect(ids).not.toContain(
      (
        await prisma.savingsGoal.findFirst({
          where: { userId: alice.id, status: 'PAUSED' },
        })
      )?.id,
    );
    const activated = await alice.agent.get('/api/v1/goals?includeArchived=true').expect(200);
    const allGoals = (activated.body as { items: { id: string; status: string }[] }).items;
    expect(allGoals.filter((goal) => goal.status === 'COMPLETED')).toHaveLength(1);
    expect(allGoals.find((goal) => goal.status === 'ARCHIVED')).toBeDefined();
  });

  it('simulates a different monthly amount without writing any goal or contribution', async () => {
    const goalBefore = await alice.agent.get(`/api/v1/goals/${farGoalId}`).expect(200);
    const body = await recommendations(alice.agent, '?assumedMonthlySaving=3000000');

    expect(body).toMatchObject({
      status: 'available',
      simulated: true,
      simulatedMonthlySaving: '3000000.00',
      monthlyBudget: '3000000.00',
      allocatedMonthly: '3000000.00',
      unallocatedMonthly: '0.00',
    });
    expect(body.capacity.suggestedMonthlySaving).toBe('4800000.00');
    expect(body.items[0]).toMatchObject({
      goalId: nearGoalId,
      recommendedMonthlySaving: '2000000.00',
      feasibility: 'ON_TRACK',
    });
    expect(body.items[1]).toMatchObject({
      goalId: farGoalId,
      recommendedMonthlySaving: '1000000.00',
      feasibility: 'AT_RISK',
    });
    expect(body.items[1].explanation).toContain('thấp hơn mức cần thiết');

    // Re-read from the database: nothing was recorded by the simulation.
    const goalAfter = await alice.agent.get(`/api/v1/goals/${farGoalId}`).expect(200);
    expect(goalAfter.body).toEqual(goalBefore.body);
    expect(await prisma.goalContribution.count({ where: { goalId: farGoalId } })).toBe(1);
    expect(await prisma.savingsGoal.count({ where: { userId: alice.id, status: 'ACTIVE' } })).toBe(
      3,
    );
  });

  it('keeps currencies separate: the USD bucket ignores the VND cash flow', async () => {
    const body = await recommendations(alice.agent, '?currency=USD');

    expect(body).toMatchObject({
      currency: 'USD',
      status: 'available',
      monthlyBudget: '800.00',
      capacity: {
        status: 'available',
        currency: 'USD',
        monthsAnalyzed: 1,
        averageMonthlyIncome: '1000.00',
        averageMonthlyExpense: '0.00',
        averageNetCashFlow: '1000.00',
        suggestedMonthlySaving: '800.00',
        confidence: 'low',
      },
    });
    // Only the USD goal is considered, sized in USD with no VND amounts mixed in.
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toMatchObject({
      goalName: 'MacBook',
      currency: 'USD',
      remainingAmount: '2000.00',
      requiredMonthlySaving: '250.00',
      recommendedMonthlySaving: '250.00',
      feasibility: 'ON_TRACK',
    });
    expect(body.excluded).toEqual({ paused: 0, completed: 0, archived: 0 });
  });

  it('returns insufficient data instead of a made-up capacity when there is no history', async () => {
    const body = await recommendations(bob.agent);

    expect(body).toMatchObject({
      status: 'insufficient_data',
      monthlyBudget: null,
      unallocatedMonthly: null,
      excluded: { paused: 0, completed: 0, archived: 0 },
    });
    expect(body.capacity).toMatchObject({
      monthsAnalyzed: 0,
      analyzedMonths: [],
      averageMonthlyIncome: null,
      suggestedMonthlySaving: null,
      isPositive: false,
      confidence: 'low',
    });
    // The user's only goal cannot be sized, so nothing is recommended.
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toMatchObject({
      goalName: 'Của Bob',
      feasibility: 'INSUFFICIENT_DATA',
      recommendedMonthlySaving: null,
      estimatedCompletionDate: null,
    });
    expect(body.allocatedMonthly).toBe('0.00');
  });

  it("never includes another user's goals or cash flow", async () => {
    const aliceBody = await recommendations(alice.agent);
    const bobBody = await recommendations(bob.agent);
    const carolBody = await recommendations(carol.agent);

    const aliceIds = aliceBody.items.map((item) => item.goalId);
    const bobIds = bobBody.items.map((item) => item.goalId);
    const carolIds = carolBody.items.map((item) => item.goalId);

    expect(bobBody.items.map((item) => item.goalName)).toEqual(['Của Bob']);
    expect(aliceIds).not.toEqual(expect.arrayContaining(bobIds));
    expect(aliceIds).not.toEqual(expect.arrayContaining(carolIds));
    expect(bobIds).not.toEqual(expect.arrayContaining(aliceIds));
    expect(carolBody.capacity.averageMonthlyIncome).toBe('10000000.00');
    expect(bobBody.capacity.averageMonthlyIncome).toBeNull();
  });

  it('handles an overdue goal separately and caps the allocation at the budget', async () => {
    const body = await recommendations(carol.agent);

    expect(body.status).toBe('available');
    expect(body.items).toHaveLength(2);
    expect(body.items[0]).toMatchObject({
      goalName: 'Quá hạn',
      displayStatus: 'OVERDUE',
      feasibility: 'NOT_FEASIBLE',
      recommendedMonthlySaving: '4800000.00',
      priority: 1,
    });
    expect(body.items[0].explanation).toContain('Đã quá hạn');
    // The budget is exhausted by the higher priority goal.
    expect(body.items[1]).toMatchObject({
      goalName: 'Không hạn',
      recommendedMonthlySaving: '0.00',
      estimatedCompletionDate: null,
      feasibility: 'NOT_FEASIBLE',
      priority: 2,
    });
    expect(body.allocatedMonthly).toBe('4800000.00');
    expect(body.unallocatedMonthly).toBe('0.00');
  });

  it('rejects an unauthenticated call and invalid query parameters', async () => {
    await request(app.getHttpServer()).get('/api/v1/insights/savings-recommendations').expect(401);

    await alice.agent.get('/api/v1/insights/savings-recommendations?currency=VN').expect(400);
    await alice.agent
      .get('/api/v1/insights/savings-recommendations?assumedMonthlySaving=abc')
      .expect(400);
    await alice.agent
      .get('/api/v1/insights/savings-recommendations?assumedMonthlySaving=-100')
      .expect(400);
    await alice.agent.get('/api/v1/insights/savings-recommendations?unknown=1').expect(400);
  });
});
