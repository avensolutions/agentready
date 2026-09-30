import { env } from 'cloudflare:workers';
import { createProviderFromEnv } from '../../lib/llm/index.js';
import { handleScan } from '../../lib/scan/handler.js';
import { createEventStream } from '../../lib/scan/sse.js';
import { createReportStore, ttlDaysFromEnv } from '../../lib/scan/store.js';

export const prerender = false;

/** @type {import('astro').APIRoute} */
export async function GET({ request }) {
  return scan(request);
}

/** @type {import('astro').APIRoute} */
export async function POST({ request }) {
  return scan(request);
}

/** @param {Request} request */
async function scan(request) {
  const vars = /** @type {Record<string, string | undefined>} */ (/** @type {unknown} */ (env));
  let provider;
  try {
    provider = createProviderFromEnv(vars);
  } catch (err) {
    // misconfiguration is reported on the stream so the page shows a message
    const stream = createEventStream({ keepAliveMs: 0 });
    stream.send('error', { code: 'internal', message: 'The scan service is not configured. Please try again later.' });
    stream.close();
    console.error('scan provider configuration', err);
    return stream.response;
  }
  const store = createReportStore(/** @type {KVNamespace} */ (/** @type {unknown} */ (env.REPORTS)), { ttlDays: ttlDaysFromEnv(vars) });
  return handleScan(request, { provider, store });
}
