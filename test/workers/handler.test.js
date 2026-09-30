import { describe, expect, it } from 'vitest';
import { LlmError, createMockProvider } from '../../src/lib/llm/index.js';
import { rubric, rubricHash } from '../../src/lib/rubric/index.js';
import { errorPayload, handleScan } from '../../src/lib/scan/handler.js';
import { reportIdFor } from '../../src/lib/scan/report-id.js';
import { parseEventStream } from '../../src/lib/scan/sse.js';

const ORIGIN = 'https://acme.example.com';
const HTML = '<!doctype html><html><head><title>Acme</title></head><body><main><h1>Acme</h1><p>Widgets.</p><a href="/about">About</a></main></body></html>';

/** @type {typeof fetch} */
const site = async (input) => {
  const url = String(input);
  if (url === `${ORIGIN}/` || url === `${ORIGIN}/about`) return new Response(HTML, { headers: { 'content-type': 'text/html' } });
  return new Response('nope', { status: 404, headers: { 'content-type': 'text/html' } });
};

/** @param {Request} request @param {Partial<Parameters<typeof handleScan>[1]>} [opts] */
async function run(request, opts = {}) {
  const response = await handleScan(request, { provider: createMockProvider(), fetchImpl: site, keepAliveMs: 0, ...opts });
  expect(response.headers.get('content-type')).toContain('text/event-stream');
  return parseEventStream(await response.text());
}

describe('handleScan', () => {
  it('streams progress, one check event per check, and done with a stable id', async () => {
    /** @type {any[]} */
    const stored = [];
    const events = await run(new Request(`https://axcheck.test/api/scan?url=${encodeURIComponent('acme.example.com')}`), { store: { get: async () => null, put: async (r) => void stored.push(r) } });
    const names = events.map((e) => e.event);
    expect(names[0]).toBe('progress');
    expect(names[names.length - 1]).toBe('done');
    expect(events.filter((e) => e.event === 'check').map((e) => /** @type {any} */ (e.data).id)).toEqual(rubric.checks.map((c) => c.id));
    expect(events.filter((e) => e.event === 'error')).toEqual([]);

    const first = /** @type {any} */ (events[0].data);
    expect(first).toMatchObject({ phase: 'start', label: 'Starting the scan...', url: `${ORIGIN}/` });
    const assess = /** @type {any} */ (events.find((e) => e.event === 'progress' && e.data.phase === 'assess')?.data);
    expect(assess.checks[0]).toEqual({ id: 'robots-ai-access', label: 'Checking robots.txt rules for AI agents...' });
    const check = /** @type {any} */ (events.find((e) => e.event === 'check')?.data);
    expect(check).toMatchObject({ dimension: 'discovery', id: 'robots-ai-access', title: 'robots.txt rules for AI agents' });
    expect(typeof check.score).toBe('number');

    const done = /** @type {any} */ (events[events.length - 1].data);
    expect(done.id).toBe(await reportIdFor(`${ORIGIN}/`));
    expect(done).toMatchObject({ url: `${ORIGIN}/`, cached: false });
    expect(typeof done.overall).toBe('number');
    expect(stored.length).toBe(1);
    expect(stored[0].id).toBe(done.id);
    expect(stored[0].dimensions.length).toBe(rubric.dimensions.length);
  });

  it('serves a fresh stored report without scanning, and rescans a stale one', async () => {
    const id = await reportIdFor(`${ORIGIN}/`);
    let fetched = 0;
    /** @type {typeof fetch} */
    const counting = async (input, init) => {
      fetched += 1;
      return site(input, init);
    };
    /** @type {any[]} */
    const puts = [];
    const now = () => new Date('2026-09-30T12:00:00.000Z');
    const fresh = { id, version: 1, url: `${ORIGIN}/`, scannedAt: '2026-09-29T12:00:00.000Z', rubricHash: await rubricHash(), overall: 61, band: { id: 'fair', label: 'Fair' }, dimensions: [], stats: {} };
    const store = { ttlDays: 7, get: async () => fresh, put: async (r) => void puts.push(r) };

    const events = await run(new Request(`https://axcheck.test/api/scan?url=${ORIGIN}/`), { fetchImpl: counting, store, now });
    expect(events.map((e) => e.event)).toEqual(['progress', 'done']);
    expect(events[1].data).toMatchObject({ id, overall: 61, cached: true, scannedAt: '2026-09-29T12:00:00.000Z' });
    expect(fetched).toBe(0);
    expect(puts).toEqual([]);

    // stale: scored against a different rubric
    const stale = { ...store, get: async () => ({ ...fresh, rubricHash: 'old' }) };
    const again = await run(new Request(`https://axcheck.test/api/scan?url=${ORIGIN}/`), { fetchImpl: counting, store: stale, now });
    expect(again[again.length - 1]).toMatchObject({ event: 'done', data: { id, cached: false } });
    expect(fetched).toBeGreaterThan(0);
    expect(puts.length).toBe(1);
  });

  it('accepts a POST body', async () => {
    const events = await run(new Request('https://axcheck.test/api/scan', { method: 'POST', body: JSON.stringify({ url: `${ORIGIN}/` }), headers: { 'content-type': 'application/json' } }));
    expect(events[events.length - 1].event).toBe('done');
  });

  it('reports an invalid address as an error event without fetching', async () => {
    let fetched = 0;
    const events = await run(new Request('https://axcheck.test/api/scan?url=http://127.0.0.1/'), { fetchImpl: async () => (fetched += 1, new Response('')) });
    expect(events).toEqual([{ event: 'error', data: { code: 'invalid-url', reason: 'ip', message: 'IP addresses cannot be checked. Use the site name.' } }]);
    expect(fetched).toBe(0);
    const empty = await run(new Request('https://axcheck.test/api/scan'));
    expect(empty[0]).toMatchObject({ event: 'error', data: { code: 'invalid-url' } });
  });

  it('reports pipeline failures with their code and message', async () => {
    const down = await run(new Request(`https://axcheck.test/api/scan?url=${ORIGIN}/`), {
      fetchImpl: async () => {
        throw new TypeError('ENOTFOUND');
      },
    });
    expect(down[down.length - 1]).toMatchObject({ event: 'error', data: { code: 'unreachable' } });

    /** @type {import('../../src/lib/llm/index.js').LlmProvider} */
    const exhausted = { name: 'x', model: 'x', async generate() { throw new LlmError('quota', 'day'); } };
    const quota = await run(new Request(`https://axcheck.test/api/scan?url=${ORIGIN}/`), { provider: exhausted });
    expect(quota[quota.length - 1]).toMatchObject({ event: 'error', data: { code: 'llm-quota' } });
    expect(quota.some((e) => e.event === 'progress' && /** @type {any} */ (e.data).phase === 'collect')).toBe(true);
  });

  it('applies the rate limiter before anything else', async () => {
    let fetched = 0;
    let verified = 0;
    const events = await run(new Request(`https://axcheck.test/api/scan?url=${ORIGIN}/`, { headers: { 'cf-connecting-ip': '203.0.113.9' } }), {
      fetchImpl: async () => (fetched += 1, new Response('')),
      limiter: { allow: async (key) => (expect(key).toBe('203.0.113.9'), false) },
      verifyTurnstile: async () => (verified += 1, { ok: true, codes: [] }),
    });
    expect(events).toEqual([{ event: 'error', data: { code: 'rate-limited', message: expect.stringContaining('Too many checks') } }]);
    expect(fetched).toBe(0);
    expect(verified).toBe(0);
  });

  it('requires a passing Turnstile token, passed from the query or the body with the client ip', async () => {
    /** @type {any[]} */
    const seen = [];
    const verifier = async (token, ip) => (seen.push([token, ip]), { ok: token === 'good', codes: token === 'good' ? [] : ['invalid-input-response'] });
    const bad = await run(new Request(`https://axcheck.test/api/scan?url=${ORIGIN}/&token=bad`), { verifyTurnstile: verifier });
    expect(bad).toEqual([{ event: 'error', data: { code: 'turnstile', message: expect.stringContaining('security check') } }]);
    const good = await run(new Request('https://axcheck.test/api/scan', { method: 'POST', body: JSON.stringify({ url: `${ORIGIN}/`, token: 'good' }), headers: { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.9' } }), { verifyTurnstile: verifier });
    expect(good[good.length - 1].event).toBe('done');
    expect(seen).toEqual([['bad', undefined], ['good', '203.0.113.9']]);
  });

  it('validates the address before spending a Turnstile verification', async () => {
    let verified = 0;
    const events = await run(new Request('https://axcheck.test/api/scan?url=ftp://x.example.com/&token=t'), { verifyTurnstile: async () => (verified += 1, { ok: true, codes: [] }) });
    expect(events[0]).toMatchObject({ event: 'error', data: { code: 'invalid-url' } });
    expect(verified).toBe(0);
  });

  it('times out a scan that runs too long', async () => {
    const slow = createMockProvider({ delayMs: 200 });
    const events = await run(new Request(`https://axcheck.test/api/scan?url=${ORIGIN}/`), { provider: slow, timeoutMs: 100 });
    expect(events[events.length - 1]).toMatchObject({ event: 'error', data: { code: 'timeout' } });
  });

  it('does not leak internals for unknown errors', () => {
    expect(errorPayload(new Error('secret stack'))).toEqual({ code: 'internal', message: 'The scan failed unexpectedly. Please try again.' });
  });
});
