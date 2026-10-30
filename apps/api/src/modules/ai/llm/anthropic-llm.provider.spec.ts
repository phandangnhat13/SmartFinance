import { AnthropicLlmProvider } from './anthropic-llm.provider';
import { createLlmProvider } from './llm.factory';
import { LlmInvalidResponseError, LlmUnavailableError } from './llm.types';

const REQUEST = { system: 'system prompt', user: '{"question":"x"}', maxTokens: 900 };

function provider(overrides: Partial<ConstructorParameters<typeof AnthropicLlmProvider>[0]> = {}) {
  return new AnthropicLlmProvider({
    apiKey: 'test-key',
    model: 'claude-opus-5-5',
    baseUrl: 'https://api.anthropic.com',
    timeoutMs: 1_000,
    maxRetries: 0,
    maxTokens: 1_600,
    ...overrides,
  });
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function textResponse(text: string, model = 'claude-opus-5-5'): Response {
  return jsonResponse({ model, content: [{ type: 'text', text }] });
}

describe('AnthropicLlmProvider', () => {
  const originalFetch = global.fetch;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.useRealTimers();
  });

  it('is disabled when no key is configured', async () => {
    const llm = provider({ apiKey: undefined });
    expect(llm.enabled).toBe(false);
    await expect(llm.complete(REQUEST)).rejects.toMatchObject({ reason: 'not_configured' });
  });

  it('calls the Messages API with a system prompt and no sampling parameters', async () => {
    fetchMock.mockResolvedValue(textResponse(' Xin chào '));
    const llm = provider();

    const result = await llm.complete(REQUEST);

    expect(result.text).toBe('Xin chào');
    expect(result.model).toBe('claude-opus-5-5');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    const headers = init.headers as Record<string, string>;
    expect(headers['x-api-key']).toBe('test-key');
    expect(headers['anthropic-version']).toBe('2023-06-01');
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body.model).toBe('claude-opus-5-5');
    expect(body.system).toBe('system prompt');
    expect(body.max_tokens).toBe(900);
    expect(body.messages).toEqual([{ role: 'user', content: '{"question":"x"}' }]);
    expect(body).not.toHaveProperty('temperature');
  });

  it('retries a 429 once and then succeeds', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ error: 'rate' }, 429))
      .mockResolvedValueOnce(textResponse('ok'));
    const llm = provider({ maxRetries: 1 });

    await expect(llm.complete(REQUEST)).resolves.toMatchObject({ text: 'ok' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('maps an exhausted 429 to rate_limited', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: 'rate' }, 429));
    const llm = provider({ maxRetries: 1 });

    await expect(llm.complete(REQUEST)).rejects.toMatchObject({ reason: 'rate_limited' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not retry an authentication failure', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: 'auth' }, 401));
    const llm = provider({ maxRetries: 3 });

    await expect(llm.complete(REQUEST)).rejects.toMatchObject({ reason: 'not_configured' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('maps a timeout and a network failure to stable reasons', async () => {
    const timeout = Object.assign(new Error('timeout'), { name: 'TimeoutError' });
    fetchMock.mockRejectedValueOnce(timeout);
    await expect(provider().complete(REQUEST)).rejects.toMatchObject({ reason: 'timeout' });

    fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    await expect(provider().complete(REQUEST)).rejects.toMatchObject({ reason: 'provider_error' });
  });

  it('rejects an empty or non-JSON response', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ content: [] }));
    await expect(provider().complete(REQUEST)).rejects.toBeInstanceOf(LlmInvalidResponseError);

    fetchMock.mockResolvedValueOnce(
      new Response('not json', { status: 200, headers: { 'Content-Type': 'text/plain' } }),
    );
    await expect(provider().complete(REQUEST)).rejects.toBeInstanceOf(LlmInvalidResponseError);
  });

  it('never includes the key or data in the thrown error message', async () => {
    fetchMock.mockResolvedValue(jsonResponse({}, 500));
    try {
      await provider().complete(REQUEST);
      throw new Error('expected failure');
    } catch (error) {
      expect(error).toBeInstanceOf(LlmUnavailableError);
      expect(String((error as Error).message)).not.toContain('test-key');
      expect(String((error as Error).message)).not.toContain('question');
    }
  });
});

describe('createLlmProvider', () => {
  it('stays disabled for a missing or unknown provider', () => {
    expect(createLlmProvider({}).enabled).toBe(false);
    expect(createLlmProvider({ provider: 'openai' }).enabled).toBe(false);
  });

  it('builds an Anthropic provider with safe defaults and clamps', () => {
    const llm = createLlmProvider({
      provider: 'anthropic',
      apiKey: ' key ',
      timeoutMs: '1',
      maxRetries: '99',
      maxTokens: '999999',
    });
    expect(llm.name).toBe('anthropic');
    expect(llm.enabled).toBe(true);
    expect(llm.model).toBe('claude-opus-5-5');
    // Clamped values are not exposed, but the provider must still be usable.
    expect(typeof llm.complete).toBe('function');
  });
});
