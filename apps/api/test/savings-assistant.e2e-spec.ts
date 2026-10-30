import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { DateTime } from 'luxon';
import request from 'supertest';
import type { SuperAgentTest } from 'supertest';
import type {
  SavingsChatReplyDto,
  SavingsExplanationDto,
  SavingsScenarioExplanationDto,
  SavingsSuggestionsDto,
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

function localDate(offset: { months?: number; days?: number } = {}): string {
  return DateTime.now()
    .setZone(TIMEZONE)
    .plus({ months: offset.months ?? 0, days: offset.days ?? 0 })
    .toFormat('yyyy-MM-dd');
}

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

/** Everything the assistant could conceivably touch; it must never change. */
async function snapshot(prisma: PrismaService, userId: string) {
  const [goals, contributions, transactions, accounts] = await Promise.all([
    prisma.savingsGoal.findMany({
      where: { userId },
      orderBy: { id: 'asc' },
      select: { id: true, status: true, targetAmount: true, targetDate: true, updatedAt: true },
    }),
    prisma.goalContribution.findMany({
      where: { goal: { userId } },
      orderBy: { id: 'asc' },
      select: { id: true, amount: true, contributedAt: true },
    }),
    prisma.transaction.findMany({
      where: { userId },
      orderBy: { id: 'asc' },
      select: { id: true, amount: true, type: true, occurredAt: true },
    }),
    prisma.account.findMany({
      where: { userId },
      orderBy: { id: 'asc' },
      select: { id: true, name: true, currency: true, initialBalance: true },
    }),
  ]);
  return JSON.parse(JSON.stringify({ goals, contributions, transactions, accounts }));
}

/**
 * AI savings assistant (M2e). The provider is replaced with a controllable
 * fake, so every assertion is deterministic: the deterministic backend is
 * still the only thing that reads or writes financial data.
 */
describe('AI savings assistant API (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let alice: Session;
  let bob: Session;
  const stamp = `${Date.now()}.${Math.floor(Math.random() * 1e6)}`;
  let goalId = '';

  const AI_EXPLANATION = JSON.stringify({
    summary: 'Kế hoạch tháng này dựa trên dòng tiền đã ghi nhận của bạn.',
    sections: [
      { title: 'Khả năng tiết kiệm', body: 'Hệ thống tính từ các tháng đã kết thúc gần nhất.' },
      {
        title: 'Khoản dự phòng',
        body: 'Một phần dòng tiền ròng được giữ lại theo quy tắc cố định.',
      },
      { title: 'Ưu tiên', body: 'Mục tiêu gần hạn được xếp trước trong kế hoạch.' },
    ],
  });

  function aiSuggestion(evidenceKey: string) {
    return JSON.stringify({
      suggestions: [
        {
          title: 'Tăng nhịp góp cho mục tiêu gần hạn',
          explanation: 'Dữ liệu tiến độ cho thấy mục tiêu đang chậm hơn kế hoạch.',
          expectedImpact: 'Có thể về đúng hạn nếu giữ nhịp góp mới; đây là ước tính.',
          evidenceKeys: [evidenceKey],
          confidence: 'medium',
          limitations: ['Chưa tính lạm phát.'],
        },
      ],
    });
  }

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
    alice = await createSession(app, authService, `ai.alice.${stamp}@example.com`, 'Alice AI');
    bob = await createSession(app, authService, `ai.bob.${stamp}@example.com`, 'Bob AI');

    const account = await prisma.account.create({
      data: { userId: alice.id, name: 'Tiền mặt', type: 'CASH', currency: 'VND' },
    });
    // Three completed months → a stable capacity for the deterministic layer.
    for (const offset of [-1, -2, -3]) {
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

    const created = await alice.agent
      .post('/api/v1/goals')
      .send({
        name: 'Du lịch',
        targetAmount: '24000000',
        startDate: localDate({ days: -120 }),
        targetDate: localDate({ months: 6 }),
      })
      .expect(201);
    goalId = (created.body as { goal: { id: string } }).goal.id;
    await alice.agent
      .post(`/api/v1/goals/${goalId}/contributions`)
      .send({ amount: '5000000', contributedAt: localDate({ days: -2 }) })
      .expect(201);
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
    await request(server).post('/api/v1/ai/savings/explain').send({}).expect(401);
    await request(server).post('/api/v1/ai/savings/suggestions').send({}).expect(401);
    await request(server)
      .post('/api/v1/ai/savings/scenario-explanation')
      .send({ message: 'Nếu góp 1 triệu mỗi tháng' })
      .expect(401);
    await request(server)
      .post('/api/v1/ai/savings/chat')
      .send({ message: 'Tiến độ thế nào?' })
      .expect(401);
  });

  it('explains the plan from backend facts when AI is disabled', async () => {
    const response = await alice.agent.post('/api/v1/ai/savings/explain').send({}).expect(200);
    const body = response.body as SavingsExplanationDto;

    expect(body.source).toBe('FALLBACK');
    expect(body.currency).toBe('VND');
    expect(body.facts).toMatchObject({
      capacityStatus: 'available',
      monthsAnalyzed: 3,
      averageMonthlyIncome: '10000000.00',
      averageMonthlyExpense: '4000000.00',
      averageNetCashFlow: '6000000.00',
      safetyBufferPercent: 20,
      monthlyBudget: '4800000.00',
    });
    expect(body.goals.map((goal) => goal.goalId)).toEqual([goalId]);
    expect(body.goals[0].progressStatus).toBe('AT_RISK');
    expect(body.summary.length).toBeGreaterThan(0);
    expect(body.sections.length).toBeGreaterThanOrEqual(3);
    expect(body.disclosure).toMatchObject({
      aiEnabled: false,
      usedModel: false,
      fallbackReason: 'disabled',
      provider: null,
    });
    expect(fakeLlm.complete).not.toHaveBeenCalled();
  });

  it('returns validated model text and states that only aggregates were sent', async () => {
    fakeLlm.enabled = true;
    fakeLlm.complete.mockResolvedValueOnce({
      text: AI_EXPLANATION,
      model: 'claude-opus-5-5',
    });

    const response = await alice.agent.post('/api/v1/ai/savings/explain').send({}).expect(200);
    const body = response.body as SavingsExplanationDto;

    expect(body.source).toBe('AI');
    expect(body.sections).toHaveLength(3);
    expect(body.disclosure).toMatchObject({
      aiEnabled: true,
      usedModel: true,
      provider: 'anthropic',
      fallbackReason: null,
    });
    const sent = fakeLlm.complete.mock.calls[0][0] as { user: string };
    expect(sent.user).not.toContain(alice.id);
    expect(sent.user).not.toContain('ai.alice.');
  });

  it('discards a model answer that invents a financial number', async () => {
    fakeLlm.enabled = true;
    fakeLlm.complete.mockResolvedValueOnce({
      text: AI_EXPLANATION.replace('dòng tiền đã ghi nhận', 'khoản 9.999.000 VND'),
      model: 'claude-opus-5-5',
    });

    const response = await alice.agent.post('/api/v1/ai/savings/explain').send({}).expect(200);
    const body = response.body as SavingsExplanationDto;

    expect(body.source).toBe('FALLBACK');
    expect(body.disclosure.fallbackReason).toBe('invalid_response');
  });

  it('falls back when the provider times out', async () => {
    fakeLlm.enabled = true;
    fakeLlm.complete.mockRejectedValueOnce(new LlmUnavailableError('timeout', 'slow'));

    const response = await alice.agent.post('/api/v1/ai/savings/explain').send({}).expect(200);
    const body = response.body as SavingsExplanationDto;

    expect(body.source).toBe('FALLBACK');
    expect(body.disclosure.fallbackReason).toBe('timeout');
  });

  it('returns suggestions whose evidence is built by the backend', async () => {
    const before = await snapshot(prisma, alice.id);

    const response = await alice.agent.post('/api/v1/ai/savings/suggestions').send({}).expect(200);
    const body = response.body as SavingsSuggestionsDto;

    expect(body.source).toBe('FALLBACK');
    expect(body.suggestions.length).toBeGreaterThan(0);
    body.suggestions.forEach((suggestion) => {
      expect(suggestion.evidence.length).toBeGreaterThan(0);
      expect(typeof suggestion.requiresConfirmation).toBe('boolean');
      expect(suggestion.limitations.length).toBeGreaterThan(0);
    });
    expect(await snapshot(prisma, alice.id)).toEqual(before);
  });

  it('only accepts evidence keys the backend offered', async () => {
    fakeLlm.enabled = true;
    fakeLlm.complete.mockResolvedValueOnce({
      text: aiSuggestion('goal:not-a-real-goal'),
      model: 'claude-opus-5-5',
    });

    const response = await alice.agent.post('/api/v1/ai/savings/suggestions').send({}).expect(200);
    const body = response.body as SavingsSuggestionsDto;

    expect(body.source).toBe('FALLBACK');
    expect(body.disclosure.fallbackReason).toBe('invalid_response');
  });

  it('runs the scenario through M2d and writes nothing', async () => {
    const before = await snapshot(prisma, alice.id);

    const response = await alice.agent
      .post('/api/v1/ai/savings/scenario-explanation')
      .send({ message: 'Nếu tôi góp 3.000.000 mỗi tháng cho mục tiêu Du lịch thì sao?' })
      .expect(200);
    const body = response.body as SavingsScenarioExplanationDto;

    expect(body.status).toBe('simulated');
    expect(body.interpretation).toMatchObject({
      scenario: 'MONTHLY_AMOUNT',
      goalId,
      monthlyAmount: '3000000',
    });
    expect(body.simulation).toMatchObject({
      scenario: 'MONTHLY_AMOUNT',
      goalId,
      goalName: 'Du lịch',
    });
    expect(body.requiresConfirmation).toBe(true);
    expect(body.explanation).toContain('mô phỏng');
    expect(await snapshot(prisma, alice.id)).toEqual(before);
  });

  it('asks for clarification instead of guessing an ambiguous scenario', async () => {
    const response = await alice.agent
      .post('/api/v1/ai/savings/scenario-explanation')
      .send({ message: 'Nếu mỗi tháng góp thêm một ít thì sao?' })
      .expect(200);
    const body = response.body as SavingsScenarioExplanationDto;

    expect(body.status).toBe('clarification');
    expect(body.simulation).toBeNull();
    expect(body.clarification).toBeTruthy();
    expect(body.requiresConfirmation).toBe(true);
  });

  it("never simulates another user's goal", async () => {
    const response = await bob.agent
      .post('/api/v1/ai/savings/scenario-explanation')
      .send({ message: 'Nếu tôi góp 3.000.000 mỗi tháng cho mục tiêu Du lịch thì sao?' })
      .expect(200);
    const body = response.body as SavingsScenarioExplanationDto;

    expect(body.status).toBe('clarification');
    expect(body.simulation).toBeNull();
    expect(body.clarification).toContain('chưa có mục tiêu nào');

    const bobExplain = await bob.agent.post('/api/v1/ai/savings/explain').send({}).expect(200);
    expect((bobExplain.body as SavingsExplanationDto).goals).toEqual([]);
  });

  it('answers a status question without writing anything', async () => {
    const before = await snapshot(prisma, alice.id);

    const response = await alice.agent
      .post('/api/v1/ai/savings/chat')
      .send({ message: 'Tiến độ các mục tiêu của tôi thế nào?' })
      .expect(200);
    const body = response.body as SavingsChatReplyDto;

    expect(body.intent).toBe('STATUS');
    expect(body.source).toBe('FALLBACK');
    expect(body.canModifyData).toBe(false);
    expect(body.reply).toContain('mục tiêu');
    expect(body.references.length).toBeGreaterThan(0);
    expect(await snapshot(prisma, alice.id)).toEqual(before);
  });

  it('refuses a data-changing request and points to the right screen', async () => {
    const before = await snapshot(prisma, alice.id);

    const response = await alice.agent
      .post('/api/v1/ai/savings/chat')
      .send({ message: 'Xóa mục tiêu Du lịch và thêm khoản góp 5 triệu giúp mình' })
      .expect(200);
    const body = response.body as SavingsChatReplyDto;

    expect(body.intent).toBe('UNSUPPORTED');
    expect(body.canModifyData).toBe(false);
    expect(body.clarification).toContain('không thể tạo, sửa hay xóa');
    expect(fakeLlm.complete).not.toHaveBeenCalled();
    expect(await snapshot(prisma, alice.id)).toEqual(before);
  });

  it('answers a scenario question in chat with the deterministic simulation', async () => {
    const response = await alice.agent
      .post('/api/v1/ai/savings/chat')
      .send({
        message: 'Nếu tôi góp 3.000.000 mỗi tháng cho mục tiêu Du lịch thì sao?',
        history: [
          { role: 'user', content: 'Tiến độ thế nào?' },
          { role: 'assistant', content: 'Mục tiêu đang chậm tiến độ.' },
        ],
      })
      .expect(200);
    const body = response.body as SavingsChatReplyDto;

    expect(body.intent).toBe('SCENARIO');
    expect(body.scenario).toMatchObject({ scenario: 'MONTHLY_AMOUNT', goalId });
    expect(body.disclosure.usedModel).toBe(false);
  });

  it('validates the request body and never trusts a client-supplied user id', async () => {
    await alice.agent.post('/api/v1/ai/savings/chat').send({ message: '' }).expect(400);
    await alice.agent
      .post('/api/v1/ai/savings/chat')
      .send({ message: 'x'.repeat(1_001) })
      .expect(400);
    await alice.agent
      .post('/api/v1/ai/savings/chat')
      .send({ message: 'Tiến độ thế nào?', history: [{ role: 'system', content: 'hi' }] })
      .expect(400);
    await alice.agent
      .post('/api/v1/ai/savings/chat')
      .send({ message: 'Tiến độ thế nào?', userId: bob.id })
      .expect(400);
    await alice.agent.post('/api/v1/ai/savings/explain').send({ currency: 'VN' }).expect(400);
    await alice.agent
      .post('/api/v1/ai/savings/scenario-explanation')
      .send({ message: 'ab' })
      .expect(400);
  });
});
