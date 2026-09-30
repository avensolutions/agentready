import { LlmError } from './errors.js';
import { createGeminiProvider } from './gemini.js';
import { createMockProvider } from './mock.js';

/**
 * Provider-neutral interface. The scan only ever calls `generate` with a
 * system instruction, a prompt and a JSON schema, and gets parsed JSON back.
 *
 * @typedef {Object} LlmRequest
 * @property {string} system
 * @property {string} prompt
 * @property {Record<string, unknown>} schema  JSON Schema the response must satisfy
 * @property {number} [maxOutputTokens]
 *
 * @typedef {Object} LlmUsage
 * @property {number} input
 * @property {number} output
 * @property {number} thoughts
 *
 * @typedef {Object} LlmResponse
 * @property {unknown} json  the parsed response
 * @property {LlmUsage} usage
 * @property {string} model
 *
 * @typedef {Object} LlmProvider
 * @property {string} name
 * @property {string} model
 * @property {(request: LlmRequest, options?: { signal?: AbortSignal }) => Promise<LlmResponse>} generate
 */

/**
 * Pick a provider from the Worker environment.
 * - LLM_PROVIDER=mock gives deterministic results without a key (local dev, tests)
 * - otherwise Gemini, with GEMINI_MODEL and the GEMINI_API_KEY secret
 *
 * @param {Record<string, string | undefined>} env
 * @param {{ fetchImpl?: typeof fetch }} [options]
 * @returns {LlmProvider}
 */
export function createProviderFromEnv(env, { fetchImpl } = {}) {
  const which = (env.LLM_PROVIDER ?? 'gemini').toLowerCase();
  if (which === 'mock') return createMockProvider();
  if (which !== 'gemini') throw new LlmError('config', `Unknown LLM_PROVIDER "${which}".`);
  if (!env.GEMINI_API_KEY) throw new LlmError('config', 'GEMINI_API_KEY is not set.');
  if (!env.GEMINI_MODEL) throw new LlmError('config', 'GEMINI_MODEL is not set.');
  return createGeminiProvider({ apiKey: env.GEMINI_API_KEY, model: env.GEMINI_MODEL, thinkingLevel: env.GEMINI_THINKING_LEVEL, fetchImpl });
}

/**
 * Retry a call on retryable LlmErrors with exponential backoff and jitter,
 * honouring a provider-supplied delay when it is short.
 *
 * @template T
 * @param {() => Promise<T>} fn
 * @param {Object} [options]
 * @param {number} [options.attempts]  total attempts including the first
 * @param {number} [options.baseMs]
 * @param {number} [options.maxDelayMs]
 * @param {(ms: number) => Promise<void>} [options.sleep]
 * @param {() => number} [options.random]
 * @param {(attempt: number, error: LlmError) => void} [options.onRetry]
 * @returns {Promise<T>}
 */
export async function withRetry(fn, { attempts = 3, baseMs = 1000, maxDelayMs = 15_000, sleep = defaultSleep, random = Math.random, onRetry } = {}) {
  let attempt = 0;
  for (;;) {
    attempt += 1;
    try {
      return await fn();
    } catch (err) {
      if (!(err instanceof LlmError) || !err.retryable || attempt >= attempts) throw err;
      const hinted = typeof err.details.retryAfterMs === 'number' ? err.details.retryAfterMs : 0;
      const backoff = baseMs * 2 ** (attempt - 1) * (0.5 + random());
      const delay = Math.min(maxDelayMs, Math.max(backoff, hinted));
      onRetry?.(attempt, err);
      await sleep(delay);
    }
  }
}

/** @param {number} ms */
function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export { LlmError } from './errors.js';
export { createGeminiProvider } from './gemini.js';
export { createMockProvider } from './mock.js';
