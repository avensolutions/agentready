import { env } from 'cloudflare:test';
import { describe, expect, it, vi } from 'vitest';
import { createLimitAlerter } from '../../src/lib/llm/alerts.js';
import { LlmError } from '../../src/lib/llm/errors.js';
import { createReportStore } from '../../src/lib/scan/store.js';

describe('alert cooldown in Workers KV', () => {
  it('persists the cooldown across alerter instances without creating a report', async () => {
    const kv = env.REPORTS;
    const recipient = 'admin@example.com';
    const fetchImpl = vi.fn(async () => Response.json({ success: true, result: { delivered: [recipient] } }));
    const options = {
      kv, fetchImpl, log: () => {},
      vars: {
        ALERT_EMAIL_ACCOUNT_ID: 'a'.repeat(32),
        ALERT_EMAIL_FROM: 'alerts@example.com',
        ALERT_EMAIL_TO: recipient,
        ALERT_EMAIL_API_TOKEN: 'test-token',
      },
    };
    const error = new LlmError('quota', 'day');
    await createLimitAlerter(options)(error, 'kv-test');
    await createLimitAlerter(options)(error, 'kv-test');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const key = 'alert:gemini:kv-test:quota';
    expect(Number(await kv.get(key))).toBeGreaterThan(Date.now());
    expect(await createReportStore(kv).get(key)).toBeNull();
  });
});
