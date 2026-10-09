/**
 * Cloudflare Turnstile server-side verification. One subrequest per scan.
 * Tokens live 300 seconds and can be verified once; the page resets the
 * widget after every attempt so a second scan gets a fresh token.
 */

export const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/** Documented test keys: always pass, work on any hostname including localhost. */
export const TEST_SITE_KEY = '1x00000000000000000000AA';
export const TEST_SECRET_KEY = '1x0000000000000000000000000000000AA';

/**
 * @typedef {Object} TurnstileResult
 * @property {boolean} ok
 * @property {string[]} codes  Turnstile error codes when not ok
 * @property {string} [hostname]
 */

/**
 * @param {Object} options
 * @param {string} options.secret
 * @param {typeof fetch} [options.fetchImpl]
 * @param {number} [options.timeoutMs]
 * @returns {(token: string, ip?: string) => Promise<TurnstileResult>}
 */
export function createTurnstileVerifier({ secret, fetchImpl = globalThis.fetch, timeoutMs = 8000 }) {
  return async function verify(token, ip) {
    if (typeof token !== 'string' || token.trim() === '' || token.length > 4096) {
      return { ok: false, codes: ['missing-input-response'] };
    }
    const body = new URLSearchParams({ secret, response: token });
    if (ip) body.set('remoteip', ip);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetchImpl(SITEVERIFY_URL, { method: 'POST', body, signal: controller.signal });
      /** @type {any} */
      const data = await res.json().catch(() => ({}));
      const ok = res.ok && data?.success === true;
      return { ok, codes: ok ? [] : (Array.isArray(data?.['error-codes']) ? data['error-codes'].map(String) : [`http-${res.status}`]), hostname: data?.hostname };
    } catch (err) {
      return { ok: false, codes: [controller.signal.aborted ? 'timeout' : 'network'] };
    } finally {
      clearTimeout(timer);
    }
  };
}
