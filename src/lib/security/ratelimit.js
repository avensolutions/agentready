/**
 * Per-client rate limiting through the Workers Rate Limiting binding. The
 * binding counts per Cloudflare location and is eventually consistent, so
 * it is a brake rather than an accounting system; Turnstile is the main
 * gate and the LLM quota the hard ceiling. When the binding is absent
 * (local dev without it, tests) nothing is limited.
 */

/**
 * @typedef {Object} RateLimiter
 * @property {(key: string) => Promise<boolean>} allow  true when the request may proceed
 */

/**
 * @param {{ limit: (options: { key: string }) => Promise<{ success: boolean }> } | undefined} binding
 * @returns {RateLimiter}
 */
export function createRateLimiter(binding) {
  return {
    async allow(key) {
      if (!binding) return true;
      try {
        const { success } = await binding.limit({ key: key || 'unknown' });
        return success;
      } catch (err) {
        console.error('rate limit binding failed', err);
        return true;
      }
    },
  };
}

/**
 * The client address as Cloudflare reports it, or "unknown" locally.
 * @param {Request} request
 */
export function clientIp(request) {
  return request.headers.get('cf-connecting-ip') ?? request.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? 'unknown';
}
