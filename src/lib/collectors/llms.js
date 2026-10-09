import { countWords, looksLikeHtml, truncate } from './text.js';

/** Collectors for the llms.txt and llms-full.txt conventions. */

const TEXT_ACCEPT = 'text/markdown, text/plain;q=0.9, */*;q=0.5';

/** @param {import('./fetch.js').FetchResult} res */
function isTextFile(res) {
  if (!res.ok || res.body === '') return false;
  if (res.contentType.startsWith('text/html') || res.contentType.startsWith('application/xhtml')) return false;
  return !looksLikeHtml(res.body);
}

/**
 * @param {import('./index.js').ScanContext} ctx
 */
export async function collectLlmsTxt(ctx) {
  const url = `${ctx.origin}/llms.txt`;
  const res = await ctx.fetcher.fetch(url, { maxBytes: ctx.budget.bytes.text, accept: TEXT_ACCEPT });
  const present = isTextFile(res);
  const body = present ? res.body : '';
  const links = [...body.matchAll(/\[([^\]]*)\]\(([^)\s]+)\)/g)].map((m) => ({ text: m[1], href: m[2] }));
  ctx.llmsTxt = { present, body };
  ctx.evidence.llms_txt = {
    url,
    status: res.status,
    error: res.error,
    contentType: res.contentType,
    bytes: res.bytes,
    truncated: res.truncated,
    present,
    servedHtmlInstead: res.ok && !present && res.body !== '',
    hasH1: /^#\s+\S/m.test(body),
    hasBlockquote: /^>\s*\S/m.test(body),
    linkCount: links.length,
    links: links.slice(0, 40),
    mentionsLlmsFull: /llms-full\.txt/i.test(body),
    body: truncate(body, 12_000),
  };
}

/**
 * @param {import('./index.js').ScanContext} ctx
 */
export async function collectLlmsFullTxt(ctx) {
  const url = `${ctx.origin}/llms-full.txt`;
  const res = await ctx.fetcher.fetch(url, { maxBytes: ctx.budget.bytes.text, accept: TEXT_ACCEPT });
  const present = isTextFile(res);
  const body = present ? res.body : '';
  const headings = [...body.matchAll(/^(#{1,6})\s+(.+)$/gm)].map((m) => `${m[1]} ${m[2].trim()}`.slice(0, 120));
  const sourceUrls = (body.match(/https?:\/\/[^\s)]+/g) ?? []).length;
  ctx.evidence.llms_full_txt = {
    url,
    status: res.status,
    error: res.error,
    contentType: res.contentType,
    bytes: res.bytes,
    truncated: res.truncated,
    present,
    servedHtmlInstead: res.ok && !present && res.body !== '',
    words: countWords(body),
    headingCount: headings.length,
    headings: headings.slice(0, 40),
    urlCount: sourceUrls,
    linkedFromLlmsTxt: ctx.llmsTxt?.present === true && /llms-full\.txt/i.test(ctx.llmsTxt.body),
    head: truncate(body, 6000),
  };
}
