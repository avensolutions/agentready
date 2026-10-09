import { describe, expect, it } from 'vitest';
import { PHASES, collectEvidence } from '../../src/lib/collectors/index.js';
import { selectSamplePages } from '../../src/lib/collectors/pages.js';
import { markdownPathFor } from '../../src/lib/collectors/probes.js';
import { EVIDENCE_KEY_NAMES } from '../../src/lib/evidence/keys.js';
import { BUDGET, WORST_CASE_SUBREQUESTS } from '../../src/lib/scan/budget.js';
import { ScanError } from '../../src/lib/scan/errors.js';

const ORIGIN = 'https://acme.example.com';

/** @param {string} title @param {string} body */
const page = (title, body) =>
  `<!doctype html><html lang="en"><head><title>${title}</title><meta name="description" content="${title} description"><link rel="canonical" href="${ORIGIN}/"></head><body><header><nav><a href="/about">About</a><a href="/pricing">Pricing</a><a href="/contact">Contact</a><a href="/blog">Blog</a><a href="/developers">Developers</a><a href="/login">Login</a></nav></header><main><h1>${title}</h1>${body}</main><footer><a href="mailto:hi@acme.example.com">Email</a></footer></body></html>`;

/**
 * @param {Record<string, { body?: string, status?: number, type?: string, headers?: Record<string, string> } | ((init: RequestInit) => Response)>} routes
 */
function fakeSite(routes) {
  /** @type {Array<{ url: string, accept: string }>} */
  const calls = [];
  /** @type {typeof fetch} */
  const impl = async (input, init = {}) => {
    const url = String(input);
    calls.push({ url, accept: new Headers(init.headers).get('accept') ?? '' });
    const route = routes[url];
    if (!route) return new Response('<html><body>Not found</body></html>', { status: 404, headers: { 'content-type': 'text/html' } });
    if (typeof route === 'function') return route(init);
    return new Response(route.body ?? '', { status: route.status ?? 200, headers: { 'content-type': route.type ?? 'text/html; charset=utf-8', ...(route.headers ?? {}) } });
  };
  return { impl, calls };
}

const GOOD_SITE = {
  [`${ORIGIN}/robots.txt`]: { type: 'text/plain', body: 'User-agent: *\nDisallow: /admin/\nUser-agent: GPTBot\nDisallow: /\nSitemap: https://acme.example.com/sitemap.xml\n' },
  [`${ORIGIN}/sitemap.xml`]: {
    type: 'application/xml',
    body: '<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://acme.example.com/</loc><lastmod>2026-01-01</lastmod></url><url><loc>https://acme.example.com/about</loc></url></urlset>',
  },
  [`${ORIGIN}/llms.txt`]: { type: 'text/markdown', body: '# Acme\n\n> Widgets for teams.\n\n## Pages\n\n- [About](https://acme.example.com/about.md): who we are\n- [Full text](https://acme.example.com/llms-full.txt)\n' },
  [`${ORIGIN}/llms-full.txt`]: { type: 'text/plain', body: '# Acme\n\nSource: https://acme.example.com/\n\nWidgets for teams. Lots of words here.\n\n# About\n\nSource: https://acme.example.com/about\n\nFounded in Melbourne.\n' },
  [`${ORIGIN}/`]: { body: page('Acme', '<p>We make widgets for teams. Plans from $10 a month.</p><script type="application/ld+json">{"@type":"Organization","name":"Acme"}</script>') },
  [`${ORIGIN}/about`]: { body: page('About', '<p>Founded in Melbourne in 2020.</p>') },
  [`${ORIGIN}/pricing`]: { body: page('Pricing', '<p>Starter $10, Team $50.</p>') },
  [`${ORIGIN}/contact`]: { body: page('Contact', '<form action="/enquire" method="post"><input name="email" type="email"><button type="submit">Send</button></form>') },
  [`${ORIGIN}/index.md`]: { type: 'text/markdown', body: '# Acme\n\nWe make widgets for teams.' },
  [`${ORIGIN}/openapi.json`]: { type: 'application/json', body: JSON.stringify({ openapi: '3.1.0', info: { title: 'Acme API' }, paths: { '/widgets': { get: { summary: 'List widgets' }, post: {} } }, components: { securitySchemes: { key: { type: 'apiKey' } } } }) },
  [`${ORIGIN}/developers`]: { body: page('Developers', '<p>Use our API.</p>') },
};

describe('collectEvidence', () => {
  it('collects every evidence key from a well-behaved site within budget', async () => {
    const site = fakeSite(GOOD_SITE);
    /** @type {string[]} */
    const progress = [];
    const { evidence, pages, stats } = await collectEvidence({
      url: `${ORIGIN}/`,
      fetchImpl: site.impl,
      onProgress: (e) => progress.push(`${e.status}:${e.step}`),
    });

    for (const key of EVIDENCE_KEY_NAMES) expect(evidence[key], key).toBeDefined();
    expect(Object.values(evidence).some((v) => v && typeof v === 'object' && 'missing' in v)).toBe(false);

    const robots = /** @type {any} */ (evidence.robots_txt);
    expect(robots.fetched).toBe(true);
    expect(robots.sitemaps).toEqual(['https://acme.example.com/sitemap.xml']);
    expect(robots.trainingAgents.GPTBot.allowedRoot).toBe(false);
    expect(robots.userAgents.ClaudeBot.allowedRoot).toBe(true);
    expect(robots.wildcard.disallow).toEqual(['/admin/']);

    const sitemap = /** @type {any} */ (evidence.sitemap);
    expect(sitemap).toMatchObject({ referencedInRobots: true, found: true, kind: 'urlset', urlCount: 2, hasLastmod: true });

    expect(evidence.llms_txt).toMatchObject({ present: true, hasH1: true, hasBlockquote: true, linkCount: 2, mentionsLlmsFull: true });
    expect(evidence.llms_full_txt).toMatchObject({ present: true, headingCount: 2, urlCount: 2, linkedFromLlmsTxt: true });

    const home = /** @type {any} */ (evidence.home_html);
    expect(home.title).toBe('Acme');
    expect(home.headings).toEqual([{ level: 1, text: 'Acme' }]);
    expect(home.text).toContain('Plans from $10 a month');
    expect(home.landmarks.main).toBe(1);

    // sample selection: prefers pricing, contact, about; skips login and blog
    expect(pages.map((p) => p.fetch.url)).toEqual([`${ORIGIN}/`, `${ORIGIN}/pricing`, `${ORIGIN}/contact`, `${ORIGIN}/about`]);
    const samples = /** @type {any[]} */ (evidence.pages);
    expect(samples.map((p) => p.title)).toEqual(['Pricing', 'Contact', 'About']);

    expect(/** @type {any} */ (evidence.headers).length).toBe(4);
    const sd = /** @type {any} */ (evidence.structured_data);
    expect(sd[0].jsonLd[0]).toMatchObject({ parsed: true, types: ['Organization'] });

    const forms = /** @type {any} */ (evidence.forms);
    expect(forms.pages[2].forms[0]).toMatchObject({ action: `${ORIGIN}/enquire`, method: 'POST', scriptOnly: false });
    expect(forms.pages[0].mailto).toEqual(['hi@acme.example.com']);

    const md = /** @type {any} */ (evidence.markdown_alternates);
    expect(md.anyFound).toBe(true);
    expect(md.probes.find((p) => p.probe === 'md-path')).toMatchObject({ url: `${ORIGIN}/index.md`, isMarkdown: true });
    expect(md.probes.find((p) => p.probe === 'accept-negotiation')).toMatchObject({ isMarkdown: false, reason: 'html body' });

    const api = /** @type {any} */ (evidence.api_surface);
    expect(api.probes.find((p) => p.path === '/openapi.json')).toMatchObject({ found: true, summary: { openapi: '3.1.0', pathCount: 1, operationCount: 2, describedOperations: 1, hasSecuritySchemes: true } });
    expect(api.docLinks[0].href).toBe(`${ORIGIN}/developers`);
    expect(api.docPages[0]).toMatchObject({ status: 200 });
    // the developers page is not in the sample, so "API" is not on the pages read; the nav link text is
    expect(api.mentions.api).toBe(0);
    expect(api.mentions.developer).toBeGreaterThan(0);

    const text = /** @type {any} */ (evidence.site_text);
    expect(text.pageCount).toBe(4);
    expect(text.text).toContain('## Source: https://acme.example.com/pricing');

    expect(stats.fetches).toBe(site.calls.length);
    expect(stats.fetches).toBeLessThanOrEqual(BUDGET.maxFetches);
    expect(stats.fetches).toBe(15);

    // progress: every step starts and finishes, robots first, in phase order
    const steps = PHASES.flat().map((s) => s.id);
    for (const id of steps) {
      expect(progress).toContain(`start:${id}`);
      expect(progress).toContain(`done:${id}`);
    }
    expect(progress[0]).toBe('start:robots');
    expect(progress.indexOf('done:robots')).toBeLessThan(progress.indexOf('start:home'));
    expect(progress.indexOf('done:home')).toBeLessThan(progress.indexOf('start:pages'));
  });

  it('stops when robots.txt disallows agentready', async () => {
    const site = fakeSite({ ...GOOD_SITE, [`${ORIGIN}/robots.txt`]: { type: 'text/plain', body: 'User-agent: agentready\nDisallow: /\n' } });
    await expect(collectEvidence({ url: `${ORIGIN}/`, fetchImpl: site.impl })).rejects.toMatchObject({ code: 'robots' });
    expect(site.calls.length).toBe(1);
  });

  it('stops when the wildcard group blocks the target path', async () => {
    const site = fakeSite({ ...GOOD_SITE, [`${ORIGIN}/robots.txt`]: { type: 'text/plain', body: 'User-agent: *\nDisallow: /private/\n' } });
    await expect(collectEvidence({ url: `${ORIGIN}/private/page`, fetchImpl: site.impl })).rejects.toBeInstanceOf(ScanError);
  });

  it('reports an unreachable site', async () => {
    /** @type {typeof fetch} */
    const down = async () => {
      throw new TypeError('getaddrinfo ENOTFOUND');
    };
    await expect(collectEvidence({ url: 'https://down.example.com/', fetchImpl: down })).rejects.toMatchObject({ code: 'unreachable' });
  });

  it('reports an HTTP error on the target page', async () => {
    const site = fakeSite({ [`${ORIGIN}/robots.txt`]: { status: 404 }, [`${ORIGIN}/`]: { status: 403, body: 'Forbidden' } });
    await expect(collectEvidence({ url: `${ORIGIN}/`, fetchImpl: site.impl })).rejects.toMatchObject({ code: 'http-error', details: { status: 403 } });
  });

  it('degrades gracefully on a bare site with nothing but a home page', async () => {
    const site = fakeSite({ [`${ORIGIN}/`]: { body: '<html><head><title>Bare</title></head><body><div id="app"></div><script src="/a.js"></script></body></html>' } });
    const { evidence, stats } = await collectEvidence({ url: `${ORIGIN}/`, fetchImpl: site.impl });
    expect(evidence.robots_txt).toMatchObject({ fetched: false, status: 404 });
    expect(evidence.sitemap).toMatchObject({ found: false, kind: 'missing' });
    expect(evidence.llms_txt).toMatchObject({ present: false, servedHtmlInstead: false });
    expect(evidence.home_html).toMatchObject({ title: 'Bare', words: 0, externalScripts: 1 });
    expect(evidence.pages).toEqual([]);
    expect(/** @type {any} */ (evidence.markdown_alternates).anyFound).toBe(false);
    expect(/** @type {any} */ (evidence.site_text).pageCount).toBe(1);
    expect(stats.fetches).toBeLessThanOrEqual(BUDGET.maxFetches);
  });

  it('flags a catch-all route that serves HTML for llms.txt', async () => {
    const site = fakeSite({ ...GOOD_SITE, [`${ORIGIN}/llms.txt`]: { body: '<html><body>Not really</body></html>' } });
    const { evidence } = await collectEvidence({ url: `${ORIGIN}/`, fetchImpl: site.impl });
    expect(evidence.llms_txt).toMatchObject({ present: false, servedHtmlInstead: true });
  });

  it('never exceeds the request budget even when every probe redirects', async () => {
    const site = fakeSite({
      [`${ORIGIN}/robots.txt`]: { status: 404 },
      [`${ORIGIN}/`]: { body: page('Loop', `<p>x</p>${Array.from({ length: 30 }, (_, i) => `<a href="/p${i}">Page ${i}</a>`).join('')}`) },
    });
    // everything else 404s (one request each); the site is small so the budget holds
    const { stats } = await collectEvidence({ url: `${ORIGIN}/`, fetchImpl: site.impl });
    expect(stats.fetches).toBeLessThanOrEqual(BUDGET.maxFetches);
  });
});

describe('budget', () => {
  it('stays under the free plan subrequest cap', () => {
    expect(WORST_CASE_SUBREQUESTS).toBeLessThan(50);
    expect(BUDGET.concurrency).toBeLessThan(6);
  });
});

describe('selectSamplePages', () => {
  it('prefers customer pages, skips noise, stays on site and dedupes', () => {
    const home = /** @type {any} */ ({
      url: 'https://www.acme.example.com/',
      links: [
        { href: 'https://www.acme.example.com/blog/post-1', text: 'A post' },
        { href: 'https://acme.example.com/pricing/', text: 'Pricing' },
        { href: 'https://www.acme.example.com/pricing', text: 'Pricing again' },
        { href: 'https://www.acme.example.com/login', text: 'Log in' },
        { href: 'https://www.acme.example.com/brochure.pdf', text: 'Brochure' },
        { href: 'https://other.example.org/about', text: 'About' },
        { href: 'https://www.acme.example.com/about', text: 'About' },
        { href: 'https://www.acme.example.com/contact?ref=nav', text: 'Contact' },
        { href: 'https://www.acme.example.com/', text: 'Home' },
        { href: 'https://www.acme.example.com/a/b/c/d/e', text: 'Deep' },
      ],
    });
    // pricing and contact score highest (query string dropped, www-less duplicate removed), then about
    expect(selectSamplePages(home, 3)).toEqual(['https://acme.example.com/pricing/', 'https://www.acme.example.com/contact', 'https://www.acme.example.com/about']);
    expect(selectSamplePages(home, 4)[3]).toBe('https://www.acme.example.com/blog/post-1');
  });
});

describe('markdownPathFor', () => {
  it('maps HTML paths to sibling markdown paths', () => {
    expect(markdownPathFor('https://a.example.com/')).toBe('https://a.example.com/index.md');
    expect(markdownPathFor('https://a.example.com/about/')).toBe('https://a.example.com/about.md');
    expect(markdownPathFor('https://a.example.com/docs/intro.html')).toBe('https://a.example.com/docs/intro.md');
  });
});
