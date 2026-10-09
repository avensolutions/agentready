import { describe, expect, it, vi } from 'vitest';
import { ALERT_COOLDOWN_MS, createLimitAlerter, withLimitAlerts } from '../../src/lib/llm/alerts.js';
import { LlmError, withRetry } from '../../src/lib/llm/index.js';

const VARS = {
  ALERT_EMAIL_ACCOUNT_ID: 'a'.repeat(32),
  ALERT_EMAIL_FROM: 'alerts@agentready.example.com',
  ALERT_EMAIL_TO: 'admin@example.com',
  ALERT_EMAIL_API_TOKEN: 'private-token',
};
const MODEL = 'gemini-test';
const quota = () => new LlmError('quota', 'private provider message', { quotaIds: ['RequestsPerDay-FreeTier'] });
const accepted = () => Response.json({ success: true, result: { queued: [VARS.ALERT_EMAIL_TO] } });

function setup() {
  const values = new Map();
  const kv = { get: vi.fn(async (key) => values.get(key) ?? null), put: vi.fn(async (key, value) => void values.set(key, value)) };
  const fetchImpl = vi.fn(async () => accepted());
  const log = vi.fn();
  let time = Date.parse('2026-10-09T00:00:00Z');
  const options = { vars: VARS, kv, fetchImpl, log, now: () => time };
  return { ...options, values, notify: createLimitAlerter(options), advance: (ms) => { time += ms; }, options };
}

describe('createLimitAlerter', () => {
  it('emails a quota alert without including provider messages or credentials in its content', async () => {
    const s = setup();
    await s.notify(quota(), MODEL);
    expect(s.fetchImpl).toHaveBeenCalledTimes(1);
    const [url, request] = s.fetchImpl.mock.calls[0];
    expect(url).toBe(`https://api.cloudflare.com/client/v4/accounts/${VARS.ALERT_EMAIL_ACCOUNT_ID}/email/sending/send`);
    expect(request.headers.authorization).toBe('Bearer private-token');
    expect(request.redirect).toBe('error');
    const body = JSON.parse(request.body);
    expect(body).toMatchObject({ to: VARS.ALERT_EMAIL_TO, from: VARS.ALERT_EMAIL_FROM, subject: 'agentready: Gemini daily quota reached' });
    expect(body.text).toContain('RequestsPerDay-FreeTier');
    expect(body.text).toContain(MODEL);
    expect(body.text).toContain('2026-10-09T00:00:00.000Z');
    expect(body.text).not.toMatch(/private-token|private provider message/);
    expect(s.kv.put).toHaveBeenCalledWith(`alert:gemini:${MODEL}:quota`, String(s.now() + ALERT_COOLDOWN_MS), { expirationTtl: 3600 });
    expect(s.log).toHaveBeenCalledWith({ status: 'accepted', kind: 'quota', model: MODEL });
  });

  it('suppresses concurrent alerts and repeats, including in a new isolate, until the cooldown ends', async () => {
    const s = setup();
    await Promise.all(Array.from({ length: 12 }, () => s.notify(quota(), MODEL)));
    expect(s.fetchImpl).toHaveBeenCalledTimes(1);
    expect(s.kv.get).toHaveBeenCalledTimes(1);
    await createLimitAlerter(s.options)(quota(), MODEL);
    expect(s.fetchImpl).toHaveBeenCalledTimes(1);
    s.advance(ALERT_COOLDOWN_MS);
    await s.notify(quota(), MODEL);
    expect(s.fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('keeps daily quota alerts separate from temporary limits and other models', async () => {
    const s = setup();
    await s.notify(new LlmError('rate-limit', 'busy'), MODEL);
    await s.notify(quota(), MODEL);
    await s.notify(quota(), 'another-model');
    expect(s.fetchImpl).toHaveBeenCalledTimes(3);
    expect(JSON.parse(s.fetchImpl.mock.calls[0][1].body).subject).toContain('rate limit reached');
  });

  it.each([
    () => Response.json({ success: false, errors: [{ message: 'private-token' }] }, { status: 429 }),
    () => Response.json({ success: true, result: { permanent_bounces: [VARS.ALERT_EMAIL_TO] } }),
    () => Response.json({ success: true, result: { suppressed_recipients: [VARS.ALERT_EMAIL_TO] } }),
    () => new Response('invalid JSON'),
    () => { throw new Error('private-token'); },
  ])('logs a failed send safely and allows a later event to retry without storing a success marker', async (failure) => {
    const s = setup();
    s.fetchImpl.mockImplementationOnce(failure);
    await expect(s.notify(quota(), MODEL)).resolves.toBeUndefined();
    expect(s.kv.put).not.toHaveBeenCalled();
    expect(s.log).toHaveBeenCalledWith({ status: 'failed', stage: 'email', kind: 'quota', model: MODEL });
    expect(JSON.stringify(s.log.mock.calls)).not.toContain('private-token');
    await s.notify(quota(), MODEL);
    expect(s.fetchImpl).toHaveBeenCalledTimes(1);
    s.advance(60_000);
    await s.notify(quota(), MODEL);
    expect(s.fetchImpl).toHaveBeenCalledTimes(2);
    expect(s.kv.put).toHaveBeenCalledTimes(1);
  });

  it('aborts a stalled email request', async () => {
    const s = setup();
    s.fetchImpl.mockImplementation((_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    }));
    await createLimitAlerter({ ...s.options, timeoutMs: 5 })(quota(), MODEL);
    expect(s.kv.put).not.toHaveBeenCalled();
    expect(s.log).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed', stage: 'email' }));
  });

  it('does not send when deduplication storage cannot be read', async () => {
    const s = setup();
    s.kv.get.mockRejectedValueOnce(new Error('KV down'));
    await s.notify(quota(), MODEL);
    expect(s.fetchImpl).not.toHaveBeenCalled();
    expect(s.log).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed', stage: 'dedup-read' }));
  });

  it('keeps the local cooldown if saving the marker fails after sending', async () => {
    const s = setup();
    s.kv.put.mockRejectedValueOnce(new Error('KV write limit'));
    await s.notify(quota(), MODEL);
    s.advance(60_000);
    await s.notify(quota(), MODEL);
    expect(s.fetchImpl).toHaveBeenCalledTimes(1);
    expect(s.log).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed', stage: 'dedup-write' }));
  });

  it('ignores unrelated errors and logs incomplete configuration without making requests', async () => {
    const s = setup();
    await s.notify(new LlmError('unavailable', 'down'), MODEL);
    expect(s.kv.get).not.toHaveBeenCalled();
    const notify = createLimitAlerter({ ...s.options, vars: { ...VARS, ALERT_EMAIL_API_TOKEN: '' } });
    await notify(quota(), MODEL);
    expect(s.fetchImpl).not.toHaveBeenCalled();
    expect(s.log).toHaveBeenCalledWith(expect.objectContaining({ status: 'unconfigured' }));
  });
});

describe('withLimitAlerts', () => {
  it('alerts on the first limit even when retry succeeds, without awaiting the email', async () => {
    const tasks = [];
    let complete;
    const notify = vi.fn(() => new Promise((resolve) => { complete = resolve; }));
    const generate = vi.fn().mockRejectedValueOnce(new LlmError('rate-limit', 'busy')).mockResolvedValue({ json: {} });
    const provider = withLimitAlerts({ name: 'gemini', model: MODEL, generate }, { notify, waitUntil: (task) => tasks.push(task) });
    expect(await withRetry(() => provider.generate({}), { sleep: async () => {} })).toEqual({ json: {} });
    expect(notify).toHaveBeenCalledTimes(1);
    expect(tasks).toHaveLength(1);
    complete();
    await Promise.all(tasks);
  });

  it('schedules at most one alert of each kind per scan and preserves the original error on email failure', async () => {
    const tasks = [];
    const error = quota();
    const notify = vi.fn().mockRejectedValue(new Error('email failed'));
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const generate = vi.fn().mockRejectedValue(error);
      const provider = withLimitAlerts({ name: 'gemini', model: MODEL, generate }, { notify, waitUntil: (task) => tasks.push(task) });
      await expect(provider.generate({})).rejects.toBe(error);
      await expect(provider.generate({})).rejects.toBe(error);
      generate.mockRejectedValueOnce(new LlmError('rate-limit', 'busy'));
      await expect(provider.generate({})).rejects.toMatchObject({ code: 'rate-limit' });
      await Promise.all(tasks);
      expect(tasks).toHaveLength(2);
      expect(notify).toHaveBeenCalledTimes(2);
    } finally {
      log.mockRestore();
    }
  });

  it('does not alert for other providers or other errors', async () => {
    const notify = vi.fn();
    const waitUntil = vi.fn();
    const mock = { name: 'mock', model: 'mock', generate: vi.fn() };
    expect(withLimitAlerts(mock, { notify, waitUntil })).toBe(mock);
    const provider = withLimitAlerts({ ...mock, name: 'gemini', generate: vi.fn().mockRejectedValue(new LlmError('network', 'down')) }, { notify, waitUntil });
    await expect(provider.generate({})).rejects.toMatchObject({ code: 'network' });
    expect(waitUntil).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });
});
