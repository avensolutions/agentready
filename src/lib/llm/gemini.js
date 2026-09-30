import { LlmError } from './errors.js';

/**
 * Google Gemini over plain fetch. Request shape follows the documentation
 * recorded in docs/limits.md on 2026-09-30:
 * - POST v1beta/models/{model}:generateContent with the x-goog-api-key header
 * - structured output through generationConfig.responseFormat with a JSON
 *   schema; the older responseMimeType plus responseJsonSchema pair is kept
 *   as an automatic fallback if the API rejects the newer field
 * - thinkingLevel instead of a thinking budget; no temperature, topP, topK
 *   or candidateCount, which are deprecated or unsupported on Gemini 3
 */

const DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

/**
 * @param {Object} options
 * @param {string} options.apiKey
 * @param {string} options.model
 * @param {string} [options.thinkingLevel]  minimal, low, medium or high
 * @param {typeof fetch} [options.fetchImpl]
 * @param {string} [options.baseUrl]
 * @param {number} [options.timeoutMs]
 * @returns {import('./index.js').LlmProvider}
 */
export function createGeminiProvider({ apiKey, model, thinkingLevel, fetchImpl = globalThis.fetch, baseUrl = DEFAULT_BASE_URL, timeoutMs = 60_000 }) {
  // Flash-Lite supports "minimal"; 3.8 and 3.7 Flash reject it, so "low" is
  // the safe default for the other models.
  const level = (thinkingLevel ?? (model.includes('lite') ? 'minimal' : 'low')).toLowerCase();
  let outputMode = /** @type {'responseFormat' | 'legacy'} */ ('responseFormat');

  /** @param {import('./index.js').LlmRequest} request */
  function buildBody(request) {
    /** @type {Record<string, unknown>} */
    const generationConfig = {
      maxOutputTokens: request.maxOutputTokens ?? 4096,
      thinkingConfig: { thinkingLevel: level },
    };
    if (outputMode === 'responseFormat') {
      generationConfig.responseFormat = { text: { mimeType: 'application/json', schema: request.schema } };
    } else {
      generationConfig.responseMimeType = 'application/json';
      generationConfig.responseJsonSchema = request.schema;
    }
    return {
      systemInstruction: { parts: [{ text: request.system }] },
      contents: [{ role: 'user', parts: [{ text: request.prompt }] }],
      generationConfig,
    };
  }

  /**
   * @param {import('./index.js').LlmRequest} request
   * @param {{ signal?: AbortSignal }} [options]
   * @returns {Promise<import('./index.js').LlmResponse>}
   */
  async function generate(request, { signal } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    signal?.addEventListener('abort', () => controller.abort(), { once: true });
    let response;
    let text;
    try {
      response = await fetchImpl(`${baseUrl}/models/${encodeURIComponent(model)}:generateContent`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify(buildBody(request)),
        signal: controller.signal,
      });
      text = await response.text();
    } catch (err) {
      throw new LlmError('network', controller.signal.aborted ? 'The assessment request timed out.' : `The assessment request failed: ${err?.message ?? err}`);
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      throw classifyHttpError(response.status, text, () => {
        if (outputMode === 'responseFormat') {
          outputMode = 'legacy';
          return true;
        }
        return false;
      });
    }

    /** @type {any} */
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      throw new LlmError('malformed', 'The assessment service returned something other than JSON.');
    }
    if (body?.promptFeedback?.blockReason) {
      throw new LlmError('blocked', `The assessment was blocked (${body.promptFeedback.blockReason}).`, { blockReason: body.promptFeedback.blockReason });
    }
    const candidate = body?.candidates?.[0];
    const finish = candidate?.finishReason ?? 'MISSING';
    if (finish !== 'STOP') {
      throw new LlmError('unfinished', `The assessment did not complete (${finish}).`, { finishReason: finish });
    }
    const parts = Array.isArray(candidate?.content?.parts) ? candidate.content.parts : [];
    const output = parts
      .filter((/** @type {any} */ p) => typeof p?.text === 'string' && !p.thought)
      .map((/** @type {any} */ p) => p.text)
      .join('');
    let json;
    try {
      json = JSON.parse(stripFences(output));
    } catch {
      throw new LlmError('malformed', 'The assessment result was not valid JSON.', { sample: output.slice(0, 200) });
    }
    const usage = body?.usageMetadata ?? {};
    return {
      json,
      model: body?.modelVersion ?? model,
      usage: {
        input: Number(usage.promptTokenCount ?? 0),
        output: Number(usage.candidatesTokenCount ?? 0),
        thoughts: Number(usage.thoughtsTokenCount ?? 0),
      },
    };
  }

  return { name: 'gemini', model, generate };
}

/** @param {string} s */
function stripFences(s) {
  const t = s.trim();
  const m = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(t);
  return m ? m[1] : t;
}

/**
 * Map an HTTP error to an LlmError. `switchOutputMode` is called for a 400
 * that looks like the structured-output field being rejected; it returns
 * true when a retry with the legacy shape makes sense.
 *
 * @param {number} status
 * @param {string} text
 * @param {() => boolean} switchOutputMode
 */
export function classifyHttpError(status, text, switchOutputMode) {
  /** @type {any} */
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = null;
  }
  const message = body?.error?.message ?? text.slice(0, 300);
  const details = Array.isArray(body?.error?.details) ? body.error.details : [];

  if (status === 429) {
    const quota = details.find((d) => typeof d?.['@type'] === 'string' && d['@type'].endsWith('QuotaFailure'));
    const quotaIds = (quota?.violations ?? []).map((v) => String(v?.quotaId ?? ''));
    const perDay = quotaIds.some((id) => /PerDay|Daily/i.test(id)) || /per day|daily/i.test(message);
    const retryInfo = details.find((d) => typeof d?.['@type'] === 'string' && d['@type'].endsWith('RetryInfo'));
    const retryAfterMs = parseRetryDelay(retryInfo?.retryDelay);
    if (perDay) return new LlmError('quota', 'The assessment service has used its daily allowance.', { quotaIds, message });
    return new LlmError('rate-limit', 'The assessment service is busy.', { quotaIds, retryAfterMs, message });
  }
  if (status === 503 || status === 500 || status === 504 || status === 408) {
    return new LlmError('unavailable', `The assessment service is unavailable (${status}).`, { message });
  }
  if (status === 400 && /responseFormat|response_format|Unknown name|Invalid JSON payload/i.test(message) && switchOutputMode()) {
    return new LlmError('malformed', 'The assessment service rejected the request shape; retrying with the legacy structured output fields.', { message, switched: true });
  }
  if (status === 401 || status === 403) {
    return new LlmError('config', 'The assessment service rejected the API key.', { status, message });
  }
  return new LlmError('request', `The assessment service rejected the request (${status}): ${message}`, { status, message });
}

/** @param {unknown} value  e.g. "34s" or "1.5s" */
function parseRetryDelay(value) {
  if (typeof value !== 'string') return 0;
  const m = /^(\d+(?:\.\d+)?)s$/.exec(value);
  return m ? Math.round(Number(m[1]) * 1000) : 0;
}
