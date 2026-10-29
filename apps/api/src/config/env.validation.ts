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

  if (errors.length > 0) {
    throw new Error(`Invalid environment configuration: ${errors.join('; ')}`);
  }

  return config;
}
