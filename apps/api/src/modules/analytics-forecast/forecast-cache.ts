import type { AnalyticsForecastDto } from '@smart-finance/shared-types';

/**
 * Small in-memory cache for forecasts (M3c).
 *
 * The key includes the user, currency, timezone, horizon **and a data
 * fingerprint** (transaction/account count + latest update). Any write to the
 * user's transactions or accounts changes the fingerprint, so a stale entry can
 * never be served — there is no need to wire invalidation into M2 write paths.
 * A short TTL and a size cap act as a backstop, e.g. after a restore that keeps
 * timestamps unchanged.
 *
 * Limitation: the cache lives per API process. Multiple instances each keep
 * their own copy; correctness still holds because the fingerprint travels in
 * the key.
 */
export const FORECAST_CACHE_TTL_MS = 5 * 60 * 1000;
export const FORECAST_CACHE_MAX_ENTRIES = 500;

interface Entry {
  expiresAt: number;
  value: AnalyticsForecastDto;
}

export class ForecastCache {
  private readonly entries = new Map<string, Entry>();

  buildKey(input: {
    userId: string;
    currency: string;
    timezone: string;
    horizon: string;
    fingerprint: string;
  }): string {
    return [input.userId, input.currency, input.timezone, input.horizon, input.fingerprint].join(
      '|',
    );
  }

  get(key: string): AnalyticsForecastDto | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) {
      this.entries.delete(key);
      return undefined;
    }
    // Refresh insertion order so the oldest unused key is evicted first.
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  set(key: string, value: AnalyticsForecastDto): void {
    this.entries.delete(key);
    this.entries.set(key, { expiresAt: Date.now() + FORECAST_CACHE_TTL_MS, value });
    while (this.entries.size > FORECAST_CACHE_MAX_ENTRIES) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }

  clear(): void {
    this.entries.clear();
  }
}
