import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { SuperAgentTest } from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { ACCESS_TOKEN_COOKIE } from '../src/common/guards/jwt-auth.guard';
import { AuthService } from '../src/modules/auth/auth.service';
import { LLM_PROVIDER } from '../src/modules/ai/llm/llm.types';

/** Instant local provider: the suite must not depend on a network LLM. */
const fakeLlm = {
  name: 'anthropic',
  model: 'claude-opus-5-5',
  enabled: true,
  complete: jest.fn().mockResolvedValue({
    text: JSON.stringify({ reply: 'Câu trả lời kiểm thử.', referenceKeys: [] }),
    model: 'claude-opus-5-5',
  }),
};

async function createSession(
  application: NestExpressApplication,
  service: AuthService,
): Promise<SuperAgentTest> {
  const user = await service.register({
    email: `ai.conv.throttle.${Date.now()}@example.com`,
    password: 'Password123!',
    displayName: 'Throttle Conversations',
  });
  const token = await service.issueAccessToken(user);
  const agent = request.agent(application.getHttpServer()) as unknown as SuperAgentTest;
  const jar = (agent as unknown as { jar: { setCookie(cookie: string): void } }).jar;
  jar.setCookie(`${ACCESS_TOKEN_COOKIE}=${token}; Path=/`);
  return agent;
}

describe('AI conversations rate limit (e2e)', () => {
  it('answers 429 once the per-minute send budget is spent', async () => {
    // A separate app instance keeps its throttler counters away from the other
    // suite, so the first request over the limit is the first blocked one.
    // The LLM is disabled in this environment, so sends return the deterministic
    // fallback and never reach a network provider.
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(LLM_PROVIDER)
      .useValue(fakeLlm)
      .compile();
    const app = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false });
    configureApp(app);
    await app.init();

    try {
      const agent = await createSession(app, app.get(AuthService));
      const conversation = await agent
        .post('/api/v1/ai/conversations')
        .send({ assistantType: 'SAVINGS', title: 'Giới hạn tần suất' })
        .expect(201);
      const id = (conversation.body as { id: string }).id;

      for (let index = 0; index < 15; index += 1) {
        await agent
          .post(`/api/v1/ai/conversations/${id}/messages`)
          .send({ content: `Tiến độ thế nào? lần ${index}` })
          .expect(200);
      }

      const blocked = await agent
        .post(`/api/v1/ai/conversations/${id}/messages`)
        .send({ content: 'Tiến độ thế nào? lần cuối' })
        .expect(429);
      expect(blocked.body).toMatchObject({ statusCode: 429, code: 'RATE_LIMITED' });
      expect(blocked.headers['retry-after']).toBe('60');
    } finally {
      await app.close();
    }
  });
});
