import { describe, expect, it } from 'vitest';
import { LlmError, createGeminiProvider, createProviderFromEnv, withRetry } from '../../src/lib/llm/index.js';

const SCHEMA = { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'] };
const REQUEST = { system: 'sys', prompt: 'hello', schema: SCHEMA };

/** @param {Array<(body: any) => Response>} responders */
function fakeGemini(responders) {
  /** @type {Array<{ url: string, headers: Headers, body: any }>} */
  const calls = [];
  /** @type {typeof fetch} */
  const impl = async (input, init = {}) => {
    const body = JSON.parse(String(init.body));
    calls.push({ url: String(input), headers: new Headers(init.headers), body });
    const responder = responders[Math.min(calls.length - 1, responders.length - 1)];
    return responder(body);
  };
  return { impl, calls };
}

const success = (/** @type {unknown} */ json, extra = {}) => () =>
  Response.json({
    candidates: [{ content: { parts: [{ text: JSON.stringify(json) }] }, finishReason: 'STOP' }],
    usageMetadata: { promptTokenCount: 120, candidatesTokenCount: 30, thoughtsTokenCount: 5 },
    modelVersion: 'gemini-3.5-flash-lite-001',
    ...extra,
  });

describe('createGeminiProvider', () => {
  it('sends the documented request shape and parses the result', async () => {
    const api = fakeGemini([success({ ok: true })]);
    const provider = createGeminiProvider({ apiKey: 'k', model: 'gemini-3.5-flash-lite', fetchImpl: api.impl });
    const res = await provider.generate(REQUEST);

    expect(res.json).toEqual({ ok: true });
    expect(res.usage).toEqual({ input: 120, output: 30, thoughts: 5 });
    expect(res.model).toBe('gemini-3.5-flash-lite-001');

    const call = api.calls[0];
    expect(call.url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent');
    expect(call.headers.get('x-goog-api-key')).toBe('k');
    expect(call.url).not.toContain('key=');
    expect(call.body.systemInstruction).toEqual({ parts: [{ text: 'sys' }] });
    expect(call.body.contents).toEqual([{ role: 'user', parts: [{ text: 'hello' }] }]);
    expect(call.body.generationConfig).toEqual({
      maxOutputTokens: 4096,
      thinkingConfig: { thinkingLevel: 'minimal' },
      responseFormat: { text: { mimeType: 'application/json', schema: SCHEMA } },
    });
    expect(call.body.generationConfig.temperature).toBeUndefined();
  });

  it('uses low thinking for non-lite models and honours an explicit level', () => {
    const api = fakeGemini([success({})]);
    const flash = createGeminiProvider({ apiKey: 'k', model: 'gemini-3.8-flash', fetchImpl: api.impl });
    const explicit = createGeminiProvider({ apiKey: 'k', model: 'gemini-3.8-flash', thinkingLevel: 'HIGH', fetchImpl: api.impl });
    return Promise.all([flash.generate(REQUEST), explicit.generate(REQUEST)]).then(() => {
      expect(api.calls[0].body.generationConfig.thinkingConfig.thinkingLevel).toBe('low');
      expect(api.calls[1].body.generationConfig.thinkingConfig.thinkingLevel).toBe('high');
    });
  });

  it('falls back to the legacy structured output fields when the API rejects responseFormat', async () => {
    const api = fakeGemini([
      () => Response.json({ error: { code: 400, message: 'Invalid JSON payload received. Unknown name "responseFormat"', status: 'INVALID_ARGUMENT' } }, { status: 400 }),
      success({ ok: true }),
    ]);
    const provider = createGeminiProvider({ apiKey: 'k', model: 'gemini-3.5-flash-lite', fetchImpl: api.impl });
    await expect(provider.generate(REQUEST)).rejects.toMatchObject({ code: 'malformed', details: { switched: true } });
    const res = await provider.generate(REQUEST);
    expect(res.json).toEqual({ ok: true });
    expect(api.calls[1].body.generationConfig.responseFormat).toBeUndefined();
    expect(api.calls[1].body.generationConfig.responseMimeType).toBe('application/json');
    expect(api.calls[1].body.generationConfig.responseJsonSchema).toEqual(SCHEMA);
  });

  it('classifies a per-day 429 as quota and a per-minute 429 as a retryable rate limit', async () => {
    const quota = () =>
      Response.json(
        { error: { code: 429, message: 'You exceeded your current quota', status: 'RESOURCE_EXHAUSTED', details: [{ '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [{ quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier' }] }] } },
        { status: 429 },
      );
    const minute = () =>
      Response.json(
        {
          error: {
            code: 429,
            message: 'Resource has been exhausted',
            details: [
              { '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [{ quotaId: 'GenerateRequestsPerMinutePerProjectPerModel-FreeTier' }] },
              { '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '7s' },
            ],
          },
        },
        { status: 429 },
      );
    const p1 = createGeminiProvider({ apiKey: 'k', model: 'm', fetchImpl: fakeGemini([quota]).impl });
    const p2 = createGeminiProvider({ apiKey: 'k', model: 'm', fetchImpl: fakeGemini([minute]).impl });
    const e1 = await p1.generate(REQUEST).catch((e) => e);
    const e2 = await p2.generate(REQUEST).catch((e) => e);
    expect(e1).toBeInstanceOf(LlmError);
    expect(e1.code).toBe('quota');
    expect(e1.retryable).toBe(false);
    expect(e2.code).toBe('rate-limit');
    expect(e2.retryable).toBe(true);
    expect(e2.details.retryAfterMs).toBe(7000);
  });

  it('maps other failures to codes', async () => {
    const cases = [
      [() => new Response('overloaded', { status: 503 }), 'unavailable'],
      [() => Response.json({ error: { message: 'API key not valid' } }, { status: 403 }), 'config'],
      [() => Response.json({ error: { message: 'bad field' } }, { status: 400 }), 'request'],
      [() => Response.json({ promptFeedback: { blockReason: 'SAFETY' } }), 'blocked'],
      [() => Response.json({ candidates: [{ content: { parts: [{ text: '{' }] }, finishReason: 'MAX_TOKENS' }] }), 'unfinished'],
      [() => Response.json({ candidates: [{ content: { parts: [{ text: 'not json' }] }, finishReason: 'STOP' }] }), 'malformed'],
      [() => new Response('<html>', { status: 200 }), 'malformed'],
    ];
    for (const [responder, code] of cases) {
      const provider = createGeminiProvider({ apiKey: 'k', model: 'm', fetchImpl: fakeGemini([responder]).impl });
      const err = await provider.generate(REQUEST).catch((e) => e);
      expect(err, code).toBeInstanceOf(LlmError);
      expect(err.code).toBe(code);
    }
  });

  it('strips code fences and ignores thought parts', async () => {
    const api = fakeGemini([
      () => Response.json({ candidates: [{ content: { parts: [{ text: 'thinking...', thought: true }, { text: '```json\n{"ok":false}\n```' }] }, finishReason: 'STOP' }] }),
    ]);
    const provider = createGeminiProvider({ apiKey: 'k', model: 'm', fetchImpl: api.impl });
    expect((await provider.generate(REQUEST)).json).toEqual({ ok: false });
  });

  it('reports a network failure or timeout without throwing raw errors', async () => {
    const provider = createGeminiProvider({
      apiKey: 'k',
      model: 'm',
      fetchImpl: async () => {
        throw new TypeError('fetch failed');
      },
    });
    const err = await provider.generate(REQUEST).catch((e) => e);
    expect(err.code).toBe('network');
    expect(err.retryable).toBe(true);
  });
});

describe('createProviderFromEnv', () => {
  it('returns the mock provider or a configured Gemini provider, and rejects bad config', () => {
    expect(createProviderFromEnv({ LLM_PROVIDER: 'mock' }).name).toBe('mock');
    expect(createProviderFromEnv({ GEMINI_API_KEY: 'k', GEMINI_MODEL: 'gemini-3.5-flash-lite' }).model).toBe('gemini-3.5-flash-lite');
    expect(() => createProviderFromEnv({ GEMINI_MODEL: 'm' })).toThrow(/GEMINI_API_KEY/);
    expect(() => createProviderFromEnv({ GEMINI_API_KEY: 'k' })).toThrow(/GEMINI_MODEL/);
    expect(() => createProviderFromEnv({ LLM_PROVIDER: 'other' })).toThrow(/Unknown LLM_PROVIDER/);
  });
});

describe('withRetry', () => {
  it('retries retryable errors with backoff and gives up after the attempts', async () => {
    /** @type {number[]} */
    const delays = [];
    let n = 0;
    const fn = async () => {
      n += 1;
      throw new LlmError('unavailable', 'down');
    };
    await expect(withRetry(fn, { attempts: 3, baseMs: 100, sleep: async (ms) => void delays.push(ms), random: () => 0.5 })).rejects.toMatchObject({ code: 'unavailable' });
    expect(n).toBe(3);
    expect(delays).toEqual([100, 200]);
  });

  it('does not retry non-retryable errors and honours a provider delay hint', async () => {
    let n = 0;
    await expect(
      withRetry(async () => {
        n += 1;
        throw new LlmError('quota', 'day');
      }),
    ).rejects.toMatchObject({ code: 'quota' });
    expect(n).toBe(1);

    /** @type {number[]} */
    const delays = [];
    let m = 0;
    const result = await withRetry(
      async () => {
        m += 1;
        if (m === 1) throw new LlmError('rate-limit', 'slow', { retryAfterMs: 5000 });
        return 'ok';
      },
      { baseMs: 100, sleep: async (ms) => void delays.push(ms), random: () => 0.5 },
    );
    expect(result).toBe('ok');
    expect(delays).toEqual([5000]);
  });
});
