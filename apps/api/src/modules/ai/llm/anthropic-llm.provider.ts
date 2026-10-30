import {
  LlmInvalidResponseError,
  LlmUnavailableError,
  type LlmCompletionRequest,
  type LlmCompletionResult,
  type LlmProvider,
  type LlmProviderConfig,
} from './llm.types';

/** The Messages API version this adapter was written against. */
const ANTHROPIC_VERSION = '2023-06-01';
/** Base delay between retries; doubled per attempt and capped. */
const RETRY_BASE_MS = 200;
const RETRY_MAX_MS = 1_000;

interface AnthropicContentBlock {
  type?: unknown;
  text?: unknown;
}

interface AnthropicMessageResponse {
  content?: unknown;
  model?: unknown;
}

/**
 * Anthropic Messages API adapter over `fetch`.
 *
 * Deliberately dependency-free: the integration is optional and disabled by
 * default, so pulling a provider SDK into the API would add weight for every
 * deployment that never enables it. Only the system prompt and the aggregated
 * savings context are sent; no identifier, token, transaction or note is.
 */
export class AnthropicLlmProvider implements LlmProvider {
  readonly name = 'anthropic';

  constructor(
    private readonly config: Pick<
      LlmProviderConfig,
      'apiKey' | 'model' | 'baseUrl' | 'timeoutMs' | 'maxRetries' | 'maxTokens'
    >,
  ) {}

  /** A provider without a key is not usable, so it reports itself as disabled. */
  get enabled(): boolean {
    return Boolean(this.config.apiKey);
  }

  get model(): string | null {
    return this.config.model;
  }

  async complete(request: LlmCompletionRequest): Promise<LlmCompletionResult> {
    if (!this.config.apiKey) {
      throw new LlmUnavailableError('not_configured', 'Thiếu khoá API cho nhà cung cấp AI');
    }

    const attempts = Math.max(0, this.config.maxRetries) + 1;
    let lastError: LlmUnavailableError | null = null;

    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        return await this.callOnce(request);
      } catch (error) {
        // A malformed response is not a transport failure: retrying will not
        // help, and the caller needs the distinct `invalid_response` reason.
        if (error instanceof LlmInvalidResponseError) throw error;
        const unavailable =
          error instanceof LlmUnavailableError
            ? error
            : new LlmUnavailableError('provider_error', 'Nhà cung cấp AI trả lỗi');
        lastError = unavailable;
        const retryable =
          unavailable.reason === 'timeout' ||
          unavailable.reason === 'rate_limited' ||
          (unavailable.reason === 'provider_error' && (unavailable.status ?? 500) >= 500);
        if (!retryable || attempt === attempts - 1) throw unavailable;
        await this.delay(Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** attempt));
      }
    }

    throw lastError ?? new LlmUnavailableError('provider_error', 'Nhà cung cấp AI trả lỗi');
  }

  private async callOnce(request: LlmCompletionRequest): Promise<LlmCompletionResult> {
    const url = `${this.config.baseUrl.replace(/\/+$/, '')}/v1/messages`;
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': this.config.apiKey ?? '',
          'anthropic-version': ANTHROPIC_VERSION,
        },
        body: JSON.stringify({
          model: this.config.model,
          max_tokens: request.maxTokens || this.config.maxTokens,
          // A stable system prompt keeps user text in a separate role, so a
          // prompt-injected question can never act as an instruction block.
          system: request.system,
          messages: [{ role: 'user', content: request.user }],
        }),
        signal: AbortSignal.timeout(this.config.timeoutMs),
      });
    } catch (error) {
      const name = error instanceof Error ? error.name : '';
      if (name === 'TimeoutError' || name === 'AbortError') {
        throw new LlmUnavailableError('timeout', 'Nhà cung cấp AI phản hồi quá chậm');
      }
      throw new LlmUnavailableError('provider_error', 'Không kết nối được nhà cung cấp AI');
    }

    if (!response.ok) {
      throw new LlmUnavailableError(
        response.status === 429
          ? 'rate_limited'
          : response.status === 401 || response.status === 403
            ? 'not_configured'
            : 'provider_error',
        `Nhà cung cấp AI trả mã ${response.status}`,
        response.status,
      );
    }

    let body: AnthropicMessageResponse;
    try {
      body = (await response.json()) as AnthropicMessageResponse;
    } catch {
      throw new LlmInvalidResponseError('Phản hồi AI không phải JSON');
    }

    if (!Array.isArray(body.content)) {
      throw new LlmInvalidResponseError('Phản hồi AI thiếu nội dung');
    }
    const text = (body.content as AnthropicContentBlock[])
      .filter((block) => block && block.type === 'text' && typeof block.text === 'string')
      .map((block) => block.text as string)
      .join('\n')
      .trim();
    if (!text) throw new LlmInvalidResponseError('Phản hồi AI rỗng');

    return {
      text,
      model: typeof body.model === 'string' ? body.model : this.config.model,
    };
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
