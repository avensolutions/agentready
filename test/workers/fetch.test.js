import { describe, expect, it } from 'vitest';
import { createFetcher, parseContentType } from '../../src/lib/collectors/fetch.js';

/**
 * A fake site: map of URL to a Response factory. Records every request.
 * @param {Record<string, (init: RequestInit) => Response>} routes
 */
function fakeFetch(routes) {
  /** @type {Array<{ url: string, init: RequestInit }>} */
  const calls = [];
  /** @type {typeof fetch} */
  const impl = async (input, init = {}) => {
    const url = String(input);
    calls.push({ url, init });
    const route = routes[url];
    if (!route) return new Response('not found', { status: 404 });
    return route(init);
  };
  return { impl, calls };
}

const html = (/** @type {string} */ body, /** @type {HeadersInit} */ headers = {}) =>
  () => new Response(body, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8', ...headers } });

describe('workers runtime', () => {
  it('provides HTMLRewriter and streaming responses', () => {
    expect(typeof HTMLRewriter).toBe('function');
    expect(new Response('x').body).toBeInstanceOf(ReadableStream);
  });
});

describe('createFetcher', () => {
  it('fetches with the honest user agent and keeps selected headers', async () => {
    const site = fakeFetch({
      'https://example.com/': html('<p>hi</p>', { 'x-robots-tag': 'noai', server: 'test', 'set-cookie': 'secret' }),
    });
    const fetcher = createFetcher({ fetchImpl: site.impl });
    const res = await fetcher.fetch('https://example.com/');
    expect(res.ok).toBe(true);
    expect(res.status).toBe(200);
    expect(res.body).toBe('<p>hi</p>');
    expect(res.contentType).toBe('text/html');
    expect(res.headers).toEqual({ 'content-type': 'text/html; charset=utf-8', 'x-robots-tag': 'noai', server: 'test' });
    expect(res.bytes).toBe(9);
    expect(res.truncated).toBe(false);
    const sent = new Headers(site.calls[0].init.headers);
    expect(sent.get('user-agent')).toMatch(/^axcheck\/1\.0 \(\+https:\/\/axcheck\.theoverstorygroup\.com\)$/);
    expect(site.calls[0].init.redirect).toBe('manual');
    expect(fetcher.used).toBe(1);
  });

  it('follows redirects manually, records each hop and counts them against the budget', async () => {
    const site = fakeFetch({
      'http://example.com/': () => new Response(null, { status: 301, headers: { location: 'https://example.com/' } }),
      'https://example.com/': () => new Response(null, { status: 302, headers: { location: '/home' } }),
      'https://example.com/home': html('<p>home</p>'),
    });
    const fetcher = createFetcher({ fetchImpl: site.impl });
    const res = await fetcher.fetch('http://example.com/');
    expect(res.error).toBeUndefined();
    expect(res.finalUrl).toBe('https://example.com/home');
    expect(res.redirects).toEqual([
      { from: 'http://example.com/', to: 'https://example.com/', status: 301 },
      { from: 'https://example.com/', to: 'https://example.com/home', status: 302 },
    ]);
    expect(res.body).toBe('<p>home</p>');
    expect(fetcher.used).toBe(3);
  });

  it('stops at a redirect to an address that fails the safety rules', async () => {
    const site = fakeFetch({
      'https://example.com/': () => new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/latest/meta-data/' } }),
    });
    const fetcher = createFetcher({ fetchImpl: site.impl });
    const res = await fetcher.fetch('https://example.com/');
    expect(res.error).toBe('unsafe-redirect');
    expect(res.message).toContain('(ip)');
    expect(site.calls.map((c) => c.url)).toEqual(['https://example.com/']);
  });

  it('gives up after too many redirects', async () => {
    const routes = {};
    for (let i = 0; i < 10; i += 1) {
      routes[`https://example.com/${i}`] = () => new Response(null, { status: 302, headers: { location: `/${i + 1}` } });
    }
    const site = fakeFetch(routes);
    const fetcher = createFetcher({ fetchImpl: site.impl });
    const res = await fetcher.fetch('https://example.com/0');
    expect(res.error).toBe('redirect');
    expect(res.redirects.length).toBe(5);
    expect(fetcher.used).toBe(5);
  });

  it('returns a budget error once the request budget is spent', async () => {
    const site = fakeFetch({ 'https://example.com/': html('<p>hi</p>') });
    const fetcher = createFetcher({ fetchImpl: site.impl, maxFetches: 2 });
    await fetcher.fetch('https://example.com/');
    await fetcher.fetch('https://example.com/');
    const res = await fetcher.fetch('https://example.com/');
    expect(res.error).toBe('budget');
    expect(res.status).toBe(0);
    expect(fetcher.remaining).toBe(0);
    expect(site.calls.length).toBe(2);
  });

  it('cuts a streamed body at the byte cap', async () => {
    const chunk = 'x'.repeat(1000);
    const stream = new ReadableStream({
      start(controller) {
        for (let i = 0; i < 10; i += 1) controller.enqueue(new TextEncoder().encode(chunk));
        controller.close();
      },
    });
    const site = fakeFetch({ 'https://example.com/big': () => new Response(stream, { headers: { 'content-type': 'text/plain' } }) });
    const fetcher = createFetcher({ fetchImpl: site.impl });
    const res = await fetcher.fetch('https://example.com/big', { maxBytes: 2500 });
    expect(res.truncated).toBe(true);
    expect(res.bytes).toBe(2500);
    expect(res.body.length).toBe(2500);
  });

  it('does not read non-text bodies', async () => {
    const site = fakeFetch({
      'https://example.com/logo.png': () => new Response(new Uint8Array([137, 80, 78, 71]), { headers: { 'content-type': 'image/png' } }),
    });
    const fetcher = createFetcher({ fetchImpl: site.impl });
    const res = await fetcher.fetch('https://example.com/logo.png');
    expect(res.ok).toBe(true);
    expect(res.contentType).toBe('image/png');
    expect(res.body).toBe('');
    expect(res.bytes).toBe(0);
  });

  it('decodes a declared legacy charset', async () => {
    const latin1 = new Uint8Array([0x63, 0x61, 0x66, 0xe9]); // "cafe" with an acute e
    const site = fakeFetch({
      'https://example.com/': () => new Response(latin1, { headers: { 'content-type': 'text/html; charset=ISO-8859-1' } }),
    });
    const fetcher = createFetcher({ fetchImpl: site.impl });
    const res = await fetcher.fetch('https://example.com/');
    expect(res.body).toBe('caf\u00e9');
  });

  it('reports a timeout when the site does not answer in time', async () => {
    /** @type {typeof fetch} */
    const never = (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      });
    const fetcher = createFetcher({ fetchImpl: never, timeoutMs: 20 });
    const res = await fetcher.fetch('https://example.com/');
    expect(res.error).toBe('timeout');
    expect(res.status).toBe(0);
  });

  it('reports a network failure without throwing', async () => {
    /** @type {typeof fetch} */
    const broken = async () => {
      throw new TypeError('connection refused');
    };
    const fetcher = createFetcher({ fetchImpl: broken });
    const res = await fetcher.fetch('https://example.com/');
    expect(res.error).toBe('network');
    expect(res.message).toContain('connection refused');
  });
});

describe('parseContentType', () => {
  it('splits the media type and charset', () => {
    expect(parseContentType('Text/HTML; Charset="UTF-8"')).toEqual({ type: 'text/html', charset: 'utf-8' });
    expect(parseContentType('application/json')).toEqual({ type: 'application/json', charset: '' });
    expect(parseContentType(null)).toEqual({ type: '', charset: '' });
  });
});
