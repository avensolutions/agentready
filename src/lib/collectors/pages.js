import { sameSite } from '../safety/url.js';
import { ScanError } from '../scan/errors.js';
import { extractPage } from './html.js';

/** Home page fetch and linked page sampling. */

const SKIP_EXT = /\.(pdf|jpe?g|png|gif|svg|webp|avif|mp4|mp3|zip|gz|docx?|xlsx?|pptx?|ics|xml|json|css|js|woff2?|ttf)$/i;
const SKIP_PATH = /(\/(login|signin|sign-in|logout|register|signup|sign-up|cart|checkout|account|admin|wp-admin|wp-login|feed|rss|tag|tags|category|search|privacy|terms|cookie|cookies|legal|sitemap)(\/|$))|\/page\/\d+/i;
const PREFERRED = [
  ['pricing', 5],
  ['plans', 4],
  ['contact', 5],
  ['about', 4],
  ['services', 4],
  ['products', 4],
  ['product', 3],
  ['solutions', 3],
  ['features', 3],
  ['how-it-works', 3],
  ['how it works', 3],
  ['docs', 3],
  ['documentation', 3],
  ['api', 3],
  ['developers', 3],
  ['faq', 3],
  ['team', 2],
  ['company', 2],
  ['case-studies', 2],
  ['customers', 2],
  ['get-started', 2],
];

/**
 * Choose up to n linked pages worth reading, preferring the pages a
 * prospective customer would open.
 * @param {import('./html.js').PageExtract} home
 * @param {number} n
 * @returns {string[]}
 */
export function selectSamplePages(home, n) {
  const homeUrl = new URL(home.url);
  const homeKey = homeUrl.pathname.replace(/\/$/, '') || '/';
  /** @type {Map<string, { href: string, score: number, index: number }>} */
  const candidates = new Map();
  home.links.forEach((link, index) => {
    let u;
    try {
      u = new URL(link.href);
    } catch {
      return;
    }
    if (!/^https?:$/.test(u.protocol) || !sameSite(u, homeUrl)) return;
    const path = u.pathname.replace(/\/$/, '') || '/';
    if (path === homeKey || path === '/' || SKIP_EXT.test(path) || SKIP_PATH.test(u.pathname)) return;
    if (path.split('/').length > 4) return;
    const key = `${u.hostname.replace(/^www\./, '')}${path}`;
    if (candidates.has(key)) return;
    const hay = `${path} ${link.text}`.toLowerCase();
    let score = 0;
    for (const [word, weight] of PREFERRED) if (hay.includes(word)) score = Math.max(score, weight);
    if (path.split('/').length === 2) score += 1; // top-level pages first
    candidates.set(key, { href: `${u.origin}${u.pathname}`, score, index });
  });
  return [...candidates.values()]
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, n)
    .map((c) => c.href);
}

/**
 * Collector: fetch the target page. Stops the scan when the site cannot be
 * read at all, since nothing else would be meaningful.
 * @param {import('./index.js').ScanContext} ctx
 */
export async function collectHome(ctx) {
  const res = await ctx.fetcher.fetch(ctx.url, { maxBytes: ctx.budget.bytes.home });
  if (res.error === 'network' || res.error === 'timeout') {
    throw new ScanError('unreachable', `The site did not respond: ${res.message ?? res.error}.`, { url: ctx.url, error: res.error });
  }
  if (res.error) {
    throw new ScanError('unreachable', res.message ?? 'The site could not be fetched.', { url: ctx.url, error: res.error });
  }
  if (res.status >= 400) {
    throw new ScanError('http-error', `The site answered with HTTP ${res.status} for ${ctx.url}.`, { url: ctx.url, status: res.status });
  }
  if (!res.contentType.startsWith('text/html') && !res.contentType.startsWith('application/xhtml')) {
    throw new ScanError('http-error', `The address returned ${res.contentType || 'no content type'}, not an HTML page.`, { url: ctx.url, status: res.status });
  }
  const extract = await extractPage(res.body, res.finalUrl, { textChars: 20_000, links: 150 });
  ctx.pages.push({ role: 'home', fetch: res, extract });
}

/**
 * Collector: fetch a small sample of linked pages in parallel.
 * @param {import('./index.js').ScanContext} ctx
 */
export async function collectSamplePages(ctx) {
  const home = ctx.pages[0]?.extract;
  if (!home) return;
  const wanted = Math.min(ctx.budget.samplePages, Math.max(0, ctx.fetcher.remaining - 8));
  const urls = selectSamplePages(home, wanted);
  ctx.sampleUrls = urls;
  const results = await Promise.all(
    urls.map(async (url) => {
      const res = await ctx.fetcher.fetch(url, { maxBytes: ctx.budget.bytes.page });
      if (!res.ok || !(res.contentType.startsWith('text/html') || res.contentType.startsWith('application/xhtml'))) {
        return { role: /** @type {const} */ ('sample'), fetch: res, extract: null };
      }
      const extract = await extractPage(res.body, res.finalUrl, { textChars: 8000, links: 60 });
      return { role: /** @type {const} */ ('sample'), fetch: res, extract };
    }),
  );
  for (const r of results) ctx.pages.push(r);
}
