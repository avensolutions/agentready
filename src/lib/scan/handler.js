import { rubric } from '../rubric/index.js';
import { UrlError, normaliseTarget } from '../safety/url.js';
import { clientIp } from '../security/ratelimit.js';
import { BUDGET } from './budget.js';
import { ScanError } from './errors.js';
import { reportIdFor } from './report-id.js';
import { runScan } from './run.js';
import { createEventStream } from './sse.js';

/**
 * The scan request handler behind /api/scan. Always answers with an event
 * stream so the page has one code path: `progress` and `check` events while
 * the pipeline runs, then `done` with the report id or `error` with a code
 * and a user-facing message.
 *
 * Accepts GET ?url=&type=&token= and POST with a JSON body { url, type, token },
 * where type is a site type id from the rubric (the default type when absent).
 *
 * Guards run in cost order before any work: the rate limiter (no
 * subrequest), URL validation, then Turnstile (one subrequest), then the
 * scan. Every scan is live. A stored report is never served in place of a
 * new scan, so the result describes the site as it is now, not as it was.
 * The store only keeps the finished report for the shareable report page,
 * and a new scan of the same address replaces it.
 */

/**
 * @typedef {Object} ReportStore
 * @property {(id: string) => Promise<import('./store.js').StoredReport | null>} get
 * @property {(report: import('./store.js').StoredReport) => Promise<void>} put
 */

/**
 * @param {Request} request
 * @param {Object} options
 * @param {import('../llm/index.js').LlmProvider} options.provider
 * @param {typeof fetch} [options.fetchImpl]
 * @param {ReportStore} [options.store]
 * @param {import('../security/ratelimit.js').RateLimiter} [options.limiter]
 * @param {(token: string, ip?: string) => Promise<import('../security/turnstile.js').TurnstileResult>} [options.verifyTurnstile]
 * @param {number} [options.timeoutMs]
 * @param {number} [options.keepAliveMs]
 * @param {() => Date} [options.now]
 * @returns {Promise<Response>}
 */
export async function handleScan(request, { provider, fetchImpl, store, limiter, verifyTurnstile, timeoutMs = BUDGET.scanTimeoutMs, keepAliveMs, now = () => new Date() }) {
  const { url: input, token, type } = await readInput(request);
  const ip = clientIp(request);
  const stream = createEventStream({ keepAliveMs });

  const run = async () => {
    if (limiter && !(await limiter.allow(ip))) {
      throw new ScanError('rate-limited', 'Too many checks from your connection in the last minute. Please wait a minute and try again.');
    }
    const target = normaliseTarget(input);
    const siteType = type === '' ? rubric.defaultSiteType : rubric.siteTypeById.get(type);
    if (!siteType) {
      throw new ScanError('invalid-type', 'Choose one of the listed kinds of site and try again.', { type });
    }
    if (verifyTurnstile) {
      const verdict = await verifyTurnstile(token, ip === 'unknown' ? undefined : ip);
      if (!verdict.ok) {
        throw new ScanError('turnstile', 'The security check did not pass. Reload the page and try again.', { codes: verdict.codes });
      }
    }
    const id = await reportIdFor(target.url, siteType.id);
    stream.send('progress', { phase: 'start', step: 'start', label: 'Starting the scan...', status: 'start', url: target.url, siteType: siteType.id });

    const report = await runScan({
      url: target.url,
      provider,
      fetchImpl,
      signal: stream.signal,
      now,
      siteType: siteType.id,
      onProgress: (e) => stream.send('progress', e),
      onCheck: (r) => stream.send('check', { dimension: r.dimension, id: r.id, title: rubric.checkById.get(r.id)?.title ?? r.id, score: r.score }),
    });
    const stored = { ...report, id };
    if (store) await store.put(stored);
    stream.send('done', { id, url: report.url, overall: report.overall, band: report.band, scannedAt: report.scannedAt });
  };

  // not awaited: the response streams while the scan runs
  withTimeout(run(), timeoutMs)
    .catch((err) => {
      if (!stream.closed) stream.send('error', errorPayload(err));
    })
    .finally(() => stream.close());

  return stream.response;
}

/** @param {Request} request */
async function readInput(request) {
  const url = new URL(request.url);
  let input = url.searchParams.get('url') ?? '';
  let token = url.searchParams.get('token') ?? '';
  let type = url.searchParams.get('type') ?? '';
  if (request.method === 'POST') {
    try {
      const body = await request.json();
      if (body && typeof body.url === 'string') input = body.url;
      if (body && typeof body.token === 'string') token = body.token;
      if (body && typeof body.type === 'string') type = body.type;
    } catch {
      // fall back to the query string
    }
  }
  return { url: input, token, type: type.trim() };
}

/**
 * @template T
 * @param {Promise<T>} promise
 * @param {number} ms
 */
function withTimeout(promise, ms) {
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let timer;
  const timeout = new Promise((_resolve, reject) => {
    timer = setTimeout(() => reject(new ScanError('timeout', `The scan did not finish within ${Math.round(ms / 1000)} seconds.`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Shape any failure into { code, message } without leaking internals.
 * @param {unknown} err
 */
export function errorPayload(err) {
  if (err instanceof UrlError) return { code: 'invalid-url', reason: err.code, message: err.message };
  if (err instanceof ScanError) return { code: err.code, message: err.message, ...(err.details.status ? { status: err.details.status } : {}) };
  return { code: 'internal', message: 'The scan failed unexpectedly. Please try again.' };
}
