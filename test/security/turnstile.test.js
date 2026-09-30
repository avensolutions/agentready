import { describe, expect, it } from 'vitest';
import { clientIp, createRateLimiter } from '../../src/lib/security/ratelimit.js';
import { SITEVERIFY_URL, createTurnstileVerifier } from '../../src/lib/security/turnstile.js';

describe('createTurnstileVerifier', () => {
  it('posts the secret, token and ip to siteverify and reads the verdict', async () => {
    /** @type {Array<{ url: string, body: URLSearchParams }>} */
    const calls = [];
    /** @type {typeof fetch} */
    const impl = async (input, init) => {
      calls.push({ url: String(input), body: /** @type {URLSearchParams} */ (init?.body) });
      return Response.json({ success: true, hostname: 'agentready.theoverstorygroup.com' });
    };
    const verify = createTurnstileVerifier({ secret: 's3cret', fetchImpl: impl });
    const verdict = await verify('tok', '203.0.113.9');
    expect(verdict).toEqual({ ok: true, codes: [], hostname: 'agentready.theoverstorygroup.com' });
    expect(calls[0].url).toBe(SITEVERIFY_URL);
    expect(calls[0].body.get('secret')).toBe('s3cret');
    expect(calls[0].body.get('response')).toBe('tok');
    expect(calls[0].body.get('remoteip')).toBe('203.0.113.9');
  });

  it('rejects empty tokens without a request', async () => {
    let called = 0;
    const verify = createTurnstileVerifier({ secret: 's', fetchImpl: async () => (called += 1, Response.json({ success: true })) });
    expect(await verify('')).toEqual({ ok: false, codes: ['missing-input-response'] });
    expect(await verify('x'.repeat(5000))).toEqual({ ok: false, codes: ['missing-input-response'] });
    expect(called).toBe(0);
  });

  it('returns the error codes on failure and tolerates bad responses', async () => {
    const failing = createTurnstileVerifier({ secret: 's', fetchImpl: async () => Response.json({ success: false, 'error-codes': ['timeout-or-duplicate'] }) });
    expect(await failing('tok')).toMatchObject({ ok: false, codes: ['timeout-or-duplicate'] });
    const broken = createTurnstileVerifier({ secret: 's', fetchImpl: async () => new Response('oops', { status: 502 }) });
    expect(await broken('tok')).toMatchObject({ ok: false, codes: ['http-502'] });
    const down = createTurnstileVerifier({
      secret: 's',
      fetchImpl: async () => {
        throw new TypeError('fetch failed');
      },
    });
    expect(await down('tok')).toMatchObject({ ok: false, codes: ['network'] });
  });
});

describe('createRateLimiter', () => {
  it('allows everything without a binding and follows the binding verdict with one', async () => {
    expect(await createRateLimiter(undefined).allow('1.2.3.4')).toBe(true);
    /** @type {string[]} */
    const keys = [];
    const binding = { limit: async ({ key }) => (keys.push(key), { success: key !== 'blocked' }) };
    const limiter = createRateLimiter(binding);
    expect(await limiter.allow('ok')).toBe(true);
    expect(await limiter.allow('blocked')).toBe(false);
    expect(await limiter.allow('')).toBe(true);
    expect(keys).toEqual(['ok', 'blocked', 'unknown']);
  });

  it('fails open when the binding throws', async () => {
    const limiter = createRateLimiter({ limit: async () => { throw new Error('boom'); } });
    expect(await limiter.allow('x')).toBe(true);
  });
});

describe('clientIp', () => {
  it('prefers the Cloudflare header and falls back sensibly', () => {
    expect(clientIp(new Request('https://x.test/', { headers: { 'cf-connecting-ip': '203.0.113.9', 'x-forwarded-for': '10.0.0.1' } }))).toBe('203.0.113.9');
    expect(clientIp(new Request('https://x.test/', { headers: { 'x-forwarded-for': '198.51.100.7, 10.0.0.1' } }))).toBe('198.51.100.7');
    expect(clientIp(new Request('https://x.test/'))).toBe('unknown');
  });
});
