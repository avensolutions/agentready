import { LlmError } from './errors.js';

export const ALERT_COOLDOWN_MS = 60 * 60 * 1000;
const FAILURE_COOLDOWN_MS = 60 * 1000;

/**
 * @param {import('./index.js').LlmProvider} provider
 * @param {{ notify: (error: LlmError, model: string) => Promise<void>, waitUntil: (task: Promise<void>) => void }} options
 * @returns {import('./index.js').LlmProvider}
 */
export function withLimitAlerts(provider, { notify, waitUntil }) {
  if (provider.name !== 'gemini') return provider;
  const seen = new Set();
  return {
    ...provider,
    async generate(request, options) {
      try {
        return await provider.generate(request, options);
      } catch (error) {
        if (isLimit(error) && !seen.has(error.code)) {
          seen.add(error.code);
          const task = Promise.resolve().then(() => notify(error, provider.model)).catch(() => {
            console.error('llm-alert', { status: 'background-failed' });
          });
          try {
            waitUntil(task);
          } catch {
            console.error('llm-alert', { status: 'scheduling-failed' });
          }
        }
        throw error;
      }
    },
  };
}

/**
 * Reuse one instance per Worker isolate. KV suppresses repeat alerts across isolates.
 * @param {Object} options
 * @param {Record<string, string | undefined>} options.vars
 * @param {Pick<KVNamespace, 'get' | 'put'>} options.kv
 * @param {typeof fetch} [options.fetchImpl]
 * @param {() => number} [options.now]
 * @param {number} [options.timeoutMs]
 * @param {(event: Record<string, unknown>) => void} [options.log]
 */
export function createLimitAlerter({ vars, kv, fetchImpl = globalThis.fetch, now = Date.now, timeoutMs = 5000, log = (event) => console.warn('llm-alert', event) }) {
  const account = vars.ALERT_EMAIL_ACCOUNT_ID ?? '';
  const from = vars.ALERT_EMAIL_FROM ?? '';
  const to = vars.ALERT_EMAIL_TO ?? '';
  const token = vars.ALERT_EMAIL_API_TOKEN;
  const email = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
  const configured = /^[a-f0-9]{32}$/i.test(account) && email.test(from) && email.test(to) && Boolean(token);
  const nextAllowed = new Map();

  /** @param {LlmError} error @param {string} model */
  return async function notify(error, model) {
    if (!isLimit(error)) return;
    const key = `alert:gemini:${encodeURIComponent(model)}:${error.code}`;
    if ((nextAllowed.get(key) ?? 0) > now()) return;
    nextAllowed.set(key, now() + FAILURE_COOLDOWN_MS);
    if (!configured) {
      log({ status: 'unconfigured', kind: error.code, model });
      return;
    }

    return send(error, model, key);
  };

  /** @param {LlmError} error @param {string} model @param {string} key */
  async function send(error, model, key) {
    let stage = 'dedup-read';
    try {
      const until = Number(await kv.get(key));
      if (Number.isFinite(until) && until > now()) {
        nextAllowed.set(key, until);
        return;
      }
      const reason = error.code === 'quota' ? 'daily quota reached' : 'rate limit reached';
      const quotaIds = Array.isArray(error.details.quotaIds)
        ? error.details.quotaIds.filter((id) => typeof id === 'string').slice(0, 8).map((id) => id.replace(/[^\w./:-]/g, '?').slice(0, 160))
        : [];
      stage = 'email';
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetchImpl(`https://api.cloudflare.com/client/v4/accounts/${account}/email/sending/send`, {
          method: 'POST',
          redirect: 'error',
          headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
            to,
            from,
            subject: `agentready: Gemini ${reason}`,
            text: [
              `Gemini ${reason}.`,
              `Model: ${model}`,
              `Time (UTC): ${new Date(now()).toISOString()}`,
              `Quota IDs: ${quotaIds.join(', ') || 'not supplied'}`,
              '',
              'A scan request was rejected by Gemini. A short-term limit may recover on retry.',
              'Check the project quota and usage: https://aistudio.google.com/rate-limit',
              'Repeat alerts for this model and limit type are suppressed for one hour.',
            ].join('\n'),
          }),
        });
        const body = await response.json();
        const accepted = [body?.result?.delivered, body?.result?.queued]
          .some((addresses) => Array.isArray(addresses) && addresses.some((address) => typeof address === 'string' && address.toLowerCase() === to.toLowerCase()));
        if (!response.ok || body?.success !== true || !accepted) throw new Error('Email was not accepted');
      } finally {
        clearTimeout(timer);
      }
      const untilNext = now() + ALERT_COOLDOWN_MS;
      nextAllowed.set(key, untilNext);
      stage = 'dedup-write';
      await kv.put(key, String(untilNext), { expirationTtl: ALERT_COOLDOWN_MS / 1000 });
      log({ status: 'accepted', kind: error.code, model });
    } catch {
      log({ status: 'failed', stage, kind: error.code, model });
    }
  }
}

/** @param {unknown} error @returns {error is LlmError} */
function isLimit(error) {
  return error instanceof LlmError && (error.code === 'quota' || error.code === 'rate-limit');
}
