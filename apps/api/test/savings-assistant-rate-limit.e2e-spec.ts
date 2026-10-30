import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { SuperAgentTest } from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { ACCESS_TOKEN_COOKIE } from '../src/common/guards/jwt-auth.guard';
import { AuthService } from '../src/modules/auth/auth.service';

async function createSession(
  application: NestExpressApplication,
  service: AuthService,
): Promise<SuperAgentTest> {
  const user = await service.register({
    email: `ai.throttle.${Date.now()}@example.com`,
    password: 'Password123!',
    displayName: 'Throttle AI',
  });
  const token = await service.issueAccessToken(user);
  const agent = request.agent(application.getHttpServer()) as unknown as SuperAgentTest;
  const jar = (agent as unknown as { jar: { setCookie(cookie: string): void } }).jar;
  jar.setCookie(`${ACCESS_TOKEN_COOKIE}=${token}; Path=/`);
  return agent;
}

describe('AI savings assistant rate limit (e2e)', () => {
  it('answers 429 once the per-minute explain budget is spent', async () => {
    // A separate app instance keeps its throttler counters away from the other
    // suite, so the first request over the limit is the first blocked one.
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const app = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false });
    configureApp(app);
    await app.init();

    try {
      const agent = await createSession(app, app.get(AuthService));

      for (let index = 0; index < 10; index += 1) {
        await agent.post('/api/v1/ai/savings/explain').send({}).expect(200);
      }

      const blocked = await agent.post('/api/v1/ai/savings/explain').send({}).expect(429);
      expect(blocked.body).toMatchObject({ statusCode: 429, code: 'RATE_LIMITED' });
      expect(blocked.headers['retry-after']).toBe('60');
    } finally {
      await app.close();
    }
  });
});
