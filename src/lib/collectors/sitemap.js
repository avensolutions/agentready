import { looksLikeHtml, truncate } from './text.js';

/**
 * Sitemap discovery. Uses the Sitemap directives from robots.txt when
 * present, else the standard paths. Parses with regular expressions: the
 * only facts needed are the kind of document, the number of URLs, a sample
 * and whether lastmod dates are present.
 */

/**
 * @param {string} xml
 * @returns {{ kind: 'urlset' | 'index' | 'invalid', locs: string[], lastmodCount: number }}
 */
export function parseSitemap(xml) {
  const head = xml.slice(0, 2000).toLowerCase();
  const kind = head.includes('<sitemapindex') ? 'index' : head.includes('<urlset') ? 'urlset' : 'invalid';
  if (kind === 'invalid') return { kind, locs: [], lastmodCount: 0 };
  const locs = [];
  for (const m of xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)) {
    locs.push(m[1].trim());
    if (locs.length >= 5000) break;
  }
  const lastmodCount = (xml.match(/<lastmod>/gi) ?? []).length;
  return { kind, locs, lastmodCount };
}

/**
 * @param {import('./index.js').ScanContext} ctx
 * @param {string} url
 */
async function fetchSitemap(ctx, url) {
  const res = await ctx.fetcher.fetch(url, { maxBytes: ctx.budget.bytes.text, accept: 'application/xml, text/xml, */*;q=0.5' });
  const usable = res.ok && res.body !== '' && !looksLikeHtml(res.body);
  const parsed = usable ? parseSitemap(res.body) : { kind: /** @type {const} */ ('invalid'), locs: [], lastmodCount: 0 };
  return {
    url,
    status: res.status,
    error: res.error,
    contentType: res.contentType,
    truncated: res.truncated,
    kind: res.ok ? parsed.kind : 'missing',
    urlCount: parsed.locs.length,
    sample: parsed.locs.slice(0, 20),
    hasLastmod: parsed.lastmodCount > 0,
    lastmodCount: parsed.lastmodCount,
  };
}

/**
 * Collector: find and summarise the sitemap. Costs one fetch, two when the
 * first candidate fails or is an index.
 * @param {import('./index.js').ScanContext} ctx
 */
export async function collectSitemap(ctx) {
  const fromRobots = (ctx.robots?.parsed.sitemaps ?? []).filter((u) => {
    try {
      return new URL(u).origin === ctx.origin;
    } catch {
      return false;
    }
  });
  const candidates = fromRobots.length > 0 ? fromRobots.slice(0, 2) : [`${ctx.origin}/sitemap.xml`, `${ctx.origin}/sitemap_index.xml`];

  let found = null;
  const tried = [];
  for (const candidate of candidates) {
    const result = await fetchSitemap(ctx, candidate);
    tried.push({ url: result.url, status: result.status, kind: result.kind });
    if (result.kind === 'urlset' || result.kind === 'index') {
      found = result;
      break;
    }
    if (ctx.fetcher.remaining < 8) break; // keep budget for the pages
  }

  let child = null;
  if (found && found.kind === 'index' && found.sample.length > 0 && ctx.fetcher.remaining >= 8) {
    const childUrl = found.sample[0];
    try {
      if (new URL(childUrl).origin === ctx.origin) child = await fetchSitemap(ctx, childUrl);
    } catch {
      child = null;
    }
  }

  ctx.sitemapUrls = found ? (found.kind === 'urlset' ? found.sample : child?.sample ?? []) : [];
  ctx.evidence.sitemap = {
    referencedInRobots: fromRobots.length > 0,
    robotsSitemaps: fromRobots,
    tried,
    found: found !== null,
    url: found?.url ?? null,
    status: found?.status ?? tried[0]?.status ?? 0,
    contentType: found?.contentType ?? '',
    kind: found?.kind ?? 'missing',
    urlCount: found?.urlCount ?? 0,
    sample: found?.sample ?? [],
    hasLastmod: found?.hasLastmod ?? false,
    truncated: found?.truncated ?? false,
    child: child ? { url: child.url, status: child.status, kind: child.kind, urlCount: child.urlCount, sample: child.sample.slice(0, 10), hasLastmod: child.hasLastmod } : null,
    note: found?.truncated ? `Only the first ${Math.round(ctx.budget.bytes.text / 1024)} KB of the sitemap was read; counts are a lower bound.` : truncate('', 0),
  };
}
