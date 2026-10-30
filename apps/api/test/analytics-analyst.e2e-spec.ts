import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { DateTime } from 'luxon';
import request from 'supertest';
import type { SuperAgentTest } from 'supertest';
import type {
  AnalyticsAiChatReplyDto,
  AnalyticsAiExplanationDto,
  AnalyticsAiRecommendationsDto,
  AnalyticsAiSummaryDto,
} from '@smart-finance/shared-types';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { ACCESS_TOKEN_COOKIE } from '../src/common/guards/jwt-auth.guard';
import { AuthService } from '../src/modules/auth/auth.service';
import { LLM_PROVIDER, LlmUnavailableError } from '../src/modules/ai/llm/llm.types';

const TIMEZONE = 'Asia/Ho_Chi_Minh';

interface Session {
  id: string;
  agent: SuperAgentTest;
}

/** Mutable fake provider: tests flip `enabled` and stub `complete` per case. */
const fakeLlm = {
  name: 'anthropic',
  model: 'claude-opus-5-5',
  enabled: false,
  complete: jest.fn(),
};

function localNoonInMonth(monthOffset: number, day: number): Date {
  return (
    DateTime.now()
      .setZone(TIMEZONE)
      .startOf('month')
      .plus({ months: monthOffset })
      .set({ day, hour: 12, minute: 0, second: 0, millisecond: 0 })
      .toJSDate() ?? new Date()
  );
}

/** One minute past the start of the current month, so it is never "future" data. */
function currentMonthStart(): Date {
  return (
    DateTime.now()
      .setZone(TIMEZONE)
      .startOf('month')
      .set({ hour: 0, minute: 1, second: 0, millisecond: 0 })
      .toJSDate() ?? new Date()
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

/** Everything the analyst could conceivably touch; it must never change. */
async function snapshot(prisma: PrismaService, userId: string) {
  const [accounts, transactions, budgets, goals, categories] = await Promise.all([
    prisma.account.findMany({
      where: { userId },
      orderBy: { id: 'asc' },
      select: { id: true, name: true, initialBalance: true, updatedAt: true },
    }),
    prisma.transaction.findMany({
      where: { userId },
      orderBy: { id: 'asc' },
      select: { id: true, amount: true, type: true, occurredAt: true, updatedAt: true },
    }),
    prisma.budget.findMany({
      where: { userId },
      orderBy: { id: 'asc' },
      select: { id: true, limitAmount: true, periodStart: true, updatedAt: true },
    }),
    prisma.savingsGoal.findMany({
      where: { userId },
      orderBy: { id: 'asc' },
      select: { id: true, targetAmount: true, status: true, updatedAt: true },
    }),
    prisma.category.findMany({
      where: { userId },
      orderBy: { id: 'asc' },
      select: { id: true, name: true, updatedAt: true },
    }),
  ]);
  return JSON.parse(JSON.stringify({ accounts, transactions, budgets, goals, categories }));
}

const AI_EXPLANATION = JSON.stringify({
  summary: 'Chi tiêu tháng này bám sát dữ liệu đã ghi nhận.',
  sections: [
    { title: 'Dòng tiền', body: 'Hệ thống tính từ các giao dịch đã ghi nhận.' },
    { title: 'Ngân sách', body: 'Hạn mức được so với chi tiêu cùng loại tiền.' },
    { title: 'Sức khỏe tài chính', body: 'Điểm tổng dựa trên các nhóm có đủ dữ liệu.' },
  ],
  evidenceKeys: ['overview_net', 'budgets_summary', 'health_overall'],
});

/**
 * AI financial analyst (M3e). The provider is replaced with a controllable
 * fake, so every assertion is deterministic: the analytics services remain the
 * only thing that reads financial data, and nothing here can write.
 */
describe('AI financial analyst API (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let alice: Session;
  let bob: Session;
  const stamp = `${Date.now()}.${Math.floor(Math.random() * 1e6)}`;

  beforeAll(async () => {
    fakeLlm.complete.mockResolvedValue({ text: '{}', model: 'claude-opus-5-5' });
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(LLM_PROVIDER)
      .useValue(fakeLlm)
      .compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false });
    configureApp(app);
    await app.init();

    prisma = app.get(PrismaService);
    const authService = app.get(AuthService);
    alice = await createSession(app, authService, `analyst.alice.${stamp}@example.com`, 'Alice');
    bob = await createSession(app, authService, `analyst.bob.${stamp}@example.com`, 'Bob');

    const account = await prisma.account.create({
      data: { userId: alice.id, name: 'Tiền mặt', type: 'CASH', currency: 'VND' },
    });
    const bobAccount = await prisma.account.create({
      data: { userId: bob.id, name: 'Tiền mặt', type: 'CASH', currency: 'VND' },
    });

    // Three completed months so every analytics service has a history, plus
    // the current month for the overview.
    for (const offset of [-3, -2, -1]) {
      await prisma.transaction.createMany({
        data: [
          {
            userId: alice.id,
            accountId: account.id,
            type: 'INCOME',
            amount: '10000000.00',
            currency: 'VND',
            description: 'Lương',
            occurredAt: localNoonInMonth(offset, 5),
          },
          {
            userId: alice.id,
            accountId: account.id,
            type: 'EXPENSE',
            amount: '4000000.00',
            currency: 'VND',
            description: 'Chi tiêu',
            occurredAt: localNoonInMonth(offset, 20),
          },
        ],
      });
    }
    await prisma.transaction.createMany({
      data: [
        {
          userId: alice.id,
          accountId: account.id,
          type: 'INCOME',
          amount: '10000000.00',
          currency: 'VND',
          description: 'Lương',
          occurredAt: currentMonthStart(),
        },
        {
          userId: alice.id,
          accountId: account.id,
          type: 'EXPENSE',
          amount: '12000000.00',
          currency: 'VND',
          description: 'Chi tiêu',
          occurredAt: currentMonthStart(),
        },
        {
          userId: bob.id,
          accountId: bobAccount.id,
          type: 'INCOME',
          amount: '1000000.00',
          currency: 'VND',
          description: 'Thu nhập riêng',
          occurredAt: currentMonthStart(),
        },
      ],
    });

    // @db.Date columns compare against the UTC calendar date the analytics
    // services build (Date.UTC(year, month - 1, 1)).
    const nowLocal = DateTime.now().setZone(TIMEZONE);
    const monthStart = new Date(Date.UTC(nowLocal.year, nowLocal.month - 1, 1));
    const monthEnd = new Date(
      Date.UTC(nowLocal.year, nowLocal.month - 1, nowLocal.daysInMonth ?? 31),
    );
    await prisma.budget.create({
      data: {
        userId: alice.id,
        scopeKey: 'ALL',
        name: 'Tổng chi tháng',
        periodType: 'MONTHLY',
        periodStart: monthStart,
        periodEnd: monthEnd,
        limitAmount: '5000000.00',
        warningThresholds: [80, 100],
      },
    });
  });

  beforeEach(() => {
    fakeLlm.enabled = false;
    fakeLlm.complete.mockClear();
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects unauthenticated calls to every endpoint', async () => {
    const server = app.getHttpServer();
    await request(server).post('/api/v1/ai/analytics/summary').send({}).expect(401);
    await request(server).post('/api/v1/ai/analytics/explain').send({}).expect(401);
    await request(server).post('/api/v1/ai/analytics/recommendations').send({}).expect(401);
    await request(server)
      .post('/api/v1/ai/analytics/chat')
      .send({ message: 'Tóm tắt tháng này' })
      .expect(401);
  });

  it('summarises backend facts without a model and replies 200', async () => {
    const response = await alice.agent.post('/api/v1/ai/analytics/summary').send({}).expect(200);
    const body = response.body as AnalyticsAiSummaryDto;

    expect(body.source).toBe('FALLBACK');
    expect(body.currency).toBe('VND');
    expect(body.canModifyData).toBe(false);
    expect(body.facts).toMatchObject({
      currency: 'VND',
      income: '10000000.00',
      expense: '12000000.00',
      net: '-2000000.00',
      monthsAnalyzed: 6,
      budgetCount: 1,
      budgetsExceeded: 1,
    });
    expect(body.highlights.length).toBeGreaterThan(0);
    expect(body.disclosure).toMatchObject({
      aiEnabled: false,
      usedModel: false,
      fallbackReason: 'disabled',
      provider: null,
    });
    expect(fakeLlm.complete).not.toHaveBeenCalled();
  });

  it('honours the months window and never changes data', async () => {
    const before = await snapshot(prisma, alice.id);

    const response = await alice.agent
      .post('/api/v1/ai/analytics/summary')
      .send({ months: 3 })
      .expect(200);
    const body = response.body as AnalyticsAiSummaryDto;

    expect(body.facts.monthsAnalyzed).toBe(3);
    expect(await snapshot(prisma, alice.id)).toEqual(before);
  });

  it('scopes every figure to the authenticated owner', async () => {
    const aliceBody = (await alice.agent.post('/api/v1/ai/analytics/summary').send({}).expect(200))
      .body as AnalyticsAiSummaryDto;
    const bobBody = (await bob.agent.post('/api/v1/ai/analytics/summary').send({}).expect(200))
      .body as AnalyticsAiSummaryDto;

    expect(aliceBody.facts.income).toBe('10000000.00');
    expect(bobBody.facts.income).toBe('1000000.00');
    expect(bobBody.facts.expense).toBe('0.00');
    expect(bobBody.facts.budgetCount).toBe(0);
  });

  it('rejects a spoofed userId in the body', async () => {
    const response = await alice.agent
      .post('/api/v1/ai/analytics/summary')
      .send({ userId: bob.id })
      .expect(400);

    expect(JSON.stringify(response.body)).not.toContain(bob.id);
  });

  it('rejects a chat history field: each question stands alone', async () => {
    await alice.agent
      .post('/api/v1/ai/analytics/summary')
      .send({ history: [{ role: 'user', content: 'câu trước' }] })
      .expect(400);
  });

  it('returns validated model text and sends only aggregates', async () => {
    fakeLlm.enabled = true;
    fakeLlm.complete.mockResolvedValueOnce({ text: AI_EXPLANATION, model: 'claude-opus-5-5' });

    const response = await alice.agent.post('/api/v1/ai/analytics/explain').send({}).expect(200);
    const body = response.body as AnalyticsAiExplanationDto;

    expect(body.source).toBe('AI');
    expect(body.sections).toHaveLength(3);
    expect(body.evidence.map((item) => item.label)).toContain('Dòng tiền ròng trong kỳ');
    expect(body.disclosure).toMatchObject({
      aiEnabled: true,
      usedModel: true,
      provider: 'anthropic',
      fallbackReason: null,
    });

    const sent = fakeLlm.complete.mock.calls[0][0] as { system: string; user: string };
    expect(sent.user).not.toContain(alice.id);
    expect(sent.user).not.toContain('analyst.alice.');
    expect(sent.user).not.toContain('Lương');
    expect(sent.user).toContain('"task":"ANALYTICS_EXPLAIN"');
  });

  it('discards a model answer that invents a financial number', async () => {
    fakeLlm.enabled = true;
    fakeLlm.complete.mockResolvedValueOnce({
      text: AI_EXPLANATION.replace(
        'bám sát dữ liệu đã ghi nhận',
        'tăng thêm 9.999.000 VND so với tháng trước',
      ),
      model: 'claude-opus-5-5',
    });

    const response = await alice.agent.post('/api/v1/ai/analytics/explain').send({}).expect(200);
    const body = response.body as AnalyticsAiExplanationDto;

    expect(body.source).toBe('FALLBACK');
    expect(body.disclosure.fallbackReason).toBe('invalid_response');
    expect(JSON.stringify(body)).not.toContain('9.999.000');
  });

  it('falls back when the provider times out', async () => {
    fakeLlm.enabled = true;
    fakeLlm.complete.mockRejectedValueOnce(new LlmUnavailableError('timeout', 'slow'));

    const response = await alice.agent.post('/api/v1/ai/analytics/explain').send({}).expect(200);
    const body = response.body as AnalyticsAiExplanationDto;

    expect(body.source).toBe('FALLBACK');
    expect(body.disclosure.fallbackReason).toBe('timeout');
  });

  it('returns recommendations whose evidence is built by the backend, without writing', async () => {
    const before = await snapshot(prisma, alice.id);

    const response = await alice.agent
      .post('/api/v1/ai/analytics/recommendations')
      .send({})
      .expect(200);
    const body = response.body as AnalyticsAiRecommendationsDto;

    expect(body.source).toBe('FALLBACK');
    expect(body.recommendations.length).toBeGreaterThan(0);
    body.recommendations.forEach((item) => {
      expect(item.requiresConfirmation).toBe(true);
      expect(item.evidence.length).toBeGreaterThan(0);
      expect(item.limitations.length).toBeGreaterThan(0);
    });
    expect(await snapshot(prisma, alice.id)).toEqual(before);
  });

  it('refuses a write request without calling the model', async () => {
    fakeLlm.enabled = true;
    const response = await alice.agent
      .post('/api/v1/ai/analytics/chat')
      .send({ message: 'Hãy xóa giao dịch tháng này đi' })
      .expect(200);
    const body = response.body as AnalyticsAiChatReplyDto;

    expect(body.intent).toBe('UNSUPPORTED');
    expect(body.source).toBe('FALLBACK');
    expect(body.canModifyData).toBe(false);
    expect(body.reply).toContain('không thể tạo, sửa hay xóa');
    expect(body.clarification).toBeTruthy();
    expect(fakeLlm.complete).not.toHaveBeenCalled();
  });

  it('asks a clarifying question when the intent is unclear', async () => {
    fakeLlm.enabled = true;
    const response = await alice.agent
      .post('/api/v1/ai/analytics/chat')
      .send({ message: 'xin chào' })
      .expect(200);
    const body = response.body as AnalyticsAiChatReplyDto;

    expect(body.intent).toBe('UNCLEAR');
    expect(body.clarification).toBeTruthy();
    expect(body.disclosure.fallbackReason).toBe('not_needed');
    expect(fakeLlm.complete).not.toHaveBeenCalled();
  });

  it('answers a supported question from the section it needs', async () => {
    fakeLlm.enabled = true;
    fakeLlm.complete.mockResolvedValueOnce({
      text: JSON.stringify({
        reply: 'Có ngân sách đang vượt hạn mức trong tháng này.',
        referenceKeys: ['budgets_summary'],
      }),
      model: 'claude-opus-5-5',
    });

    const response = await alice.agent
      .post('/api/v1/ai/analytics/chat')
      .send({ message: 'Ngân sách nào đang vượt hạn mức?' })
      .expect(200);
    const body = response.body as AnalyticsAiChatReplyDto;

    expect(body.intent).toBe('BUDGET');
    expect(body.source).toBe('AI');
    expect(body.evidence).toHaveLength(1);
    expect(body.facts.budgetCount).toBe(1);
  });

  it.each([
    ['empty message', { message: '' }],
    ['overlong message', { message: 'a'.repeat(1_001) }],
  ])('rejects an invalid chat body (%s)', async (_label, payload) => {
    await alice.agent.post('/api/v1/ai/analytics/chat').send(payload).expect(400);
  });

  it.each([
    ['an unsupported currency', { currency: 'VNDX' }],
    ['a months window outside the allowed set', { months: 7 }],
  ])('rejects %s', async (_label, payload) => {
    await alice.agent.post('/api/v1/ai/analytics/recommendations').send(payload).expect(400);
  });

  it('rejects an overlong explain question', async () => {
    await alice.agent
      .post('/api/v1/ai/analytics/explain')
      .send({ question: 'a'.repeat(501) })
      .expect(400);
  });
});
