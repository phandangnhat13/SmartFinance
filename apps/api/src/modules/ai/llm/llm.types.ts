/**
 * Minimal LLM abstraction for the savings assistant (M2e).
 *
 * A provider is a plain text completion endpoint. The assistant never sends raw
 * transactions, identifiers, balances or secrets: only the aggregated savings
 * context that the deterministic backend already computed. Providers are
 * disabled unless explicitly configured, so a deployment without an API key
 * still works through the deterministic fallback.
 */
export const LLM_PROVIDER = 'LLM_PROVIDER';

export type LlmFallbackReason =
  | 'disabled'
  | 'not_configured'
  | 'timeout'
  | 'rate_limited'
  | 'provider_error'
  | 'invalid_response';

export interface LlmCompletionRequest {
  /** Stable instructions. Kept separate so user text can never become a system prompt. */
  system: string;
  /** JSON payload with the question and the backend-computed context. */
  user: string;
  maxTokens: number;
}

export interface LlmCompletionResult {
  text: string;
  model: string;
}

export interface LlmProvider {
  /** `disabled` when no model is configured. */
  readonly name: string;
  readonly model: string | null;
  readonly enabled: boolean;
  complete(request: LlmCompletionRequest): Promise<LlmCompletionResult>;
}

/** Provider call failed; the assistant falls back to deterministic text. */
export class LlmUnavailableError extends Error {
  constructor(
    readonly reason: Exclude<LlmFallbackReason, 'invalid_response'>,
    message: string,
    /** Upstream HTTP status, when there was one. Never logged with user data. */
    readonly status?: number,
  ) {
    super(message);
    this.name = 'LlmUnavailableError';
  }
}

/** The provider answered, but not with usable text. */
export class LlmInvalidResponseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LlmInvalidResponseError';
  }
}

export interface LlmProviderConfig {
  provider: string;
  apiKey: string | undefined;
  model: string;
  baseUrl: string;
  timeoutMs: number;
  maxRetries: number;
  maxTokens: number;
}

export const DISABLED_LLM: LlmProvider = {
  name: 'disabled',
  model: null,
  enabled: false,
  complete: () => Promise.reject(new LlmUnavailableError('disabled', 'AI chưa được cấu hình')),
};
