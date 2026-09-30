import { rubric } from '../rubric/index.js';
import { UrlError, normaliseTarget } from '../safety/url.js';
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
 * Accepts GET ?url= and POST with a JSON body { url }.
 */

/**
 * @typedef {Object} ReportStore
 * @property {(report: import('./run.js').Report & { id: string }) => Promise<void>} put
 */

/**
 * @param {Request} request
 * @param {Object} options
 * @param {import('../llm/index.js').LlmProvider} options.provider
 * @param {typeof fetch} [options.fetchImpl]
 * @param {ReportStore} [options.store]
 * @param {number} [options.timeoutMs]
 * @param {number} [options.keepAliveMs]
 * @param {() => Date} [options.now]
 * @returns {Promise<Response>}
 */
export async function handleScan(request, { provider, fetchImpl, store, timeoutMs = BUDGET.scanTimeoutMs, keepAliveMs, now = () => new Date() }) {
  const input = await readInput(request);
  const stream = createEventStream({ keepAliveMs });

  const run = async () => {
    const target = normaliseTarget(input);
    const id = await reportIdFor(target.url);
    stream.send('progress', { phase: 'start', step: 'start', label: 'Starting the scan...', status: 'start', url: target.url });
    const report = await runScan({
      url: target.url,
      provider,
      fetchImpl,
      signal: stream.signal,
      now,
      onProgress: (e) => stream.send('progress', e),
      onCheck: (r) => stream.send('check', { dimension: r.dimension, id: r.id, title: rubric.checkById.get(r.id)?.title ?? r.id, score: r.score }),
    });
    const stored = { ...report, id };
    if (store) await store.put(stored);
    stream.send('done', { id, url: report.url, overall: report.overall, band: report.band, scannedAt: report.scannedAt, cached: false });
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
  if (request.method === 'POST') {
    try {
      const body = await request.json();
      if (body && typeof body.url === 'string') input = body.url;
    } catch {
      // fall back to the query string
    }
  }
  return input;
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
