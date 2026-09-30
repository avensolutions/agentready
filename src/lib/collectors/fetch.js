import { UrlError, assertSafeUrl } from '../safety/url.js';
import { BUDGET } from '../scan/budget.js';

/**
 * Fetch wrapper for target sites. Every request goes through here so the
 * scan budget, redirect policy, byte caps, timeouts and user agent are
 * enforced in one place.
 *
 * Redirects are followed manually: each hop is re-validated with the URL
 * safety rules and counts against the budget. Bodies are read as streams and
 * cut at the byte cap so a large page cannot exhaust memory or CPU.
 */

/**
 * @typedef {Object} FetchResult
 * @property {string} url  the URL requested
 * @property {string} finalUrl  the URL that answered, after redirects
 * @property {number} status  HTTP status, 0 when there was no response
 * @property {boolean} ok  status 200 to 299
 * @property {Record<string, string>} headers  selected response headers, lower-case names
 * @property {string} contentType  media type without parameters, lower-case, '' when absent
 * @property {string} body  decoded text, '' for non-text responses or errors
 * @property {number} bytes  body bytes read
 * @property {boolean} truncated  true when the body was cut at the cap
 * @property {Array<{ from: string, to: string, status: number }>} redirects
 * @property {'network' | 'timeout' | 'redirect' | 'unsafe-redirect' | 'budget' | undefined} error
 * @property {string} [message]
 */

const KEPT_HEADERS = [
  'content-type',
  'content-length',
  'content-language',
  'cache-control',
  'link',
  'x-robots-tag',
  'vary',
  'server',
  'last-modified',
  'etag',
  'location',
  'content-encoding',
];

const TEXT_TYPES = /^(text\/|application\/(json|xml|javascript|ld\+json|x-yaml|yaml|xhtml\+xml|rss\+xml|atom\+xml|.*\+json|.*\+xml)$|application\/octet-stream$)/;

/** @param {Headers} headers */
function pickHeaders(headers) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const name of KEPT_HEADERS) {
    const value = headers.get(name);
    if (value !== null) out[name] = value;
  }
  return out;
}

/** @param {string | null} header */
export function parseContentType(header) {
  if (!header) return { type: '', charset: '' };
  const [type, ...params] = header.split(';');
  let charset = '';
  for (const p of params) {
    const [k, v] = p.split('=');
    if (k && k.trim().toLowerCase() === 'charset' && v) charset = v.trim().replace(/^"|"$/g, '').toLowerCase();
  }
  return { type: type.trim().toLowerCase(), charset };
}

/**
 * Read a body stream up to maxBytes.
 * @param {Response} response
 * @param {number} maxBytes
 * @returns {Promise<{ chunks: Uint8Array[], bytes: number, truncated: boolean }>}
 */
async function readCapped(response, maxBytes) {
  /** @type {Uint8Array[]} */
  const chunks = [];
  let bytes = 0;
  let truncated = false;
  if (!response.body) return { chunks, bytes, truncated };
  const reader = response.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      const room = maxBytes - bytes;
      if (value.byteLength > room) {
        chunks.push(value.subarray(0, room));
        bytes += room;
        truncated = true;
        await reader.cancel();
        break;
      }
      chunks.push(value);
      bytes += value.byteLength;
    }
  } finally {
    reader.releaseLock?.();
  }
  return { chunks, bytes, truncated };
}

/**
 * @param {Uint8Array[]} chunks
 * @param {number} bytes
 * @param {string} charset
 */
function decode(chunks, bytes, charset) {
  const joined = new Uint8Array(bytes);
  let offset = 0;
  for (const c of chunks) {
    joined.set(c, offset);
    offset += c.byteLength;
  }
  let decoder;
  try {
    decoder = new TextDecoder(charset || 'utf-8');
  } catch {
    decoder = new TextDecoder('utf-8');
  }
  return decoder.decode(joined);
}

/**
 * @param {Object} [options]
 * @param {typeof fetch} [options.fetchImpl]  injectable for tests
 * @param {number} [options.maxFetches]
 * @param {number} [options.timeoutMs]
 * @param {string} [options.userAgent]
 */
export function createFetcher({
  fetchImpl = globalThis.fetch,
  maxFetches = BUDGET.maxFetches,
  timeoutMs = BUDGET.fetchTimeoutMs,
  userAgent = BUDGET.userAgent,
} = {}) {
  let used = 0;

  /**
   * @param {string} url
   * @param {Object} [options]
   * @param {number} [options.maxBytes]
   * @param {string} [options.accept]
   * @param {Record<string, string>} [options.headers]
   * @returns {Promise<FetchResult>}
   */
  async function fetchPage(url, { maxBytes = BUDGET.bytes.page, accept, headers = {} } = {}) {
    /** @type {FetchResult} */
    const result = {
      url,
      finalUrl: url,
      status: 0,
      ok: false,
      headers: {},
      contentType: '',
      body: '',
      bytes: 0,
      truncated: false,
      redirects: [],
      error: undefined,
    };

    let current = url;
    for (let hop = 0; ; hop += 1) {
      if (used >= maxFetches) {
        result.error = 'budget';
        result.message = 'The scan reached its request budget.';
        return result;
      }
      used += 1;

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      /** @type {Response} */
      let response;
      try {
        response = await fetchImpl(current, {
          method: 'GET',
          redirect: 'manual',
          signal: controller.signal,
          headers: {
            'user-agent': userAgent,
            accept: accept ?? 'text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.5',
            'accept-language': 'en-AU,en;q=0.9',
            ...headers,
          },
        });
      } catch (err) {
        clearTimeout(timer);
        result.error = controller.signal.aborted ? 'timeout' : 'network';
        result.message = controller.signal.aborted ? `No response within ${timeoutMs / 1000} seconds.` : String(err?.message ?? err);
        return result;
      }

      result.finalUrl = current;
      result.status = response.status;
      result.headers = pickHeaders(response.headers);

      const location = response.headers.get('location');
      if (response.status >= 300 && response.status < 400 && location) {
        clearTimeout(timer);
        await response.body?.cancel().catch(() => {});
        let next;
        try {
          next = new URL(location, current).toString();
          assertSafeUrl(next);
        } catch (err) {
          result.error = 'unsafe-redirect';
          result.message = err instanceof UrlError ? `Redirected to an address that cannot be checked (${err.code}).` : 'Redirected to an invalid address.';
          return result;
        }
        result.redirects.push({ from: current, to: next, status: response.status });
        if (hop + 1 >= BUDGET.maxRedirectsPerFetch) {
          result.error = 'redirect';
          result.message = `More than ${BUDGET.maxRedirectsPerFetch} redirects.`;
          return result;
        }
        current = next;
        continue;
      }

      result.ok = response.ok;
      const { type, charset } = parseContentType(response.headers.get('content-type'));
      result.contentType = type;
      if (type === '' || TEXT_TYPES.test(type)) {
        try {
          const { chunks, bytes, truncated } = await readCapped(response, maxBytes);
          result.bytes = bytes;
          result.truncated = truncated;
          result.body = decode(chunks, bytes, charset);
        } catch (err) {
          result.error = controller.signal.aborted ? 'timeout' : 'network';
          result.message = controller.signal.aborted ? `The response did not finish within ${timeoutMs / 1000} seconds.` : String(err?.message ?? err);
        }
      } else {
        await response.body?.cancel().catch(() => {});
      }
      clearTimeout(timer);
      return result;
    }
  }

  return {
    fetch: fetchPage,
    get used() {
      return used;
    },
    get remaining() {
      return Math.max(0, maxFetches - used);
    },
  };
}

/** @typedef {ReturnType<typeof createFetcher>} Fetcher */
