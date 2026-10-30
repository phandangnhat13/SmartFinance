import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { DateTime } from 'luxon';
import request from 'supertest';
import type { SuperAgentTest } from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { ACCESS_TOKEN_COOKIE } from '../src/common/guards/jwt-auth.guard';
import { AuthService } from '../src/modules/auth/auth.service';

const TIMEZONE = 'Asia/Ho_Chi_Minh';

interface GoalBody {
  id: string;
  name: string;
  targetAmount: string;
  savedAmount: string;
  remainingAmount: string;
  currency: string;
  startDate: string;
  targetDate: string | null;
  status: string;
  displayStatus: string;
  contributions: { id: string; amount: string }[];
}

interface GoalProgressBody {
  goalId: string;
  currency: string;
  savedAmount: string;
  remainingAmount: string;
  progressStatus: string;
  expectedAmount: string | null;
  actualVsExpected: string | null;
  statusReason: string;
  pace: {
    averageMonthlyContribution: string | null;
    monthsToComplete: number | null;
    estimatedCompletionDate: string | null;
  };
  timeline: { month: string; actualSaved: string; expectedSaved: string }[];
}

interface ProgressBody {
  currency: string;
  timezone: string;
  today: string;
  summary: Record<string, number | string>;
  goals: GoalProgressBody[];
  excluded: { archived: number };
  rules: string[];
  limitations: string[];
}

interface HistoryBody {
  currency: string;
  monthCount: number;
  fromMonth: string;
  toMonth: string;
  goalId: string | null;
  openingAmount: string;
  totalAmount: string;
  totalCount: number;
  months: { month: string; amount: string; count: number; cumulativeAmount: string }[];
  items: { id: string; goalName: string; amount: string }[];
}

interface Session {
  id: string;
  agent: SuperAgentTest;
}

function localDate(offsetDays = 0): string {
  return DateTime.now().setZone(TIMEZONE).plus({ days: offsetDays }).toFormat('yyyy-MM-dd');
}

function localDatePlusMonths(months: number): string {
  return DateTime.now().setZone(TIMEZONE).plus({ months }).toFormat('yyyy-MM-dd');
}

function localNoon(offsetDays: number): string {
  return (
    DateTime.now()
      .setZone(TIMEZONE)
      .plus({ days: offsetDays })
      .set({ hour: 12, minute: 0, second: 0, millisecond: 0 })
      .toISO() ?? ''
  );
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
 * Savings progress, history and plan simulation endpoints. Every goal and
 * contribution here belongs to throwaway users in the isolated test database,
 * and each test uses its own currency so totals are not polluted by other
 * tests in the suite.
 */
describe('Savings progress API (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let authService: AuthService;
  let alice: Session;
  let bob: Session;
  const stamp = `${Date.now()}.${Math.floor(Math.random() * 1e6)}`;

  async function createGoal(input: Record<string, unknown>): Promise<GoalBody> {
    const response = await alice.agent.post('/api/v1/goals').send(input).expect(201);
    return (response.body as { goal: GoalBody }).goal;
  }

  async function fetchGoal(id: string): Promise<GoalBody> {
    const response = await alice.agent.get(`/api/v1/goals/${id}`).expect(200);
    return (response.body as { goal: GoalBody }).goal;
  }

  async function contribute(
    goalId: string,
    amount: string,
    contributedAt = localNoon(-1),
  ): Promise<GoalBody> {
    const response = await alice.agent
      .post(`/api/v1/goals/${goalId}/contributions`)
      .send({ amount, contributedAt })
      .expect(201);
    return (response.body as { goal: GoalBody }).goal;
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
  });

  afterAll(async () => {
    await app.close();
  });

  it('requires authentication on every savings route', async () => {
    const server = request(app.getHttpServer());
    await server.get('/api/v1/savings/progress').expect(401);
    await server.get('/api/v1/savings/progress/11111111-1111-1111-1111-111111111111').expect(401);
    await server.get('/api/v1/savings/contribution-history').expect(401);
    await server
      .post('/api/v1/savings/simulations')
      .send({ scenario: 'MONTHLY_AMOUNT' })
      .expect(401);
    await server.post('/api/v1/savings/adjustments/preview').send({}).expect(401);
    await server.post('/api/v1/savings/adjustments/apply').send({}).expect(401);
  });

  it('builds a per-currency dashboard with expected versus actual progress', async () => {
    const currency = 'CAD';
    const onTrack = await createGoal({
      name: 'Dashboard on track',
      targetAmount: '10000000',
      currency,
      startDate: localDate(-30),
      targetDate: localDatePlusMonths(6),
    });
    await contribute(onTrack.id, '2000000', localNoon(-10));

    const overdue = await createGoal({
      name: 'Dashboard overdue',
      targetAmount: '5000000',
      currency,
      startDate: localDate(-60),
      targetDate: localDate(-1),
    });
    await contribute(overdue.id, '1000000', localNoon(-2));

    const usd = await createGoal({
      name: 'Dashboard USD',
      targetAmount: '1000',
      currency: 'USD',
      startDate: localDate(-10),
      targetDate: localDatePlusMonths(3),
    });

    const archived = await createGoal({
      name: 'Dashboard archived',
      targetAmount: '1000000',
      currency,
      startDate: localDate(-10),
      targetDate: localDatePlusMonths(2),
    });
    await alice.agent.delete(`/api/v1/goals/${archived.id}`).expect(200);

    const response = await alice.agent
      .get(`/api/v1/savings/progress?currency=${currency}`)
      .expect(200);
    const body = response.body as ProgressBody;

    expect(body.currency).toBe(currency);
    expect(body.timezone).toBe(TIMEZONE);
    expect(body.goals.map((goal) => goal.goalId)).toEqual([overdue.id, onTrack.id]);
    expect(body.goals[0].progressStatus).toBe('OVERDUE');
    expect(body.goals[1].progressStatus).toBe('ON_TRACK');
    expect(body.excluded).toEqual({ archived: 1 });
    expect(body.summary).toMatchObject({
      activeGoals: 2,
      overdue: 1,
      onTrack: 1,
      totalTargetAmount: '15000000.00',
      totalSavedAmount: '3000000.00',
      totalRemainingAmount: '12000000.00',
      overallPercentage: 20,
    });
    expect(body.rules.length).toBeGreaterThan(0);
    expect(body.limitations.join(' ')).toContain(currency);

    const goal = body.goals[1];
    expect(goal.expectedAmount).not.toBeNull();
    expect(goal.actualVsExpected).not.toBeNull();
    expect(goal.pace.averageMonthlyContribution).toBe('2000000.00');
    expect(goal.pace.monthsToComplete).toBe(4);
    expect(goal.timeline.length).toBeGreaterThan(0);
    expect(goal.statusReason).toContain('Đúng tiến độ');

    const usdOnly = await alice.agent.get('/api/v1/savings/progress?currency=USD').expect(200);
    const usdBody = usdOnly.body as ProgressBody;
    expect(usdBody.goals.map((entry) => entry.goalId)).toEqual([usd.id]);
    expect(usdBody.summary.totalSavedAmount).toBe('0.00');

    await alice.agent.get('/api/v1/savings/progress?currency=US').expect(400);
    await alice.agent.get('/api/v1/savings/progress?unknown=1').expect(400);
  });

  it('returns one owned goal and never another user’s', async () => {
    const goal = await createGoal({
      name: 'Chi tiết tiến độ',
      targetAmount: '8000000',
      currency: 'AUD',
      startDate: localDate(-20),
      targetDate: localDatePlusMonths(4),
    });
    await contribute(goal.id, '1000000', localNoon(-5));

    const response = await alice.agent.get(`/api/v1/savings/progress/${goal.id}`).expect(200);
    const body = response.body as GoalProgressBody;
    expect(body.goalId).toBe(goal.id);
    expect(body.currency).toBe('AUD');
    expect(body.savedAmount).toBe('1000000.00');
    expect(body.remainingAmount).toBe('7000000.00');

    await bob.agent.get(`/api/v1/savings/progress/${goal.id}`).expect(404);
    await alice.agent.get('/api/v1/savings/progress/not-a-uuid').expect(400);
  });

  it('summarises contributions per month with an opening balance', async () => {
    const goal = await createGoal({
      name: 'Lịch sử góp',
      targetAmount: '20000000',
      currency: 'PLN',
      startDate: localDate(-200),
      targetDate: localDatePlusMonths(6),
    });
    await contribute(goal.id, '1000000', localNoon(-120));
    await contribute(goal.id, '2000000', localNoon(-20));
    await contribute(goal.id, '3000000', localNoon(-2));

    const response = await alice.agent
      .get(`/api/v1/savings/contribution-history?goalId=${goal.id}&months=3`)
      .expect(200);
    const body = response.body as HistoryBody;

    expect(body.currency).toBe('PLN');
    expect(body.goalId).toBe(goal.id);
    expect(body.monthCount).toBe(3);
    expect(body.months).toHaveLength(3);
    expect(body.fromMonth <= body.toMonth).toBe(true);
    expect(body.openingAmount).toBe('1000000.00');
    expect(body.totalAmount).toBe('5000000.00');
    expect(body.totalCount).toBe(2);
    expect(body.items).toHaveLength(2);
    expect(body.items[0].amount).toBe('3000000.00');
    // Opening + window total must equal everything ever recorded for the goal.
    const last = body.months[body.months.length - 1];
    expect(last.cumulativeAmount).toBe('6000000.00');

    const all = await alice.agent.get('/api/v1/savings/contribution-history?months=3').expect(200);
    expect((all.body as HistoryBody).currency).toBe('VND');
    expect((all.body as HistoryBody).goalId).toBeNull();

    await bob.agent.get(`/api/v1/savings/contribution-history?goalId=${goal.id}`).expect(404);
    await alice.agent.get('/api/v1/savings/contribution-history?months=0').expect(400);
    await alice.agent.get('/api/v1/savings/contribution-history?months=37').expect(400);
    await alice.agent.get('/api/v1/savings/contribution-history?months=abc').expect(400);
    await alice.agent.get('/api/v1/savings/contribution-history?goalId=nope').expect(400);
  });

  it('simulates a plan without writing anything', async () => {
    const goal = await createGoal({
      name: 'Mô phỏng JPY',
      targetAmount: '12000000',
      currency: 'JPY',
      startDate: localDate(-30),
      targetDate: localDatePlusMonths(6),
    });
    await contribute(goal.id, '3000000', localNoon(-5));
    const before = await fetchGoal(goal.id);
    const contributionsBefore = await prisma.goalContribution.count({
      where: { goalId: goal.id },
    });

    const monthly = await alice.agent
      .post('/api/v1/savings/simulations')
      .send({ scenario: 'MONTHLY_AMOUNT', goalId: goal.id, monthlyAmount: '2000000' })
      .expect(200);
    const monthlyBody = monthly.body as {
      scenario: string;
      simulated: { monthlySaving: string; monthsToComplete: number };
      difference: { monthlySaving: string };
      feasibility: string;
      limitations: string[];
    };
    expect(monthlyBody.scenario).toBe('MONTHLY_AMOUNT');
    expect(monthlyBody.simulated.monthlySaving).toBe('2000000.00');
    expect(monthlyBody.simulated.monthsToComplete).toBe(5);
    expect(monthlyBody.difference.monthlySaving).toBe((2_000_000 - 9_000_000 / 6).toFixed(2));
    expect(monthlyBody.limitations.join(' ')).toContain('mô phỏng');

    const deadline = await alice.agent
      .post('/api/v1/savings/simulations')
      .send({ scenario: 'DEADLINE', goalId: goal.id, targetDate: localDatePlusMonths(3) })
      .expect(200);
    expect(
      (deadline.body as { simulated: { monthlySaving: string } }).simulated.monthlySaving,
    ).toBe('3000000.00');

    await alice.agent
      .post('/api/v1/savings/simulations')
      .send({ scenario: 'TARGET_AMOUNT', goalId: goal.id, targetAmount: '15000000' })
      .expect(200);

    const budget = await alice.agent
      .post('/api/v1/savings/simulations')
      .send({ scenario: 'MULTI_GOAL_BUDGET', budget: '5000000', currency: 'JPY' })
      .expect(200);
    const budgetBody = budget.body as {
      budget: string;
      currency: string;
      simulated: { allocatedMonthly: string; infeasibleGoalIds: string[] };
      differences: { goalId: string }[];
    };
    expect(budgetBody.currency).toBe('JPY');
    expect(budgetBody.budget).toBe('5000000.00');
    expect(Number(budgetBody.simulated.allocatedMonthly)).toBeLessThanOrEqual(5_000_000);
    expect(budgetBody.differences.map((entry) => entry.goalId)).toContain(goal.id);

    const after = await fetchGoal(goal.id);
    expect(after).toEqual(before);
    expect(await prisma.goalContribution.count({ where: { goalId: goal.id } })).toBe(
      contributionsBefore,
    );
  });

  it('rejects malformed and cross-user simulations', async () => {
    const goal = await createGoal({
      name: 'Mô phỏng lỗi',
      targetAmount: '10000000',
      currency: 'CHF',
      startDate: localDate(-30),
      targetDate: localDatePlusMonths(6),
    });
    await contribute(goal.id, '2000000', localNoon(-3));

    await alice.agent
      .post('/api/v1/savings/simulations')
      .send({ scenario: 'NOPE', goalId: goal.id })
      .expect(400);
    await alice.agent
      .post('/api/v1/savings/simulations')
      .send({ scenario: 'MONTHLY_AMOUNT', goalId: goal.id })
      .expect(400);
    await alice.agent
      .post('/api/v1/savings/simulations')
      .send({ scenario: 'MONTHLY_AMOUNT', goalId: goal.id, monthlyAmount: '0' })
      .expect(400);
    await alice.agent
      .post('/api/v1/savings/simulations')
      .send({ scenario: 'MONTHLY_AMOUNT', goalId: goal.id, monthlyAmount: '100000', budget: '1' })
      .expect(400);
    await alice.agent
      .post('/api/v1/savings/simulations')
      .send({ scenario: 'MULTI_GOAL_BUDGET', goalId: goal.id, budget: '1000000' })
      .expect(400);
    await alice.agent
      .post('/api/v1/savings/simulations')
      .send({ scenario: 'TARGET_AMOUNT', goalId: goal.id, targetAmount: '1000000' })
      .expect(400);
    await alice.agent
      .post('/api/v1/savings/simulations')
      .send({ scenario: 'DEADLINE', goalId: goal.id, targetDate: localDate(-40) })
      .expect(400);
    await alice.agent
      .post('/api/v1/savings/simulations')
      .send({ scenario: 'MONTHLY_AMOUNT', goalId: 'nope', monthlyAmount: '100000' })
      .expect(400);

    await bob.agent
      .post('/api/v1/savings/simulations')
      .send({ scenario: 'MONTHLY_AMOUNT', goalId: goal.id, monthlyAmount: '100000' })
      .expect(404);

    const archived = await createGoal({
      name: 'Mô phỏng lưu trữ',
      targetAmount: '1000000',
      currency: 'CHF',
      startDate: localDate(-10),
      targetDate: localDatePlusMonths(2),
    });
    await alice.agent.delete(`/api/v1/goals/${archived.id}`).expect(200);
    await alice.agent
      .post('/api/v1/savings/simulations')
      .send({ scenario: 'MONTHLY_AMOUNT', goalId: archived.id, monthlyAmount: '100000' })
      .expect(400);
  });

  it('previews an adjustment without changing the goal', async () => {
    const goal = await createGoal({
      name: 'Xem trước điều chỉnh',
      targetAmount: '12000000',
      currency: 'GBP',
      startDate: localDate(-30),
      targetDate: localDatePlusMonths(6),
    });
    await contribute(goal.id, '3000000', localNoon(-5));
    const before = await fetchGoal(goal.id);

    const response = await alice.agent
      .post('/api/v1/savings/adjustments/preview')
      .send({ goalId: goal.id, targetAmount: '15000000' })
      .expect(200);
    const body = response.body as {
      canApply: boolean;
      changes: { field: string; oldValue: string; newValue: string }[];
      problems: string[];
      current: { remainingAmount: string };
      projected: { remainingAmount: string; savedAmount: string };
    };
    expect(body.canApply).toBe(true);
    expect(body.changes).toEqual([
      { field: 'targetAmount', oldValue: '12000000.00', newValue: '15000000.00' },
    ]);
    expect(body.current.remainingAmount).toBe('9000000.00');
    expect(body.projected.remainingAmount).toBe('12000000.00');
    expect(body.projected.savedAmount).toBe('3000000.00');

    const invalid = await alice.agent
      .post('/api/v1/savings/adjustments/preview')
      .send({ goalId: goal.id, targetAmount: '1000000' })
      .expect(200);
    expect((invalid.body as { canApply: boolean }).canApply).toBe(false);

    const backwards = await alice.agent
      .post('/api/v1/savings/adjustments/preview')
      .send({ goalId: goal.id, targetDate: localDate(-60) })
      .expect(200);
    expect(
      (backwards.body as { canApply: boolean; problems: string[] }).problems.join(' '),
    ).toContain('sau ngày bắt đầu');

    expect(await fetchGoal(goal.id)).toEqual(before);

    await alice.agent
      .post('/api/v1/savings/adjustments/preview')
      .send({ goalId: goal.id })
      .expect(200)
      .expect((res) => {
        expect((res.body as { canApply: boolean }).canApply).toBe(false);
      });
    await alice.agent
      .post('/api/v1/savings/adjustments/preview')
      .send({ goalId: 'nope', targetAmount: '1000' })
      .expect(400);
    await bob.agent
      .post('/api/v1/savings/adjustments/preview')
      .send({ goalId: goal.id, targetAmount: '15000000' })
      .expect(404);
  });

  it('applies only the confirmed fields and never records a contribution', async () => {
    const goal = await createGoal({
      name: 'Áp dụng điều chỉnh',
      targetAmount: '12000000',
      currency: 'SEK',
      startDate: localDate(-30),
      targetDate: localDatePlusMonths(6),
    });
    await contribute(goal.id, '3000000', localNoon(-5));
    const contributionsBefore = await prisma.goalContribution.count({ where: { goalId: goal.id } });

    const applied = await alice.agent
      .post('/api/v1/savings/adjustments/apply')
      .send({ goalId: goal.id, targetAmount: '15000000', targetDate: localDatePlusMonths(9) })
      .expect(200);
    const body = applied.body as {
      goal: GoalBody;
      progress: { goalId: string; remainingAmount: string; savedAmount: string };
    };
    expect(body.goal).toMatchObject({
      targetAmount: '15000000.00',
      targetDate: localDatePlusMonths(9),
      savedAmount: '3000000.00',
      remainingAmount: '12000000.00',
      currency: 'SEK',
    });
    expect(body.progress).toMatchObject({
      goalId: goal.id,
      savedAmount: '3000000.00',
      remainingAmount: '12000000.00',
    });

    const reloaded = await fetchGoal(goal.id);
    expect(reloaded.contributions).toHaveLength(1);
    expect(reloaded.savedAmount).toBe('3000000.00');
    expect(await prisma.goalContribution.count({ where: { goalId: goal.id } })).toBe(
      contributionsBefore,
    );

    await alice.agent
      .post('/api/v1/savings/adjustments/apply')
      .send({ goalId: goal.id })
      .expect(400);
    await alice.agent
      .post('/api/v1/savings/adjustments/apply')
      .send({ goalId: goal.id, targetAmount: '0' })
      .expect(400);
    await alice.agent
      .post('/api/v1/savings/adjustments/apply')
      .send({ goalId: goal.id, targetAmount: '1000000' })
      .expect(400);
    await alice.agent
      .post('/api/v1/savings/adjustments/apply')
      .send({ goalId: goal.id, targetDate: localDate(-60) })
      .expect(400);
    await alice.agent
      .post('/api/v1/savings/adjustments/apply')
      .send({ goalId: goal.id, startDate: localDate(-10) })
      .expect(400);
    await bob.agent
      .post('/api/v1/savings/adjustments/apply')
      .send({ goalId: goal.id, targetAmount: '16000000' })
      .expect(404);

    const archived = await createGoal({
      name: 'Điều chỉnh lưu trữ',
      targetAmount: '1000000',
      currency: 'SEK',
      startDate: localDate(-10),
      targetDate: localDatePlusMonths(2),
    });
    await alice.agent.delete(`/api/v1/goals/${archived.id}`).expect(200);
    await alice.agent
      .post('/api/v1/savings/adjustments/apply')
      .send({ goalId: archived.id, targetAmount: '2000000' })
      .expect(400);
  });
});
