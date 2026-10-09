import { env } from 'cloudflare:workers';
import { createProviderFromEnv } from '../../lib/llm/index.js';
import { createLimitAlerter, withLimitAlerts } from '../../lib/llm/alerts.js';
import { handleScan } from '../../lib/scan/handler.js';
import { createEventStream } from '../../lib/scan/sse.js';
import { createReportStore, ttlDaysFromEnv } from '../../lib/scan/store.js';
import { createRateLimiter } from '../../lib/security/ratelimit.js';
import { createTurnstileVerifier } from '../../lib/security/turnstile.js';

export const prerender = false;

/** @type {ReturnType<typeof createLimitAlerter> | undefined} */
let notifyLimit;

/** @type {import('astro').APIRoute} */
export async function GET({ request, locals }) {
  return scan(request, locals.cfContext);
}

/** @type {import('astro').APIRoute} */
export async function POST({ request, locals }) {
  return scan(request, locals.cfContext);
}

/** @param {Request} request @param {ExecutionContext} context */
async function scan(request, context) {
  const vars = /** @type {Record<string, string | undefined>} */ (/** @type {unknown} */ (env));
  const bindings = /** @type {Record<string, any>} */ (/** @type {unknown} */ (env));
  let provider;
  try {
    provider = createProviderFromEnv(vars);
    if (!vars.TURNSTILE_SECRET_KEY) throw new Error('TURNSTILE_SECRET_KEY is not set');
  } catch (err) {
    // misconfiguration is reported on the stream so the page shows a message
    const stream = createEventStream({ keepAliveMs: 0 });
    stream.send('error', { code: 'internal', message: 'The scan service is not configured. Please try again later.' });
    stream.close();
    console.error('scan configuration', err);
    return stream.response;
  }
  notifyLimit ??= createLimitAlerter({ vars, kv: bindings.REPORTS });
  return handleScan(request, {
    provider: withLimitAlerts(provider, { notify: notifyLimit, waitUntil: (task) => context.waitUntil(task) }),
    store: createReportStore(/** @type {KVNamespace} */ (bindings.REPORTS), { ttlDays: ttlDaysFromEnv(vars) }),
    limiter: createRateLimiter(bindings.SCAN_LIMITER),
    verifyTurnstile: createTurnstileVerifier({ secret: /** @type {string} */ (vars.TURNSTILE_SECRET_KEY) }),
  });
}
