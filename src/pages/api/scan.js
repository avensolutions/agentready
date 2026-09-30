import { env } from 'cloudflare:workers';
import { createProviderFromEnv } from '../../lib/llm/index.js';
import { handleScan } from '../../lib/scan/handler.js';
import { createEventStream } from '../../lib/scan/sse.js';

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
  let provider;
  try {
    provider = createProviderFromEnv(/** @type {Record<string, string | undefined>} */ (env));
  } catch (err) {
    // misconfiguration is reported on the stream so the page shows a message
    const stream = createEventStream({ keepAliveMs: 0 });
    stream.send('error', { code: 'internal', message: 'The scan service is not configured. Please try again later.' });
    stream.close();
    console.error('scan provider configuration', err);
    return stream.response;
  }
  return handleScan(request, { provider });
}
