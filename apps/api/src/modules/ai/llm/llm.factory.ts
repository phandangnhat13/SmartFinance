import { AnthropicLlmProvider } from './anthropic-llm.provider';
import { DISABLED_LLM, type LlmProvider } from './llm.types';

export interface LlmEnvironment {
  provider?: string;
  apiKey?: string;
  model?: string;
  baseUrl?: string;
  timeoutMs?: string | number;
  maxRetries?: string | number;
  maxTokens?: string | number;
}

const DEFAULT_MODEL = 'claude-opus-5-5';
const DEFAULT_BASE_URL = 'https://api.anthropic.com';

function int(
  value: string | number | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  const parsed = Math.floor(Number(value ?? fallback));
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

/**
 * Builds the configured provider. Anything other than `anthropic` yields the
 * disabled provider: an unknown or misspelled value can never silently switch
 * the assistant on or send data somewhere unintended.
 */
export function createLlmProvider(env: LlmEnvironment): LlmProvider {
  const provider = (env.provider ?? 'disabled').trim().toLowerCase();
  if (provider !== 'anthropic') return DISABLED_LLM;
  return new AnthropicLlmProvider({
    apiKey: env.apiKey?.trim() || undefined,
    model: (env.model ?? DEFAULT_MODEL).trim() || DEFAULT_MODEL,
    baseUrl: (env.baseUrl ?? DEFAULT_BASE_URL).trim() || DEFAULT_BASE_URL,
    timeoutMs: int(env.timeoutMs, 20_000, 1_000, 60_000),
    maxRetries: int(env.maxRetries, 1, 0, 3),
    maxTokens: int(env.maxTokens, 1_600, 256, 8_192),
  });
}
