const DURATION_REGEX = /^(\d+)([smhd])?$/;

/**
 * Converts values such as "7d", "12h", "30m" or "3600" into seconds.
 * The JSON Web Token library types only accept numbers, so a single helper
 * keeps the env value human-readable while remaining type-safe.
 */
export function parseDurationSeconds(value: string | undefined, fallbackSeconds: number): number {
  if (!value) return fallbackSeconds;
  const match = DURATION_REGEX.exec(value.trim());
  if (!match) return fallbackSeconds;
  const amount = Number(match[1]);
  const unit = match[2] ?? 's';
  const multipliers: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };
  const seconds = amount * (multipliers[unit] ?? 1);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : fallbackSeconds;
}
