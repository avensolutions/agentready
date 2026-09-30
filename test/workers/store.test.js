import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { REPORT_VERSION } from '../../src/lib/scan/run.js';
import { DEFAULT_TTL_DAYS, createReportStore, isFresh, ttlDaysFromEnv } from '../../src/lib/scan/store.js';

/** @param {Partial<import('../../src/lib/scan/store.js').StoredReport>} [overrides] */
function report(overrides = {}) {
  return /** @type {import('../../src/lib/scan/store.js').StoredReport} */ ({
    id: '0123456789abcdef',
    version: REPORT_VERSION,
    url: 'https://acme.example.com/',
    scannedAt: '2026-09-30T00:00:00.000Z',
    rubricHash: 'abc',
    model: 'mock-1',
    overall: 50,
    band: { id: 'fair', label: 'Fair' },
    dimensions: [],
    stats: { fetches: 1, llmCalls: 1, tokens: { input: 0, output: 0, thoughts: 0 }, elapsedMs: 1, sampledPages: [], problems: [] },
    ...overrides,
  });
}

describe('createReportStore', () => {
  it('round-trips a report through the REPORTS namespace', async () => {
    const kv = /** @type {KVNamespace} */ (env.REPORTS);
    const store = createReportStore(kv, { ttlDays: 3 });
    expect(store.ttlDays).toBe(3);
    await store.put(report());
    expect(await store.get('0123456789abcdef')).toEqual(report());
  });

  it('writes with an expiration TTL of the configured days and never below one day', async () => {
    /** @type {any[]} */
    const puts = [];
    const fake = /** @type {KVNamespace} */ (/** @type {unknown} */ ({ put: async (...args) => void puts.push(args), get: async () => null }));
    await createReportStore(fake, { ttlDays: 3 }).put(report());
    await createReportStore(fake, { ttlDays: 0.2 }).put(report());
    expect(puts[0][0]).toBe('0123456789abcdef');
    expect(JSON.parse(puts[0][1])).toEqual(report());
    expect(puts[0][2]).toEqual({ expirationTtl: 3 * 86_400 });
    expect(puts[1][2]).toEqual({ expirationTtl: 86_400 });
  });

  it('returns null for unknown ids and non-report values', async () => {
    const kv = /** @type {KVNamespace} */ (env.REPORTS);
    const store = createReportStore(kv);
    expect(await store.get('ffffffffffffffff')).toBeNull();
    await kv.put('eeeeeeeeeeeeeeee', JSON.stringify({ not: 'a report' }));
    expect(await store.get('eeeeeeeeeeeeeeee')).toBeNull();
  });
});

describe('isFresh', () => {
  const now = new Date('2026-10-03T00:00:00.000Z');
  const opts = { rubricHash: 'abc', ttlDays: 7, now };

  it('accepts a report inside the TTL with the current rubric and format', () => {
    expect(isFresh(report(), opts)).toBe(true);
  });

  it('rejects missing, expired, future, re-rubriced or old-format reports', () => {
    expect(isFresh(null, opts)).toBe(false);
    expect(isFresh(report(), { ...opts, ttlDays: 2 })).toBe(false);
    expect(isFresh(report({ scannedAt: '2026-10-04T00:00:00.000Z' }), opts)).toBe(false);
    expect(isFresh(report({ scannedAt: 'garbage' }), opts)).toBe(false);
    expect(isFresh(report(), { ...opts, rubricHash: 'changed' })).toBe(false);
    expect(isFresh(report({ version: REPORT_VERSION + 1 }), opts)).toBe(false);
  });
});

describe('ttlDaysFromEnv', () => {
  it('reads a positive whole number of days and falls back to the default', () => {
    expect(ttlDaysFromEnv({ REPORT_TTL_DAYS: '14' })).toBe(14);
    expect(ttlDaysFromEnv({ REPORT_TTL_DAYS: '2.9' })).toBe(2);
    expect(ttlDaysFromEnv({ REPORT_TTL_DAYS: '0' })).toBe(DEFAULT_TTL_DAYS);
    expect(ttlDaysFromEnv({ REPORT_TTL_DAYS: 'week' })).toBe(DEFAULT_TTL_DAYS);
    expect(ttlDaysFromEnv({})).toBe(DEFAULT_TTL_DAYS);
  });
});
