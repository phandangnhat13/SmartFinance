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

interface GoalBody {
  id: string;
  name: string;
  description: string | null;
  targetAmount: string;
  savedAmount: string;
  remainingAmount: string;
  percentage: number;
  currency: string;
  startDate: string;
  targetDate: string | null;
  status: 'ACTIVE' | 'COMPLETED' | 'ARCHIVED' | 'PAUSED';
  displayStatus: 'ACTIVE' | 'COMPLETED' | 'ARCHIVED' | 'PAUSED' | 'OVERDUE';
  isOverdue: boolean;
  monthsRemaining: number | null;
  requiredMonthlySaving: string | null;
  contributions: { id: string; amount: string; contributedAt: string; note: string | null }[];
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

/** A fixed past instant at local noon, so the timezone day matches the date part. */
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
 * Savings goals derive progress from the contributions actually recorded, so
 * these tests use the isolated test database with throwaway users. Dates are
 * relative to "today" in Asia/Ho_Chi_Minh because overdue and months-remaining
 * depend on the day the suite runs.
 */
describe('Goals API (e2e)', () => {
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
      `goals.alice.${stamp}@example.com`,
      'Alice Goals',
    );
    bob = await createSession(app, authService, `goals.bob.${stamp}@example.com`, 'Bob Goals');
  });

  afterAll(async () => {
    await app.close();
  });

  it('creates a goal with the user defaults and exposes derived progress fields', async () => {
    const goal = await createGoal({
      name: '  Mua laptop mới  ',
      description: '   ',
      targetAmount: '30000000',
    });

    expect(goal).toMatchObject({
      name: 'Mua laptop mới',
      description: null,
      targetAmount: '30000000.00',
      savedAmount: '0.00',
      remainingAmount: '30000000.00',
      percentage: 0,
      currency: 'VND',
      startDate: localDate(),
      targetDate: null,
      status: 'ACTIVE',
      displayStatus: 'ACTIVE',
      isOverdue: false,
      monthsRemaining: null,
      requiredMonthlySaving: null,
    });
    expect(goal.contributions).toEqual([]);
  });

  it('rejects invalid money, dates and payloads', async () => {
    await alice.agent.post('/api/v1/goals').send({ name: 'Zero', targetAmount: '0' }).expect(400);
    await alice.agent
      .post('/api/v1/goals')
      .send({ name: 'Negative', targetAmount: '-1000' })
      .expect(400);
    await alice.agent
      .post('/api/v1/goals')
      .send({
        name: 'Same day',
        targetAmount: '1000',
        startDate: localDate(0),
        targetDate: localDate(0),
      })
      .expect(400);
    await alice.agent
      .post('/api/v1/goals')
      .send({
        name: 'Backwards',
        targetAmount: '1000',
        startDate: localDate(0),
        targetDate: localDate(-1),
      })
      .expect(400);
    await alice.agent
      .post('/api/v1/goals')
      .send({ name: 'Bad date', targetAmount: '1000', targetDate: '30/10/2026' })
      .expect(400);
    await alice.agent
      .post('/api/v1/goals')
      .send({ name: 'Bad currency', targetAmount: '1000', currency: 'US' })
      .expect(400);
    await alice.agent
      .post('/api/v1/goals')
      .send({ name: 'Unknown field', targetAmount: '1000', savedAmount: '500' })
      .expect(400);
    await alice.agent.post('/api/v1/goals').send({ name: '', targetAmount: '1000' }).expect(400);
    await alice.agent.get('/api/v1/goals?unknown=1').expect(400);
    await alice.agent.get('/api/v1/goals?includeArchived=yes').expect(400);
    await alice.agent.get('/api/v1/goals/not-a-uuid').expect(400);
  });

  it('tracks progress, remaining amount and the required monthly saving', async () => {
    const targetDate = localDatePlusMonths(6);
    const goal = await createGoal({
      name: 'Du lịch',
      targetAmount: '30000000',
      startDate: localDate(-30),
      targetDate,
    });

    const afterFirst = await contribute(goal.id, '5000000', localNoon(-10));
    expect(afterFirst).toMatchObject({
      savedAmount: '5000000.00',
      remainingAmount: '25000000.00',
      percentage: 16.67,
      currency: 'VND',
    });

    const afterSecond = await contribute(goal.id, '2000000', localNoon(-3));
    expect(afterSecond).toMatchObject({
      savedAmount: '7000000.00',
      remainingAmount: '23000000.00',
      percentage: 23.33,
      status: 'ACTIVE',
      displayStatus: 'ACTIVE',
    });
    expect(afterSecond.contributions).toHaveLength(2);
    expect(afterSecond.contributions[0].amount).toBe('2000000.00');

    expect(afterSecond.monthsRemaining).not.toBeNull();
    const months = afterSecond.monthsRemaining as number;
    expect(months).toBeGreaterThan(0);
    expect(afterSecond.requiredMonthlySaving).toBe((23_000_000 / months).toFixed(2));
  });

  it('rejects contributions that are non-positive, over the target or badly dated', async () => {
    const goal = await createGoal({
      name: 'Quỹ khẩn cấp',
      targetAmount: '10000000',
      startDate: localDate(-30),
      targetDate: localDatePlusMonths(6),
    });
    await contribute(goal.id, '4000000', localNoon(-5));

    await alice.agent
      .post(`/api/v1/goals/${goal.id}/contributions`)
      .send({ amount: '0', contributedAt: localNoon(-1) })
      .expect(400);
    await alice.agent
      .post(`/api/v1/goals/${goal.id}/contributions`)
      .send({ amount: '-1000', contributedAt: localNoon(-1) })
      .expect(400);
    await alice.agent
      .post(`/api/v1/goals/${goal.id}/contributions`)
      .send({ amount: '6000000.01', contributedAt: localNoon(-1) })
      .expect(400);
    await alice.agent
      .post(`/api/v1/goals/${goal.id}/contributions`)
      .send({ amount: '100000', contributedAt: localNoon(-31) })
      .expect(400);
    await alice.agent
      .post(`/api/v1/goals/${goal.id}/contributions`)
      .send({ amount: '100000', contributedAt: localNoon(2) })
      .expect(400);
    await alice.agent
      .post(`/api/v1/goals/${goal.id}/contributions`)
      .send({ amount: '100000', contributedAt: 'not-a-date' })
      .expect(400);

    const unchanged = await fetchGoal(goal.id);
    expect(unchanged.savedAmount).toBe('4000000.00');

    // Exactly the remaining amount is allowed and closes the goal.
    const completed = await contribute(goal.id, '6000000', localNoon(-1));
    expect(completed).toMatchObject({
      savedAmount: '10000000.00',
      remainingAmount: '0.00',
      percentage: 100,
      status: 'COMPLETED',
      displayStatus: 'COMPLETED',
      requiredMonthlySaving: '0.00',
    });
  });

  it('stops asking for saving once completed and reopens when the target grows', async () => {
    const goal = await createGoal({
      name: 'Mua xe đạp',
      targetAmount: '5000000',
      startDate: localDate(-20),
      targetDate: localDatePlusMonths(3),
    });
    const completed = await contribute(goal.id, '5000000', localNoon(-2));
    expect(completed.status).toBe('COMPLETED');
    expect(completed.requiredMonthlySaving).toBe('0.00');

    await alice.agent
      .post(`/api/v1/goals/${goal.id}/contributions`)
      .send({ amount: '100000', contributedAt: localNoon(-1) })
      .expect(400);

    const reopened = await alice.agent
      .patch(`/api/v1/goals/${goal.id}`)
      .send({ targetAmount: '8000000' })
      .expect(200);
    expect((reopened.body as { goal: GoalBody }).goal).toMatchObject({
      status: 'ACTIVE',
      displayStatus: 'ACTIVE',
      savedAmount: '5000000.00',
      remainingAmount: '3000000.00',
    });
    expect((reopened.body as { goal: GoalBody }).goal.requiredMonthlySaving).not.toBeNull();

    const reclosed = await alice.agent
      .patch(`/api/v1/goals/${goal.id}`)
      .send({ targetAmount: '5000000' })
      .expect(200);
    expect((reclosed.body as { goal: GoalBody }).goal.status).toBe('COMPLETED');
  });

  it('pauses, resumes and archives a goal while protecting archived data', async () => {
    const goal = await createGoal({
      name: 'Máy ảnh',
      targetAmount: '20000000',
      startDate: localDate(-10),
      targetDate: localDatePlusMonths(4),
    });

    const paused = await alice.agent
      .patch(`/api/v1/goals/${goal.id}`)
      .send({ status: 'PAUSED' })
      .expect(200);
    expect((paused.body as { goal: GoalBody }).goal).toMatchObject({
      status: 'PAUSED',
      displayStatus: 'PAUSED',
      requiredMonthlySaving: null,
      monthsRemaining: 4,
    });
    await alice.agent
      .post(`/api/v1/goals/${goal.id}/contributions`)
      .send({ amount: '100000', contributedAt: localNoon(-1) })
      .expect(400);

    const resumed = await alice.agent
      .patch(`/api/v1/goals/${goal.id}`)
      .send({ status: 'ACTIVE' })
      .expect(200);
    expect((resumed.body as { goal: GoalBody }).goal.displayStatus).toBe('ACTIVE');

    const archived = await alice.agent.delete(`/api/v1/goals/${goal.id}`).expect(200);
    expect((archived.body as { goal: GoalBody }).goal).toMatchObject({
      status: 'ARCHIVED',
      displayStatus: 'ARCHIVED',
      requiredMonthlySaving: null,
    });

    // Archiving is idempotent (soft delete) and the goal stays readable.
    await alice.agent.delete(`/api/v1/goals/${goal.id}`).expect(200);
    expect((await fetchGoal(goal.id)).status).toBe('ARCHIVED');

    await alice.agent.patch(`/api/v1/goals/${goal.id}`).send({ name: 'Khác' }).expect(400);
    await alice.agent
      .post(`/api/v1/goals/${goal.id}/contributions`)
      .send({ amount: '100000', contributedAt: localNoon(-1) })
      .expect(400);

    const visible = await alice.agent.get('/api/v1/goals').expect(200);
    const visibleIds = (visible.body as { items: GoalBody[] }).items.map((item) => item.id);
    expect(visibleIds).not.toContain(goal.id);

    const withArchived = await alice.agent.get('/api/v1/goals?includeArchived=true').expect(200);
    const archivedIds = (withArchived.body as { items: GoalBody[] }).items.map((item) => item.id);
    expect(archivedIds).toContain(goal.id);
  });

  it('keeps a goal that is due today distinct from an overdue one', async () => {
    const dueToday = await createGoal({
      name: 'Học phí',
      targetAmount: '12000000',
      startDate: localDate(-5),
      targetDate: localDate(0),
    });
    expect(dueToday).toMatchObject({
      displayStatus: 'ACTIVE',
      isOverdue: false,
      monthsRemaining: 0,
      requiredMonthlySaving: null,
    });

    const overdue = await createGoal({
      name: 'Quà tặng',
      targetAmount: '10000000',
      startDate: localDate(-60),
      targetDate: localDate(-1),
    });
    const overdueWithSaving = await contribute(overdue.id, '1000000', localNoon(-2));
    expect(overdueWithSaving).toMatchObject({
      displayStatus: 'OVERDUE',
      isOverdue: true,
      status: 'ACTIVE',
      monthsRemaining: 0,
      requiredMonthlySaving: null,
      savedAmount: '1000000.00',
    });

    // An overdue goal can still be funded to completion.
    const finished = await contribute(overdue.id, '9000000', localNoon(-1));
    expect(finished).toMatchObject({
      status: 'COMPLETED',
      displayStatus: 'COMPLETED',
      isOverdue: false,
      remainingAmount: '0.00',
    });

    const active = await alice.agent.get('/api/v1/goals').expect(200);
    const activeItems = (active.body as { items: GoalBody[] }).items;
    expect(activeItems.some((item) => item.displayStatus === 'OVERDUE')).toBe(false);
  });

  it('keeps currencies separate and never converts between them', async () => {
    const usdGoal = await createGoal({
      name: 'MacBook USD',
      targetAmount: '1000',
      currency: 'usd',
      startDate: localDate(-10),
      targetDate: localDatePlusMonths(5),
    });
    expect(usdGoal.currency).toBe('USD');

    const usdAfter = await contribute(usdGoal.id, '250', localNoon(-2));
    expect(usdAfter).toMatchObject({
      currency: 'USD',
      targetAmount: '1000.00',
      savedAmount: '250.00',
      remainingAmount: '750.00',
      percentage: 25,
    });

    const vndGoal = await createGoal({
      name: 'Tai nghe VND',
      targetAmount: '1000000',
      startDate: localDate(-10),
      targetDate: localDatePlusMonths(2),
    });
    await contribute(vndGoal.id, '100000', localNoon(-1));

    const usdReloaded = await fetchGoal(usdGoal.id);
    expect(usdReloaded.savedAmount).toBe('250.00');
    const vndReloaded = await fetchGoal(vndGoal.id);
    expect(vndReloaded).toMatchObject({ currency: 'VND', savedAmount: '100000.00' });

    const usdOnly = await alice.agent.get('/api/v1/goals?currency=USD').expect(200);
    const usdItems = (usdOnly.body as { items: GoalBody[] }).items;
    expect(usdItems).toHaveLength(1);
    expect(usdItems[0]).toMatchObject({ id: usdGoal.id, currency: 'USD' });
  });

  it('edits name, description and deadline but protects saved money and the start date', async () => {
    const goal = await createGoal({
      name: 'Sửa máy tính',
      description: 'Cũ',
      targetAmount: '15000000',
      startDate: localDate(-15),
      targetDate: localDatePlusMonths(3),
    });
    await contribute(goal.id, '3000000', localNoon(-4));

    const updated = await alice.agent
      .patch(`/api/v1/goals/${goal.id}`)
      .send({
        name: '  Sửa máy tính mới  ',
        description: '  Màn hình bị sọc  ',
        targetDate: localDatePlusMonths(6),
      })
      .expect(200);
    expect((updated.body as { goal: GoalBody }).goal).toMatchObject({
      name: 'Sửa máy tính mới',
      description: 'Màn hình bị sọc',
      targetDate: localDatePlusMonths(6),
      savedAmount: '3000000.00',
    });

    await alice.agent
      .patch(`/api/v1/goals/${goal.id}`)
      .send({ targetAmount: '2000000' })
      .expect(400);
    await alice.agent
      .patch(`/api/v1/goals/${goal.id}`)
      .send({ startDate: localDate(-10) })
      .expect(400);
    // Currency is fixed at creation and cannot be smuggled in through an update.
    await alice.agent.patch(`/api/v1/goals/${goal.id}`).send({ currency: 'USD' }).expect(400);
    await alice.agent
      .patch(`/api/v1/goals/${goal.id}`)
      .send({ targetDate: localDate(-20) })
      .expect(400);
  });

  it("never exposes or mutates another user's goal", async () => {
    const goal = await createGoal({
      name: 'Riêng tư',
      targetAmount: '9000000',
      startDate: localDate(-10),
      targetDate: localDatePlusMonths(3),
    });
    const withContribution = await contribute(goal.id, '1000000', localNoon(-1));
    const contributionId = withContribution.contributions[0].id;

    await bob.agent.get(`/api/v1/goals/${goal.id}`).expect(404);
    await bob.agent.patch(`/api/v1/goals/${goal.id}`).send({ name: 'Hack' }).expect(404);
    await bob.agent.delete(`/api/v1/goals/${goal.id}`).expect(404);
    await bob.agent
      .post(`/api/v1/goals/${goal.id}/contributions`)
      .send({ amount: '100000', contributedAt: localNoon(-1) })
      .expect(404);
    await bob.agent
      .patch(`/api/v1/goals/${goal.id}/contributions/${contributionId}`)
      .send({ amount: '200000' })
      .expect(404);
    await bob.agent.delete(`/api/v1/goals/${goal.id}/contributions/${contributionId}`).expect(404);

    const bobList = await bob.agent.get('/api/v1/goals').expect(200);
    expect((bobList.body as { items: GoalBody[] }).items).toEqual([]);

    const untouched = await fetchGoal(goal.id);
    expect(untouched).toMatchObject({ name: 'Riêng tư', savedAmount: '1000000.00' });
  });

  it('lets the owner edit and delete a contribution while keeping the total honest', async () => {
    const goal = await createGoal({
      name: 'Du lịch Nhật',
      targetAmount: '20000000',
      startDate: localDate(-20),
      targetDate: localDatePlusMonths(4),
    });
    const first = await contribute(goal.id, '5000000', localNoon(-10));
    const firstId = first.contributions[0].id;

    const edited = await alice.agent
      .patch(`/api/v1/goals/${goal.id}/contributions/${firstId}`)
      .send({ amount: '7000000', note: '  Thưởng thêm  ' })
      .expect(200);
    expect((edited.body as { goal: GoalBody }).goal).toMatchObject({
      savedAmount: '7000000.00',
      remainingAmount: '13000000.00',
    });

    await alice.agent
      .patch(`/api/v1/goals/${goal.id}/contributions/${firstId}`)
      .send({ amount: '25000000' })
      .expect(400);

    const deleted = await alice.agent
      .delete(`/api/v1/goals/${goal.id}/contributions/${firstId}`)
      .expect(200);
    expect((deleted.body as { goal: GoalBody }).goal).toMatchObject({
      savedAmount: '0.00',
      remainingAmount: '20000000.00',
      status: 'ACTIVE',
    });

    await alice.agent.delete(`/api/v1/goals/${goal.id}/contributions/${firstId}`).expect(404);
  });

  it('sorts overdue goals first in the list', async () => {
    const currency = 'EUR';
    const active = await createGoal({
      name: 'Active EUR',
      targetAmount: '1000',
      currency,
      startDate: localDate(-10),
      targetDate: localDatePlusMonths(2),
    });
    const overdue = await createGoal({
      name: 'Overdue EUR',
      targetAmount: '1000',
      currency,
      startDate: localDate(-30),
      targetDate: localDate(-1),
    });

    const response = await alice.agent.get(`/api/v1/goals?currency=${currency}`).expect(200);
    const items = (response.body as { items: GoalBody[] }).items;
    expect(items.map((item) => item.id)).toEqual([overdue.id, active.id]);
  });

  it('keeps legacy rows readable, including a goal without a start date and an overfunded goal', async () => {
    const legacy = await prisma.savingsGoal.create({
      data: {
        userId: alice.id,
        name: 'Mục tiêu cũ',
        targetAmount: new Prisma.Decimal('30000000.00'),
        startDate: null,
        createdAt: new Date('2026-01-05T02:00:00.000Z'),
        contributions: {
          create: [
            {
              userId: alice.id,
              amount: new Prisma.Decimal('35000000.00'),
              contributedAt: new Date('2026-01-06T03:00:00.000Z'),
              note: null,
            },
          ],
        },
      },
    });

    const body = await fetchGoal(legacy.id);
    expect(body).toMatchObject({
      startDate: '2026-01-05',
      savedAmount: '35000000.00',
      remainingAmount: '0.00',
      percentage: 116.67,
      currency: 'VND',
      requiredMonthlySaving: '0.00',
    });
  });

  it('requires authentication', async () => {
    await request(app.getHttpServer()).get('/api/v1/goals').expect(401);
    await request(app.getHttpServer())
      .post('/api/v1/goals')
      .send({ name: 'Anonymous', targetAmount: '1000' })
      .expect(401);
  });
});
