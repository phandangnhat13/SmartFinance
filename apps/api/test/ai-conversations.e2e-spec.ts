import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { SuperAgentTest } from 'supertest';
import type {
  AiConversationListDto,
  AiMessageListDto,
  SendAiMessageResponseDto,
} from '@smart-finance/shared-types';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { ACCESS_TOKEN_COOKIE } from '../src/common/guards/jwt-auth.guard';
import { AuthService } from '../src/modules/auth/auth.service';
import { AnalyticsAnalystService } from '../src/modules/ai/analytics-analyst/analytics-analyst.service';
import { LLM_PROVIDER, LlmUnavailableError } from '../src/modules/ai/llm/llm.types';

interface Session {
  id: string;
  agent: SuperAgentTest;
}

/** Controllable provider: every AI call in this suite is deterministic. */
const fakeLlm = {
  name: 'anthropic',
  model: 'claude-opus-5-5',
  enabled: true,
  complete: jest.fn(),
};

const AI_REPLY = 'Câu trả lời kiểm thử từ trợ lý.';

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

function lastPrompt(): Record<string, unknown> {
  const call = fakeLlm.complete.mock.calls.at(-1)?.[0] as { user?: string } | undefined;
  return JSON.parse(String(call?.user ?? '{}')) as Record<string, unknown>;
}

/**
 * Persistent AI conversations (floating widget). The provider is replaced with
 * a fake so message text is deterministic; every assertion about ownership,
 * pagination and storage still runs against the real database.
 */
describe('AI conversations API (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let alice: Session;
  let bob: Session;
  const stamp = `${Date.now()}.${Math.floor(Math.random() * 1e6)}`;

  async function createConversation(
    agent: SuperAgentTest,
    body: { assistantType: 'SAVINGS' | 'ANALYTICS'; title?: string },
  ) {
    const response = await agent.post('/api/v1/ai/conversations').send(body).expect(201);
    return response.body as { id: string; title: string; assistantType: string };
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(LLM_PROVIDER)
      .useValue(fakeLlm)
      .compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false });
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    alice = await createSession(
      app,
      app.get(AuthService),
      `conv.alice.${stamp}@example.com`,
      'Alice',
    );
    bob = await createSession(app, app.get(AuthService), `conv.bob.${stamp}@example.com`, 'Bob');
  });

  beforeEach(() => {
    fakeLlm.enabled = true;
    fakeLlm.complete.mockReset();
    fakeLlm.complete.mockResolvedValue({
      text: JSON.stringify({ reply: AI_REPLY, referenceKeys: [] }),
      model: 'claude-opus-5-5',
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('creates, lists, searches, renames and deletes a conversation', async () => {
    const created = await createConversation(alice.agent, {
      assistantType: 'ANALYTICS',
      title: 'Phân tích tháng 10',
    });
    expect(created).toMatchObject({
      title: 'Phân tích tháng 10',
      assistantType: 'ANALYTICS',
    });
    expect(created).not.toHaveProperty('userId');

    const listed = await alice.agent
      .get('/api/v1/ai/conversations?q=phân tích tháng 10')
      .expect(200);
    const list = listed.body as AiConversationListDto;
    expect(list.items.map((item) => item.id)).toContain(created.id);

    const renamed = await alice.agent
      .patch(`/api/v1/ai/conversations/${created.id}`)
      .send({ title: '  Ngân sách tháng 10  ' })
      .expect(200);
    expect((renamed.body as { title: string }).title).toBe('Ngân sách tháng 10');

    const searched = await alice.agent.get('/api/v1/ai/conversations?q=ngân sách').expect(200);
    expect((searched.body as AiConversationListDto).items.map((item) => item.id)).toContain(
      created.id,
    );

    await alice.agent.delete(`/api/v1/ai/conversations/${created.id}`).expect(204);
    await alice.agent.get(`/api/v1/ai/conversations/${created.id}`).expect(404);
  });

  it('auto-titles from the first message and stores both turns in order', async () => {
    const conversation = await createConversation(alice.agent, { assistantType: 'ANALYTICS' });
    expect(conversation.title).toBe('Cuộc trò chuyện mới');

    const sent = await alice.agent
      .post(`/api/v1/ai/conversations/${conversation.id}/messages`)
      .send({ content: 'Tóm tắt tình hình tháng này' })
      .expect(200);
    const body = sent.body as SendAiMessageResponseDto;
    expect(body.userMessage).toMatchObject({
      role: 'USER',
      content: 'Tóm tắt tình hình tháng này',
      metadata: null,
    });
    expect(body.assistantMessage).toMatchObject({ role: 'ASSISTANT', content: AI_REPLY });
    expect(body.assistantMessage.metadata).toMatchObject({
      assistantType: 'ANALYTICS',
      reply: { source: 'AI', intent: 'SUMMARY', canModifyData: false },
    });

    const detail = await alice.agent.get(`/api/v1/ai/conversations/${conversation.id}`).expect(200);
    expect((detail.body as { title: string }).title).toBe('Tóm tắt tình hình tháng này');

    const messages = await alice.agent
      .get(`/api/v1/ai/conversations/${conversation.id}/messages`)
      .expect(200);
    const page = messages.body as AiMessageListDto;
    expect(page.total).toBe(2);
    expect(page.items.map((item) => item.role)).toEqual(['USER', 'ASSISTANT']);

    const stored = await prisma.aiMessage.count({ where: { conversationId: conversation.id } });
    expect(stored).toBe(2);
  });

  it('routes by assistant type and sends only a bounded prior history', async () => {
    const analytics = await createConversation(alice.agent, { assistantType: 'ANALYTICS' });
    await alice.agent
      .post(`/api/v1/ai/conversations/${analytics.id}/messages`)
      .send({ content: 'Tóm tắt tình hình tháng này' })
      .expect(200);
    const firstPrompt = lastPrompt();
    expect(firstPrompt).not.toHaveProperty('history');

    await alice.agent
      .post(`/api/v1/ai/conversations/${analytics.id}/messages`)
      .send({ content: 'Tóm tắt tình hình tháng này lần nữa' })
      .expect(200);
    const secondPrompt = lastPrompt();
    expect(secondPrompt.task).toBe('ANALYTICS_CHAT');
    const history = secondPrompt.history as Array<{ role: string; content: string }>;
    expect(history).toHaveLength(2);
    expect(history[0]).toMatchObject({ role: 'user', content: 'Tóm tắt tình hình tháng này' });
    expect(history[1]).toMatchObject({ role: 'assistant', content: AI_REPLY });
    expect(secondPrompt.question).toBe('Tóm tắt tình hình tháng này lần nữa');

    const savings = await createConversation(alice.agent, { assistantType: 'SAVINGS' });
    await alice.agent
      .post(`/api/v1/ai/conversations/${savings.id}/messages`)
      .send({ content: 'Tiến độ thế nào?' })
      .expect(200);
    await alice.agent
      .post(`/api/v1/ai/conversations/${savings.id}/messages`)
      .send({ content: 'Tiến độ thế nào?' })
      .expect(200);
    const savingsPrompt = lastPrompt();
    expect(savingsPrompt.task).toBe('ANSWER_SAVINGS_QUESTION');
    expect(savingsPrompt.history).toHaveLength(2);
  });

  it('caps model context at the six most recent turns', async () => {
    const conversation = await createConversation(alice.agent, { assistantType: 'ANALYTICS' });
    const base = Date.now();
    await prisma.aiMessage.createMany({
      data: Array.from({ length: 12 }, (_, index) => ({
        conversationId: conversation.id,
        role: index % 2 === 0 ? ('USER' as const) : ('ASSISTANT' as const),
        content: `tin nhắn ${index}`,
        createdAt: new Date(base + index),
      })),
    });

    await alice.agent
      .post(`/api/v1/ai/conversations/${conversation.id}/messages`)
      .send({ content: 'Tóm tắt tình hình tháng này' })
      .expect(200);

    const history = lastPrompt().history as Array<{ content: string }>;
    expect(history).toHaveLength(6);
    expect(history[0]?.content).toBe('tin nhắn 6');
    expect(history[5]?.content).toBe('tin nhắn 11');
  });

  it('paginates conversations and messages newest-page-first', async () => {
    for (let index = 1; index <= 5; index += 1) {
      await createConversation(alice.agent, {
        assistantType: 'ANALYTICS',
        title: `Phân trang ${stamp} ${index}`,
      });
    }
    const firstPage = await alice.agent
      .get(`/api/v1/ai/conversations?q=Phân trang ${stamp}&limit=2&page=1`)
      .expect(200);
    const first = firstPage.body as AiConversationListDto;
    expect(first.total).toBe(5);
    expect(first.totalPages).toBe(3);
    expect(first.items).toHaveLength(2);
    expect(first.items[0]?.title).toBe(`Phân trang ${stamp} 5`);

    const secondPage = await alice.agent
      .get(`/api/v1/ai/conversations?q=Phân trang ${stamp}&limit=2&page=2`)
      .expect(200);
    expect((secondPage.body as AiConversationListDto).items.map((item) => item.title)).toEqual([
      `Phân trang ${stamp} 3`,
      `Phân trang ${stamp} 2`,
    ]);

    const conversation = await createConversation(alice.agent, { assistantType: 'ANALYTICS' });
    const base = Date.now();
    await prisma.aiMessage.createMany({
      data: Array.from({ length: 35 }, (_, index) => ({
        conversationId: conversation.id,
        role: index % 2 === 0 ? ('USER' as const) : ('ASSISTANT' as const),
        content: `tin ${index}`,
        createdAt: new Date(base + index),
      })),
    });

    const newest = await alice.agent
      .get(`/api/v1/ai/conversations/${conversation.id}/messages?limit=30&page=1`)
      .expect(200);
    const newestPage = newest.body as AiMessageListDto;
    expect(newestPage.total).toBe(35);
    expect(newestPage.totalPages).toBe(2);
    expect(newestPage.items).toHaveLength(30);
    expect(newestPage.items[0]?.content).toBe('tin 5');
    expect(newestPage.items[29]?.content).toBe('tin 34');

    const older = await alice.agent
      .get(`/api/v1/ai/conversations/${conversation.id}/messages?limit=30&page=2`)
      .expect(200);
    const olderPage = older.body as AiMessageListDto;
    expect(olderPage.items.map((item) => item.content)).toEqual(
      Array.from({ length: 5 }, (_, index) => `tin ${index}`),
    );
  });

  it('never exposes another account’s conversation (IDOR)', async () => {
    const conversation = await createConversation(alice.agent, { assistantType: 'ANALYTICS' });
    await alice.agent
      .post(`/api/v1/ai/conversations/${conversation.id}/messages`)
      .send({ content: 'Tóm tắt tình hình tháng này' })
      .expect(200);

    await bob.agent.get(`/api/v1/ai/conversations/${conversation.id}`).expect(404);
    await bob.agent.get(`/api/v1/ai/conversations/${conversation.id}/messages`).expect(404);
    await bob.agent
      .post(`/api/v1/ai/conversations/${conversation.id}/messages`)
      .send({ content: 'Đọc trộm' })
      .expect(404);
    await bob.agent
      .patch(`/api/v1/ai/conversations/${conversation.id}`)
      .send({ title: 'Chiếm đoạt' })
      .expect(404);
    await bob.agent.delete(`/api/v1/ai/conversations/${conversation.id}`).expect(404);

    const bobList = await bob.agent.get('/api/v1/ai/conversations').expect(200);
    expect((bobList.body as AiConversationListDto).items.map((item) => item.id)).not.toContain(
      conversation.id,
    );

    // The owner still sees the intact transcript.
    const owned = await alice.agent
      .get(`/api/v1/ai/conversations/${conversation.id}/messages`)
      .expect(200);
    expect((owned.body as AiMessageListDto).total).toBe(2);
  });

  it('deletes the conversation and cascades its messages', async () => {
    const conversation = await createConversation(alice.agent, { assistantType: 'ANALYTICS' });
    await alice.agent
      .post(`/api/v1/ai/conversations/${conversation.id}/messages`)
      .send({ content: 'Tóm tắt tình hình tháng này' })
      .expect(200);

    await alice.agent.delete(`/api/v1/ai/conversations/${conversation.id}`).expect(204);

    const orphanMessages = await prisma.aiMessage.count({
      where: { conversationId: conversation.id },
    });
    expect(orphanMessages).toBe(0);
  });

  it('validates input and rejects unknown ids consistently', async () => {
    await alice.agent
      .post('/api/v1/ai/conversations')
      .send({ assistantType: 'UNKNOWN' })
      .expect(400);
    await alice.agent.post('/api/v1/ai/conversations').send({}).expect(400);

    const conversation = await createConversation(alice.agent, { assistantType: 'ANALYTICS' });
    await alice.agent
      .patch(`/api/v1/ai/conversations/${conversation.id}`)
      .send({ title: '   ' })
      .expect(400);
    await alice.agent
      .post(`/api/v1/ai/conversations/${conversation.id}/messages`)
      .send({ content: '   ' })
      .expect(400);
    await alice.agent
      .post(`/api/v1/ai/conversations/${conversation.id}/messages`)
      .send({ content: 'a'.repeat(1_001) })
      .expect(400);

    await alice.agent
      .get('/api/v1/ai/conversations/00000000-0000-4000-8000-000000000000')
      .expect(404);
    await alice.agent.get('/api/v1/ai/conversations/not-a-uuid').expect(400);
  });

  it('stores a labelled deterministic fallback when the provider fails', async () => {
    const conversation = await createConversation(alice.agent, { assistantType: 'ANALYTICS' });
    fakeLlm.complete.mockRejectedValueOnce(
      new LlmUnavailableError('provider_error', 'provider down'),
    );

    const sent = await alice.agent
      .post(`/api/v1/ai/conversations/${conversation.id}/messages`)
      .send({ content: 'Tóm tắt tình hình tháng này' })
      .expect(200);
    const assistant = (sent.body as SendAiMessageResponseDto).assistantMessage;
    expect(assistant.metadata).toMatchObject({
      assistantType: 'ANALYTICS',
      reply: {
        source: 'FALLBACK',
        canModifyData: false,
        disclosure: { usedModel: false, fallbackReason: 'provider_error' },
      },
    });
    expect(assistant.content.length).toBeGreaterThan(0);
  });

  it('writes nothing when the assistant throws unexpectedly', async () => {
    const conversation = await createConversation(alice.agent, { assistantType: 'ANALYTICS' });
    const analytics = app.get(AnalyticsAnalystService);
    const spy = jest.spyOn(analytics, 'chat').mockRejectedValueOnce(new Error('boom'));

    try {
      await alice.agent
        .post(`/api/v1/ai/conversations/${conversation.id}/messages`)
        .send({ content: 'Tóm tắt tình hình tháng này' })
        .expect(500);
    } finally {
      spy.mockRestore();
    }

    expect(await prisma.aiMessage.count({ where: { conversationId: conversation.id } })).toBe(0);
  });
});
