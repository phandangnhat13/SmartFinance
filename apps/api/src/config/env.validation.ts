/**
 * Fail fast on missing/insecure configuration. Secrets are never logged.
 */
export function validateEnv(config: Record<string, unknown>): Record<string, unknown> {
  const errors: string[] = [];

  const required = ['DATABASE_URL', 'JWT_SECRET'] as const;
  for (const key of required) {
    if (typeof config[key] !== 'string' || !(config[key] as string).trim()) {
      errors.push(`${key} is required`);
    }
  }

  const jwtSecret = config.JWT_SECRET;
  if (typeof jwtSecret === 'string' && jwtSecret.length < 32) {
    errors.push('JWT_SECRET must be at least 32 characters long');
  }

  const port = Number(config.PORT ?? 3000);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    errors.push('PORT must be a valid TCP port');
  }

  const env = String(config.NODE_ENV ?? 'development');
  if (env === 'production' && String(config.COOKIE_SECURE) !== 'true') {
    errors.push('COOKIE_SECURE must be true in production');
  }

  // Optional LLM for the savings assistant. Nothing is enabled by default, and
  // an `anthropic` provider without a key must fail fast instead of quietly
  // falling back at request time.
  const llmProvider = String(config.LLM_PROVIDER ?? 'disabled')
    .trim()
    .toLowerCase();
  if (!['disabled', 'anthropic'].includes(llmProvider)) {
    errors.push('LLM_PROVIDER must be "disabled" or "anthropic"');
  }
  if (llmProvider === 'anthropic') {
    if (typeof config.LLM_API_KEY !== 'string' || !config.LLM_API_KEY.trim()) {
      errors.push('LLM_API_KEY is required when LLM_PROVIDER=anthropic');
    }
    const baseUrl = String(config.LLM_BASE_URL ?? 'https://api.anthropic.com');
    if (!/^https?:\/\/\S+$/i.test(baseUrl)) {
      errors.push('LLM_BASE_URL must be an http(s) URL');
    }
    const model = String(config.LLM_MODEL ?? '').trim();
    if (config.LLM_MODEL !== undefined && !model) {
      errors.push('LLM_MODEL must not be empty');
    }
  }
  const boundedNumber = (key: string, min: number, max: number) => {
    if (config[key] === undefined || config[key] === '') return;
    const value = Number(config[key]);
    if (!Number.isInteger(value) || value < min || value > max) {
      errors.push(`${key} must be an integer between ${min} and ${max}`);
    }
  };
  boundedNumber('LLM_TIMEOUT_MS', 1_000, 60_000);
  boundedNumber('LLM_MAX_RETRIES', 0, 3);
  boundedNumber('LLM_MAX_TOKENS', 256, 8_192);

  if (errors.length > 0) {
    throw new Error(`Invalid environment configuration: ${errors.join('; ')}`);
  }

  return config;
}
