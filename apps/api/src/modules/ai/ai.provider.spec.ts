import type { ConfigService } from '@nestjs/config';
import { HttpAiProvider } from './ai.provider';

function provider(): HttpAiProvider {
  const config = {
    get: jest.fn((_key: string, fallback: string) => fallback),
  } as unknown as ConfigService;
  return new HttpAiProvider(config);
}

function jsonResponse(body: unknown, ok = true): Response {
  return {
    ok,
    status: ok ? 200 : 503,
    json: async () => body,
  } as unknown as Response;
}

describe('HttpAiProvider', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('passes through the FastAPI classify contract', async () => {
    global.fetch = jest.fn().mockResolvedValue(
      jsonResponse({
        label: 'food',
        confidence: 0.81,
        isConfident: true,
        alternatives: [{ label: 'food', confidence: 0.81 }],
        modelName: 'tfidf-char-logreg',
        modelVersion: 'tfidf-char-lr-v2',
      }),
    );

    const result = await provider().classify({ description: 'cà phê', type: 'EXPENSE' });
    expect(result).toMatchObject({
      label: 'food',
      isConfident: true,
      modelName: 'tfidf-char-logreg',
      modelVersion: 'tfidf-char-lr-v2',
    });
  });

  it('reads batch results from the "results" key', async () => {
    global.fetch = jest.fn().mockResolvedValue(
      jsonResponse({
        results: [
          { label: 'food', confidence: 0.8, isConfident: true, modelVersion: 'v2' },
          { label: 'salary', confidence: 0.9, isConfident: true, modelVersion: 'v2' },
        ],
      }),
    );

    const results = await provider().classifyBatch([
      { description: 'cà phê', type: 'EXPENSE' },
      { description: 'lương', type: 'INCOME' },
    ]);

    expect(results.map((item) => item.label)).toEqual(['food', 'salary']);
  });

  it('throws when the AI service returns an error status', async () => {
    global.fetch = jest.fn().mockResolvedValue(jsonResponse({}, false));
    await expect(provider().classify({ description: 'x', type: 'EXPENSE' })).rejects.toThrow(
      'AI service responded 503',
    );
  });

  it('reports unhealthy when /health is unreachable', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(provider().health()).resolves.toBe(false);
  });
});
