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
import { ALERT_SCAN_RATE_LIMIT } from '../src/modules/alerts/alerts.controller';
import { MAX_ALERTS_PAGE } from '../src/modules/alerts/dto/list-alerts.query';

interface AlertBody {
  id: string;
  type: string;
  severity: string;
  status: string;
  dedupeKey: string;
  transactionId: string | null;
  relatedTransactionId: string | null;
  categoryId: string | null;
  categoryName: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  score: string | null;
  facts: Record<string, unknown>;
  explanation: string;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
}

interface ScanBody {
  status: 'completed' | 'truncated';
  detected: number;
  created: number;
  alreadyPresent: number;
  detectedByType: Record<string, number>;
  scannedTransactions: number;
  window: { currentMonth: string; currentDays: number; referenceMonths: string[] };
  limits: {
    lookbackDays: number;
    candidateDays: number;
    maxTransactions: number;
    maxLargeCandidates: number;
    maxDuplicatePairs: number;
    transactionsTruncated: boolean;
    largeCandidatesCapped: boolean;
    duplicateCapReached: boolean;
  };
}

interface ListBody {
  items: AlertBody[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const HISTORY_AMOUNTS = [
  '50000.00',
  '60000.00',
  '70000.00',
  '80000.00',
  '90000.00',
  '100000.00',
  '110000.00',
  '120000.00',
];
const HISTORY_DAYS_AGO = [150, 142, 134, 126, 118, 110, 102, 94];

interface UserState {
  id: string;
  agent: SuperAgentTest;
  accountId: string;
}

type UserKey =
  | 'alice'
  | 'bob'
  | 'eve'
  | 'carol'
  | 'dave'
  | 'frank'
  | 'grace'
  | 'henry'
  | 'ivy'
  | 'judy'
  | 'kate';

/**
 * Registers through the real AuthService (the HTTP route is throttled to five
 * registrations per minute, which seven fixtures would exceed) and then puts
 * the issued token in the agent's cookie jar, so every request below goes
 * through the real JwtAuthGuard exactly like a browser session.
 */
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
 * These tests run against the real PostgreSQL test database (see
 * setup-e2e.ts); nothing here mocks Prisma, so the unique index, the foreign
 * keys and the concurrency behaviour are the ones the product actually has.
 */
describe('Alerts API (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let authService: AuthService;
  let users: Record<UserKey, UserState>;

  const fixtures: {
    candidateId: string;
    aliceAlertId: string;
    carolTransactionIds: string[];
    graceCategoryId: string;
    graceCandidateId: string;
    ivyCategoryId: string;
    ivyPeriodStart: string;
    ivyPeriodEnd: string;
    judyAlertId: string;
    now: number;
  } = {
    candidateId: '',
    aliceAlertId: '',
    carolTransactionIds: [],
    graceCategoryId: '',
    graceCandidateId: '',
    ivyCategoryId: '',
    ivyPeriodStart: '',
    ivyPeriodEnd: '',
    judyAlertId: '',
    now: 0,
  };

  async function createAccount(userId: string): Promise<string> {
    const account = await prisma.account.create({
      data: { userId, name: 'Tiền mặt', type: 'CASH', currency: 'VND' },
    });
    return account.id;
  }

  async function registerUser(key: UserKey): Promise<UserState> {
    const registered = await createSession(
      app,
      authService,
      `${key}@alerts.test`,
      key.toUpperCase(),
    );
    return { ...registered, accountId: await createAccount(registered.id) };
  }

  function createExpense(
    userId: string,
    accountId: string,
    amount: string,
    occurredAt: Date,
    categoryId: string | null = null,
  ) {
    return prisma.transaction.create({
      data: {
        userId,
        accountId,
        categoryId,
        type: 'EXPENSE',
        amount: new Prisma.Decimal(amount),
        currency: 'VND',
        description: 'Chi tiêu kiểm thử',
        occurredAt,
      },
    });
  }

  /** Eight baseline expenses plus one unusually large recent expense. */
  async function seedLargeTransactionUser(userId: string, accountId: string) {
    for (const [index, amount] of HISTORY_AMOUNTS.entries()) {
      await createExpense(
        userId,
        accountId,
        amount,
        new Date(fixtures.now - HISTORY_DAYS_AGO[index] * DAY_MS),
      );
    }
    return createExpense(userId, accountId, '900000.00', new Date(fixtures.now - DAY_MS));
  }

  async function scan(agent: SuperAgentTest): Promise<ScanBody> {
    const response = await agent.post('/api/v1/alerts/scan').expect(200);
    return response.body.scan as ScanBody;
  }

  async function listAlerts(agent: SuperAgentTest, query = ''): Promise<ListBody> {
    const response = await agent.get(`/api/v1/alerts${query}`).expect(200);
    return response.body as ListBody;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false });
    configureApp(app);
    await app.init();

    prisma = app.get(PrismaService);
    authService = app.get(AuthService);
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "users" CASCADE');
    fixtures.now = Date.now();

    users = {
      alice: await registerUser('alice'),
      bob: await registerUser('bob'),
      eve: await registerUser('eve'),
      carol: await registerUser('carol'),
      dave: await registerUser('dave'),
      frank: await registerUser('frank'),
      grace: await registerUser('grace'),
      henry: await registerUser('henry'),
      ivy: await registerUser('ivy'),
      judy: await registerUser('judy'),
      kate: await registerUser('kate'),
    };

    // alice: one large expense, plus an income and an internal transfer that
    // must never be treated as spending.
    fixtures.candidateId = (
      await seedLargeTransactionUser(users.alice.id, users.alice.accountId)
    ).id;
    await prisma.transaction.create({
      data: {
        userId: users.alice.id,
        accountId: users.alice.accountId,
        type: 'INCOME',
        amount: new Prisma.Decimal('5000000.00'),
        currency: 'VND',
        description: 'Thu nhập kiểm thử',
        occurredAt: new Date(fixtures.now - 2 * DAY_MS),
      },
    });
    await prisma.transaction.create({
      data: {
        userId: users.alice.id,
        accountId: users.alice.accountId,
        type: 'TRANSFER',
        amount: new Prisma.Decimal('10000000.00'),
        currency: 'VND',
        description: 'Chuyển khoản nội bộ',
        occurredAt: new Date(fixtures.now - DAY_MS),
      },
    });

    // eve: same clean detection scenario, used for the concurrent-scan test.
    await seedLargeTransactionUser(users.eve.id, users.eve.accountId);

    // carol: 21 identical rows minutes apart, more duplicate pairs than the cap.
    fixtures.carolTransactionIds = [];
    for (let index = 0; index < 21; index += 1) {
      const transaction = await createExpense(
        users.carol.id,
        users.carol.accountId,
        '100000.00',
        new Date(fixtures.now - 60 * DAY_MS + index * 5 * 60 * 1000),
      );
      fixtures.carolTransactionIds.push(transaction.id);
    }

    // frank: too little history to call anything abnormal.
    for (const [index, amount] of ['30000.00', '45000.00', '52000.00'].entries()) {
      await createExpense(
        users.frank.id,
        users.frank.accountId,
        amount,
        new Date(fixtures.now - (index + 1) * DAY_MS),
      );
    }

    // grace: a scan-created alert whose category can later be deleted.
    const graceCategory = await prisma.category.create({
      data: { userId: users.grace.id, name: 'Danh mục riêng', type: 'EXPENSE' },
    });
    fixtures.graceCategoryId = graceCategory.id;
    for (const [index, amount] of HISTORY_AMOUNTS.entries()) {
      await createExpense(
        users.grace.id,
        users.grace.accountId,
        amount,
        new Date(fixtures.now - HISTORY_DAYS_AGO[index] * DAY_MS),
      );
    }
    fixtures.graceCandidateId = (
      await createExpense(
        users.grace.id,
        users.grace.accountId,
        '900000.00',
        new Date(fixtures.now - DAY_MS),
        graceCategory.id,
      )
    ).id;

    // henry: near-uniform history (four 1 000.00 and four 1 000.01) plus one
    // 10 000.00 expense. The robust z-score is ≈ 1.2 million, larger than
    // DECIMAL(10, 4) can store; the scan must still succeed and persist it.
    // Equal amounts are two days apart, so no duplicate pair matches.
    for (const entry of [
      { amount: '1000.00', daysAgo: 100 },
      { amount: '1000.01', daysAgo: 99 },
      { amount: '1000.00', daysAgo: 98 },
      { amount: '1000.01', daysAgo: 97 },
      { amount: '1000.00', daysAgo: 96 },
      { amount: '1000.01', daysAgo: 95 },
      { amount: '1000.00', daysAgo: 94 },
      { amount: '1000.01', daysAgo: 93 },
    ]) {
      await createExpense(
        users.henry.id,
        users.henry.accountId,
        entry.amount,
        new Date(fixtures.now - entry.daysAgo * DAY_MS),
      );
    }
    await createExpense(
      users.henry.id,
      users.henry.accountId,
      '10000.00',
      new Date(fixtures.now - DAY_MS),
    );

    // kate: the same detection scenario, used for the body-spoofing test.
    await seedLargeTransactionUser(users.kate.id, users.kate.accountId);

    // ivy: category spending spike. All dates are derived from the user's own
    // today in Asia/Ho_Chi_Minh, so the test does not depend on the machine's
    // timezone. Reference months get day 1 (always inside a matched-day window);
    // the two current expenses are placed just before "now", still inside the
    // current month.
    const ivyZone = 'Asia/Ho_Chi_Minh';
    const ivyNow = DateTime.now().setZone(ivyZone);
    const ivyMonthStart = ivyNow.startOf('month');
    await prisma.user.update({
      where: { id: users.ivy.id },
      data: { timezone: ivyZone, defaultCurrency: 'VND' },
    });
    const ivyCategory = await prisma.category.create({
      data: { userId: users.ivy.id, name: 'Ăn uống', type: 'EXPENSE' },
    });
    fixtures.ivyCategoryId = ivyCategory.id;
    for (const monthsAgo of [1, 2, 3]) {
      await createExpense(
        users.ivy.id,
        users.ivy.accountId,
        '100000.00',
        ivyMonthStart.minus({ months: monthsAgo }).set({ day: 1, hour: 12 }).toJSDate(),
        ivyCategory.id,
      );
    }
    const ivyCurrentAt =
      ivyNow.minus({ minutes: 5 }).toMillis() >= ivyMonthStart.toMillis() + 60_000
        ? ivyNow.minus({ minutes: 5 })
        : ivyMonthStart.plus({ seconds: 2 });
    const ivyEarlierAt =
      ivyCurrentAt.minus({ seconds: 1 }).toMillis() >= ivyMonthStart.toMillis()
        ? ivyCurrentAt.minus({ seconds: 1 })
        : ivyMonthStart;
    await createExpense(
      users.ivy.id,
      users.ivy.accountId,
      '250000.00',
      ivyEarlierAt.toJSDate(),
      ivyCategory.id,
    );
    await createExpense(
      users.ivy.id,
      users.ivy.accountId,
      '249000.00',
      ivyCurrentAt.toJSDate(),
      ivyCategory.id,
    );
    fixtures.ivyPeriodStart = ivyMonthStart.toFormat('yyyy-MM-dd');
    fixtures.ivyPeriodEnd = ivyNow.toFormat('yyyy-MM-dd');

    // judy: 501 large candidates in the candidate window but only 509 rows in
    // total, so the large-candidate cap is the only limit that is reached. All
    // candidates share one timestamp (so they never enter each other's history)
    // and have distinct amounts (so no duplicate pair matches).
    const judyBaseline = [
      '50000.00',
      '60000.00',
      '70000.00',
      '80000.00',
      '90000.00',
      '100000.00',
      '110000.00',
      '120000.00',
    ];
    for (const [index, amount] of judyBaseline.entries()) {
      await createExpense(
        users.judy.id,
        users.judy.accountId,
        amount,
        new Date(fixtures.now - (60 - index) * DAY_MS),
      );
    }
    await prisma.transaction.createMany({
      data: Array.from({ length: 501 }, (_value, index) => ({
        userId: users.judy.id,
        accountId: users.judy.accountId,
        type: 'EXPENSE' as const,
        amount: new Prisma.Decimal(`${200000 + index}.00`),
        currency: 'VND',
        description: 'Chi tiêu lớn kiểm thử',
        occurredAt: new Date(fixtures.now - DAY_MS),
      })),
    });
  });

  afterAll(async () => {
    await app.close();
  });

  describe('authentication and ownership', () => {
    it('rejects unauthenticated access', async () => {
      await request(app.getHttpServer()).get('/api/v1/alerts').expect(401);
      await request(app.getHttpServer()).post('/api/v1/alerts/scan').expect(401);
      await request(app.getHttpServer())
        .patch('/api/v1/alerts/00000000-0000-4000-8000-000000000000/status')
        .send({ status: 'DISMISSED' })
        .expect(401);
    });

    it('returns an empty, paginated envelope before the first scan', async () => {
      const body = await listAlerts(users.bob.agent);
      expect(body).toEqual({ items: [], page: 1, limit: 20, total: 0, totalPages: 0 });
    });
  });

  describe('scan on a user with one unusual expense', () => {
    it('detects only the large expense, ignoring income and transfers', async () => {
      const summary = await scan(users.alice.agent);

      expect(summary).toMatchObject({
        status: 'completed',
        detected: 1,
        created: 1,
        alreadyPresent: 0,
        detectedByType: {
          LARGE_TRANSACTION: 1,
          CATEGORY_SPIKE: 0,
          POSSIBLE_DUPLICATE: 0,
        },
        // 8 baseline + 1 candidate + 1 income; the transfer is excluded.
        scannedTransactions: 10,
      });
      expect(summary.window.referenceMonths).toHaveLength(3);
      expect(summary.limits.transactionsTruncated).toBe(false);
      expect(summary.limits.duplicateCapReached).toBe(false);
    });

    it('lists the alert with its explanation, score and dedupe key', async () => {
      const body = await listAlerts(users.alice.agent);
      expect(body.total).toBe(1);
      const [alert] = body.items;
      fixtures.aliceAlertId = alert.id;

      expect(alert).toMatchObject({
        type: 'LARGE_TRANSACTION',
        severity: 'HIGH',
        status: 'OPEN',
        dedupeKey: `LARGE:${fixtures.candidateId}`,
        transactionId: fixtures.candidateId,
        relatedTransactionId: null,
        categoryId: null,
        categoryName: null,
        resolvedAt: null,
      });
      expect(Number(alert.score)).toBeGreaterThan(5);
      expect(alert.facts).toMatchObject({ method: 'robust_z', historyCount: 8, currency: 'VND' });
      expect(alert.explanation).toContain('cao hơn hẳn');
      expect(alert.explanation).toContain('900.000');
    });

    it('filters by status and type', async () => {
      expect((await listAlerts(users.alice.agent, '?type=LARGE_TRANSACTION')).total).toBe(1);
      expect((await listAlerts(users.alice.agent, '?type=POSSIBLE_DUPLICATE')).total).toBe(0);
      expect((await listAlerts(users.alice.agent, '?status=OPEN')).total).toBe(1);
      expect((await listAlerts(users.alice.agent, '?status=DISMISSED')).total).toBe(0);
      expect((await listAlerts(users.alice.agent, '?status=OPEN&type=CATEGORY_SPIKE')).total).toBe(
        0,
      );
    });

    it('rejects out-of-range pagination and unknown filters', async () => {
      await users.alice.agent.get('/api/v1/alerts?page=0').expect(400);
      await users.alice.agent.get('/api/v1/alerts?limit=0').expect(400);
      await users.alice.agent.get('/api/v1/alerts?limit=101').expect(400);
      await users.alice.agent.get('/api/v1/alerts?page=abc').expect(400);
      await users.alice.agent.get('/api/v1/alerts?page=1.5').expect(400);
      await users.alice.agent.get('/api/v1/alerts?page=Infinity').expect(400);
      // Above the documented page bound, and beyond what Prisma/PostgreSQL
      // could turn into a valid OFFSET. Both must be validation errors, not 500.
      await users.alice.agent.get(`/api/v1/alerts?page=${MAX_ALERTS_PAGE + 1}`).expect(400);
      await users.alice.agent.get('/api/v1/alerts?page=1000000000000000000').expect(400);
      await users.alice.agent.get('/api/v1/alerts?type=BOGUS').expect(400);
      await users.alice.agent.get('/api/v1/alerts?status=BOGUS').expect(400);
      await users.alice.agent.get('/api/v1/alerts?foo=bar').expect(400);
    });

    it('accepts the page limit and returns an empty page past the data', async () => {
      const body = await listAlerts(users.alice.agent, `?page=${MAX_ALERTS_PAGE}`);
      expect(body.page).toBe(MAX_ALERTS_PAGE);
      expect(body.items).toEqual([]);
      expect(body.total).toBe(1);
      expect(body.totalPages).toBe(1);
    });

    it('is idempotent: a rescan creates nothing and duplicates nothing', async () => {
      const summary = await scan(users.alice.agent);
      expect(summary).toMatchObject({ detected: 1, created: 0, alreadyPresent: 1 });

      const body = await listAlerts(users.alice.agent);
      expect(body.total).toBe(1);
      expect(await prisma.spendingAlert.count({ where: { userId: users.alice.id } })).toBe(1);
    });
  });

  describe('status updates', () => {
    it('dismisses the alert and stamps resolvedAt', async () => {
      const response = await users.alice.agent
        .patch(`/api/v1/alerts/${fixtures.aliceAlertId}/status`)
        .send({ status: 'DISMISSED' })
        .expect(200);
      const alert = response.body.alert as AlertBody;
      expect(alert.status).toBe('DISMISSED');
      expect(alert.resolvedAt).not.toBeNull();
    });

    it('does not overwrite a dismissed alert on rescan', async () => {
      const before = (await listAlerts(users.alice.agent)).items[0];

      const summary = await scan(users.alice.agent);
      expect(summary.created).toBe(0);

      const after = (await listAlerts(users.alice.agent)).items[0];
      expect(after.status).toBe('DISMISSED');
      expect(after.resolvedAt).toBe(before.resolvedAt);
      expect(after.updatedAt).toBe(before.updatedAt);
    });

    it('rejects a transition that skips reopening', async () => {
      const response = await users.alice.agent
        .patch(`/api/v1/alerts/${fixtures.aliceAlertId}/status`)
        .send({ status: 'ACKNOWLEDGED' })
        .expect(400);
      expect(response.body).toMatchObject({ statusCode: 400, code: 'VALIDATION_ERROR' });
      expect(response.body.message).toContain('DISMISSED');
    });

    it('rejects client attempts to edit system fields', async () => {
      await users.alice.agent
        .patch(`/api/v1/alerts/${fixtures.aliceAlertId}/status`)
        .send({ status: 'OPEN', severity: 'LOW' })
        .expect(400);
      await users.alice.agent
        .patch(`/api/v1/alerts/${fixtures.aliceAlertId}/status`)
        .send({ status: 'OPEN', dedupeKey: 'LARGE:forged' })
        .expect(400);
      await users.alice.agent
        .patch(`/api/v1/alerts/${fixtures.aliceAlertId}/status`)
        .send({ status: 'OPEN', userId: users.bob.id })
        .expect(400);
      await users.alice.agent
        .patch(`/api/v1/alerts/${fixtures.aliceAlertId}/status`)
        .send({ status: 'OPEN', transactionId: '00000000-0000-4000-8000-000000000000' })
        .expect(400);
      await users.alice.agent
        .patch(`/api/v1/alerts/${fixtures.aliceAlertId}/status`)
        .send({ status: 'NOT_A_STATUS' })
        .expect(400);

      // None of the rejected requests changed anything.
      const alert = (await listAlerts(users.alice.agent)).items[0];
      expect(alert.status).toBe('DISMISSED');
    });

    it('reopens the alert and clears resolvedAt', async () => {
      const response = await users.alice.agent
        .patch(`/api/v1/alerts/${fixtures.aliceAlertId}/status`)
        .send({ status: 'OPEN' })
        .expect(200);
      expect(response.body.alert).toMatchObject({ status: 'OPEN', resolvedAt: null });

      const summary = await scan(users.alice.agent);
      expect(summary.created).toBe(0);
      const alert = (await listAlerts(users.alice.agent)).items[0];
      expect(alert.status).toBe('OPEN');
    });

    it('treats a PATCH to the current status as an idempotent no-op', async () => {
      const before = (await listAlerts(users.alice.agent)).items[0];
      const response = await users.alice.agent
        .patch(`/api/v1/alerts/${fixtures.aliceAlertId}/status`)
        .send({ status: 'OPEN' })
        .expect(200);
      expect(response.body.alert).toMatchObject({ status: 'OPEN', resolvedAt: null });
      expect(response.body.alert.updatedAt).toBe(before.updatedAt);
    });

    it('never exposes or mutates another user’s alert', async () => {
      expect((await listAlerts(users.bob.agent)).total).toBe(0);
      await users.bob.agent
        .patch(`/api/v1/alerts/${fixtures.aliceAlertId}/status`)
        .send({ status: 'DISMISSED' })
        .expect(404);
      const alert = (await listAlerts(users.alice.agent)).items[0];
      expect(alert.status).toBe('OPEN');
    });

    it('returns 404 for an unknown alert and 400 for a malformed id', async () => {
      await users.alice.agent
        .patch('/api/v1/alerts/00000000-0000-4000-8000-000000000000/status')
        .send({ status: 'DISMISSED' })
        .expect(404);
      await users.alice.agent
        .patch('/api/v1/alerts/not-a-uuid/status')
        .send({ status: 'DISMISSED' })
        .expect(400);
    });

    it('keeps a MARKED_NORMAL alert settled across a rescan', async () => {
      const patched = await users.alice.agent
        .patch(`/api/v1/alerts/${fixtures.aliceAlertId}/status`)
        .send({ status: 'MARKED_NORMAL' })
        .expect(200);
      expect(patched.body.alert).toMatchObject({ status: 'MARKED_NORMAL' });
      expect(patched.body.alert.resolvedAt).not.toBeNull();
      const before = (await listAlerts(users.alice.agent)).items[0];

      const summary = await scan(users.alice.agent);
      expect(summary.created).toBe(0);

      const after = (await listAlerts(users.alice.agent)).items[0];
      expect(after.status).toBe('MARKED_NORMAL');
      expect(after.resolvedAt).toBe(before.resolvedAt);
      expect(after.updatedAt).toBe(before.updatedAt);
    });
  });

  describe('scan conservatism', () => {
    it('does not invent alerts from too little history', async () => {
      const summary = await scan(users.frank.agent);
      expect(summary).toMatchObject({ status: 'completed', detected: 0, created: 0 });
      expect(await prisma.spendingAlert.count({ where: { userId: users.frank.id } })).toBe(0);
    });

    it('uses the stored timezone for the day and month windows', async () => {
      // Pick a zone whose local day is guaranteed to differ from the UTC day,
      // so the assertion can only pass if the user's timezone was really used.
      const utcHour = DateTime.utc().hour;
      const zone = utcHour >= 10 ? 'Pacific/Kiritimati' : 'Pacific/Pago_Pago';
      await prisma.user.update({ where: { id: users.dave.id }, data: { timezone: zone } });

      const summary = await scan(users.dave.agent);
      const local = DateTime.now().setZone(zone);

      expect(summary.window.currentDays).toBe(local.day);
      expect(summary.window.currentMonth).toBe(local.toFormat('yyyy-MM'));
      expect(summary.window.currentDays).not.toBe(DateTime.utc().day);
      expect(summary.window.referenceMonths).toHaveLength(3);
    });

    it('falls back to the default timezone when the stored one is invalid', async () => {
      await prisma.user.update({
        where: { id: users.dave.id },
        data: { timezone: 'Mars/Olympus' },
      });

      const summary = await scan(users.dave.agent);
      const fallback = DateTime.now().setZone('Asia/Ho_Chi_Minh');

      expect(summary.status).toBe('completed');
      expect(summary.window.currentMonth).toBe(fallback.toFormat('yyyy-MM'));
      expect(summary.window.currentDays).toBe(fallback.day);
    });
  });

  describe('score overflow hardening', () => {
    it('persists a clamped score while keeping the exact robust z in facts', async () => {
      const summary = await scan(users.henry.agent);
      expect(summary).toMatchObject({ status: 'completed', detected: 1, created: 1 });

      const row = await prisma.spendingAlert.findFirst({
        where: { userId: users.henry.id, type: 'LARGE_TRANSACTION' },
      });
      expect(row).not.toBeNull();
      expect(row!.score).not.toBeNull();
      expect(row!.score!.toFixed(4)).toBe('999999.9999');

      const facts = row!.facts as { robustZ: string; scoreClamped: boolean };
      expect(facts.scoreClamped).toBe(true);
      expect(Number(facts.robustZ)).toBeGreaterThan(999999.9999);

      const body = await listAlerts(users.henry.agent);
      expect(body.total).toBe(1);
      const [alert] = body.items;
      expect(alert.type).toBe('LARGE_TRANSACTION');
      expect(alert.score).toBe('999999.9999');
      expect(alert.facts.scoreClamped).toBe(true);
      expect(Number(alert.facts.robustZ)).toBeGreaterThan(999999.9999);
      // The explanation is rebuilt from the exact z, not from the clamped column.
      expect(alert.explanation).toContain(Number(alert.facts.robustZ).toFixed(1));
      expect(alert.explanation).not.toContain('999999.9999');
    });
  });

  describe('category spike detection', () => {
    it('detects, persists and serves a CATEGORY_SPIKE alert', async () => {
      const summary = await scan(users.ivy.agent);
      expect(summary.status).toBe('completed');
      expect(summary.created).toBe(1);
      expect(summary.detectedByType).toMatchObject({
        LARGE_TRANSACTION: 0,
        CATEGORY_SPIKE: 1,
        POSSIBLE_DUPLICATE: 0,
      });

      const rows = await prisma.spendingAlert.findMany({
        where: { userId: users.ivy.id },
      });
      expect(rows).toHaveLength(1);
      expect(rows[0].type).toBe('CATEGORY_SPIKE');
      expect(rows[0].categoryId).toBe(fixtures.ivyCategoryId);
      expect(rows[0].periodStart?.toISOString().slice(0, 10)).toBe(fixtures.ivyPeriodStart);
      expect(rows[0].periodEnd?.toISOString().slice(0, 10)).toBe(fixtures.ivyPeriodEnd);
      expect(rows[0].score).toBeNull();

      const body = await listAlerts(users.ivy.agent);
      expect(body.total).toBe(1);
      const [alert] = body.items;
      expect(alert).toMatchObject({
        type: 'CATEGORY_SPIKE',
        severity: 'HIGH',
        status: 'OPEN',
        transactionId: null,
        relatedTransactionId: null,
        categoryId: fixtures.ivyCategoryId,
        categoryName: 'Ăn uống',
        periodStart: fixtures.ivyPeriodStart,
        periodEnd: fixtures.ivyPeriodEnd,
        score: null,
      });
      expect(alert.facts).toMatchObject({
        method: 'matched_day_window',
        currency: 'VND',
        currentSpend: '499000.00',
        currentTransactions: 2,
        baseline: '100000.00',
        ratio: '4.9900',
      });
      expect(alert.explanation).toContain('Ăn uống');
      expect(alert.explanation).toContain('5.0 lần');
    });
  });

  describe('large candidate cap', () => {
    it('reports truncated when only the large-candidate cap is reached', async () => {
      const summary = await scan(users.judy.agent);

      expect(summary.status).toBe('truncated');
      expect(summary.limits.largeCandidatesCapped).toBe(true);
      expect(summary.limits.transactionsTruncated).toBe(false);
      expect(summary.limits.duplicateCapReached).toBe(false);
      expect(summary.scannedTransactions).toBe(509);
      expect(summary.detected).toBe(summary.limits.maxLargeCandidates);
      expect(summary.created).toBe(summary.limits.maxLargeCandidates);
      expect(summary.detectedByType.LARGE_TRANSACTION).toBe(summary.limits.maxLargeCandidates);
      expect(await prisma.spendingAlert.count({ where: { userId: users.judy.id } })).toBe(
        summary.limits.maxLargeCandidates,
      );
    });
  });

  describe('scan request body is not a source of identity', () => {
    it('ignores a userId in the body and scans the JWT user only', async () => {
      const response = await users.kate.agent
        .post('/api/v1/alerts/scan')
        .send({ userId: users.bob.id })
        .expect(200);
      const summary = response.body.scan as ScanBody;
      expect(summary.created).toBe(1);

      expect(await prisma.spendingAlert.count({ where: { userId: users.kate.id } })).toBe(1);
      expect(await prisma.spendingAlert.count({ where: { userId: users.bob.id } })).toBe(0);
      expect((await listAlerts(users.bob.agent)).total).toBe(0);
    });
  });

  describe('duplicate detection cap', () => {
    it('caps pairs and reports the scan as truncated', async () => {
      const summary = await scan(users.carol.agent);
      expect(summary.status).toBe('truncated');
      expect(summary.limits.duplicateCapReached).toBe(true);
      expect(summary.limits.transactionsTruncated).toBe(false);
      expect(summary.detectedByType.POSSIBLE_DUPLICATE).toBe(summary.limits.maxDuplicatePairs);
      expect(summary.detected).toBe(summary.limits.maxDuplicatePairs);
      expect(summary.created).toBe(summary.limits.maxDuplicatePairs);
    });

    it('builds one stable pair key regardless of scan order', async () => {
      const body = await listAlerts(users.carol.agent, '?limit=100');
      expect(body.total).toBe(20);

      const [first, second] = fixtures.carolTransactionIds;
      const expectedKey = `DUP:${[first, second].sort().join(':')}`;
      const pairAlert = body.items.find((alert) => alert.dedupeKey === expectedKey);
      expect(pairAlert).toBeDefined();
      expect(pairAlert!.transactionId).toBe(second);
      expect(pairAlert!.relatedTransactionId).toBe(first);
      expect(pairAlert!.severity).toBe('LOW');

      // Every key is unique and pagination covers each row exactly once.
      const keys = body.items.map((alert) => alert.dedupeKey);
      expect(new Set(keys).size).toBe(keys.length);

      const pageOne = await listAlerts(users.carol.agent, '?limit=7&page=1');
      const pageTwo = await listAlerts(users.carol.agent, '?limit=7&page=2');
      const pageThree = await listAlerts(users.carol.agent, '?limit=7&page=3');
      expect(pageOne.totalPages).toBe(3);
      const paged = [...pageOne.items, ...pageTwo.items, ...pageThree.items].map(
        (alert) => alert.id,
      );
      expect(paged).toHaveLength(20);
      expect(new Set(paged).size).toBe(20);

      // Ordering is stable: newest first, then id descending.
      const stored = await prisma.spendingAlert.findMany({
        where: { userId: users.carol.id },
        select: { id: true },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      });
      expect(paged).toEqual(stored.map((row) => row.id));
    });

    it('stays idempotent when the same capped scan runs again', async () => {
      const before = await listAlerts(users.carol.agent, '?limit=100');
      const summary = await scan(users.carol.agent);
      expect(summary).toMatchObject({
        status: 'truncated',
        created: 0,
        alreadyPresent: before.total,
      });
      const after = await listAlerts(users.carol.agent, '?limit=100');
      expect(after.items.map((alert) => alert.id)).toEqual(before.items.map((alert) => alert.id));
    });
  });

  describe('concurrency', () => {
    it('does not duplicate alerts when two scans run at the same time', async () => {
      const [first, second] = await Promise.all([
        users.eve.agent.post('/api/v1/alerts/scan').expect(200),
        users.eve.agent.post('/api/v1/alerts/scan').expect(200),
      ]);

      const firstSummary = first.body.scan as ScanBody;
      const secondSummary = second.body.scan as ScanBody;
      expect(firstSummary.detected).toBe(1);
      expect(secondSummary.detected).toBe(1);
      expect(firstSummary.created + secondSummary.created).toBe(1);

      const rows = await prisma.spendingAlert.findMany({ where: { userId: users.eve.id } });
      expect(rows).toHaveLength(1);
      expect(new Set(rows.map((row) => row.dedupeKey)).size).toBe(1);
    });
  });

  describe('foreign keys', () => {
    it('deletes an alert when its transaction is deleted', async () => {
      const before = await prisma.spendingAlert.count({ where: { userId: users.carol.id } });
      expect(before).toBe(20);

      // The first pair's `transactionId` is the second row; deleting it must
      // remove that alert through ON DELETE CASCADE.
      await prisma.transaction.delete({ where: { id: fixtures.carolTransactionIds[1] } });
      expect(await prisma.spendingAlert.count({ where: { userId: users.carol.id } })).toBe(19);

      // The earliest row is the `relatedTransactionId` of the remaining pairs.
      await prisma.transaction.delete({ where: { id: fixtures.carolTransactionIds[0] } });
      expect(await prisma.spendingAlert.count({ where: { userId: users.carol.id } })).toBe(0);
    });

    it('keeps the alert and nulls its category when the category is deleted', async () => {
      const summary = await scan(users.grace.agent);
      expect(summary.created).toBe(1);

      const created = (await listAlerts(users.grace.agent)).items[0];
      expect(created.categoryId).toBe(fixtures.graceCategoryId);
      expect(created.categoryName).toBe('Danh mục riêng');

      // A transaction category is Restrict, so detach the transaction first.
      await prisma.transaction.update({
        where: { id: fixtures.graceCandidateId },
        data: { categoryId: null },
      });
      await prisma.category.delete({ where: { id: fixtures.graceCategoryId } });

      const after = (await listAlerts(users.grace.agent)).items[0];
      expect(after.id).toBe(created.id);
      expect(after.categoryId).toBeNull();
      expect(after.categoryName).toBeNull();
    });
  });
});

describe('Alerts scan rate limit (e2e)', () => {
  it('answers 429 once the per-minute budget is spent', async () => {
    // A separate app instance keeps its throttler counters away from the suite
    // above, so exactly one scan over the limit is the first blocked request.
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const app = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false });
    configureApp(app);
    await app.init();

    try {
      const { agent } = await createSession(
        app,
        app.get(AuthService),
        'throttle@alerts.test',
        'Throttle',
      );

      for (let index = 0; index < ALERT_SCAN_RATE_LIMIT.limit; index += 1) {
        await agent.post('/api/v1/alerts/scan').expect(200);
      }

      const blocked = await agent.post('/api/v1/alerts/scan').expect(429);
      expect(blocked.body).toMatchObject({
        statusCode: 429,
        code: 'RATE_LIMITED',
      });
      expect(blocked.headers['retry-after']).toBe('60');
    } finally {
      await app.close();
    }
  });
});
