import { looksLikeHtml, truncate } from './text.js';

/** Probes for markdown alternates and for API, OpenAPI and MCP surfaces. */

const MD_ACCEPT = 'text/markdown, text/plain;q=0.9, */*;q=0.1';

/** @param {import('./fetch.js').FetchResult} res */
function markdownVerdict(res) {
  if (!res.ok || res.body === '') return { isMarkdown: false, reason: res.error ?? `status ${res.status}` };
  if (looksLikeHtml(res.body)) return { isMarkdown: false, reason: 'html body' };
  if (res.contentType === 'text/markdown' || res.contentType === 'text/x-markdown') return { isMarkdown: true, reason: 'content type' };
  if (res.contentType === 'text/plain' && /^(#\s|\S.*\n\n)/.test(res.body.trimStart())) return { isMarkdown: true, reason: 'plain text that reads as markdown' };
  if (res.contentType === 'text/plain') return { isMarkdown: false, reason: 'plain text' };
  return { isMarkdown: false, reason: `content type ${res.contentType || 'unknown'}` };
}

/**
 * The .md path that would sit beside an HTML path.
 * @param {string} url
 */
export function markdownPathFor(url) {
  const u = new URL(url);
  const path = u.pathname.replace(/\/$/, '');
  if (path === '' || path === '/') return `${u.origin}/index.md`;
  if (/\.(html?|php|aspx?)$/i.test(path)) return `${u.origin}${path.replace(/\.[a-z]+$/i, '.md')}`;
  return `${u.origin}${path}.md`;
}

/**
 * Collector: three probes at most, all against the target page.
 * @param {import('./index.js').ScanContext} ctx
 */
export async function collectMarkdownAlternates(ctx) {
  const home = ctx.pages[0]?.extract;
  const probes = [];

  const negotiated = await ctx.fetcher.fetch(ctx.url, { maxBytes: ctx.budget.bytes.small, accept: MD_ACCEPT });
  probes.push({ probe: 'accept-negotiation', url: ctx.url, status: negotiated.status, contentType: negotiated.contentType, ...markdownVerdict(negotiated), sample: truncate(negotiated.body, 300) });

  const mdUrl = markdownPathFor(ctx.url);
  const md = await ctx.fetcher.fetch(mdUrl, { maxBytes: ctx.budget.bytes.small, accept: MD_ACCEPT });
  probes.push({ probe: 'md-path', url: mdUrl, status: md.status, contentType: md.contentType, ...markdownVerdict(md), sample: truncate(md.body, 300) });

  const alternates = (home?.alternates ?? []).filter((a) => a.type === 'text/markdown' || a.type === 'text/plain' || /\.md$/i.test(a.href));
  const advertised = alternates[0];
  if (advertised && advertised.href && advertised.href !== mdUrl && ctx.fetcher.remaining >= 6) {
    const res = await ctx.fetcher.fetch(advertised.href, { maxBytes: ctx.budget.bytes.small, accept: MD_ACCEPT });
    probes.push({ probe: 'link-alternate', url: advertised.href, status: res.status, contentType: res.contentType, ...markdownVerdict(res), sample: truncate(res.body, 300) });
  }

  const sampleAlternates = ctx.pages
    .slice(1)
    .flatMap((p) => (p.extract?.alternates ?? []).filter((a) => a.type === 'text/markdown' || /\.md$/i.test(a.href)).map((a) => ({ page: p.extract?.url, ...a })));

  ctx.evidence.markdown_alternates = {
    anyFound: probes.some((p) => p.isMarkdown),
    probes,
    advertisedOnHome: alternates,
    advertisedOnSamples: sampleAlternates.slice(0, 10),
  };
}

const API_PROBES = ['/openapi.json', '/swagger.json', '/.well-known/mcp.json', '/.well-known/ai-plugin.json'];
const DOC_LINK = /\b(api|apis|developers?|docs|documentation|sdk|mcp|integrations?)\b/i;

/** @param {string} body */
function summariseJson(body) {
  let doc;
  try {
    doc = JSON.parse(body);
  } catch {
    return { parsed: false };
  }
  if (!doc || typeof doc !== 'object') return { parsed: false };
  const paths = doc.paths && typeof doc.paths === 'object' ? Object.keys(doc.paths) : [];
  let operations = 0;
  let described = 0;
  for (const p of paths) {
    const item = doc.paths[p];
    if (!item || typeof item !== 'object') continue;
    for (const method of ['get', 'post', 'put', 'patch', 'delete']) {
      if (item[method]) {
        operations += 1;
        if (item[method].summary || item[method].description) described += 1;
      }
    }
  }
  return {
    parsed: true,
    openapi: doc.openapi ?? doc.swagger ?? null,
    title: doc.info?.title ?? null,
    pathCount: paths.length,
    operationCount: operations,
    describedOperations: described,
    hasSecuritySchemes: Boolean(doc.components?.securitySchemes || doc.securityDefinitions),
    topLevelKeys: Object.keys(doc).slice(0, 20),
  };
}

/**
 * Collector: standard API and MCP paths plus up to one developer link from
 * the home page.
 * @param {import('./index.js').ScanContext} ctx
 */
export async function collectApiSurface(ctx) {
  const home = ctx.pages[0]?.extract;
  const probes = await Promise.all(
    API_PROBES.map(async (path) => {
      const url = `${ctx.origin}${path}`;
      const res = await ctx.fetcher.fetch(url, { maxBytes: ctx.budget.bytes.text, accept: 'application/json, application/yaml, */*;q=0.5' });
      const usable = res.ok && res.body !== '' && !looksLikeHtml(res.body);
      return {
        path,
        url,
        status: res.status,
        error: res.error,
        contentType: res.contentType,
        found: usable,
        summary: usable ? summariseJson(res.body) : null,
        sample: usable ? truncate(res.body, 400) : '',
      };
    }),
  );

  const docLinks = (home?.links ?? []).filter((l) => DOC_LINK.test(`${l.text} ${new URL(l.href).pathname}`)).slice(0, 5);
  /** @type {Array<Record<string, unknown>>} */
  const docPages = [];
  const first = docLinks[0];
  if (first && ctx.fetcher.remaining >= 3) {
    const res = await ctx.fetcher.fetch(first.href, { maxBytes: ctx.budget.bytes.small });
    docPages.push({ url: first.href, text: first.text, status: res.status, contentType: res.contentType, error: res.error, sample: truncate(res.body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' '), 600) });
  }

  const text = ctx.pages.map((p) => p.extract?.text ?? '').join('\n');
  const mentions = {
    api: (text.match(/\bAPIs?\b/g) ?? []).length,
    openapi: (text.match(/\bOpenAPI\b|\bSwagger\b/gi) ?? []).length,
    mcp: (text.match(/\bMCP\b|Model Context Protocol/g) ?? []).length,
    developer: (text.match(/\bdevelopers?\b/gi) ?? []).length,
    llmsTxtMentionsMcp: /\bMCP\b|Model Context Protocol/.test(ctx.llmsTxt?.body ?? ''),
  };

  ctx.evidence.api_surface = { probes, docLinks, docPages, mentions };
}
