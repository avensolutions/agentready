import { truncate } from './text.js';

/**
 * Evidence keys derived from the fetched pages. These do not fetch anything;
 * they shape what the home page and sample extraction produced into the
 * keys the checks name.
 */

const BOOKING = /calendly\.com|meetings\.hubspot|meetings-[a-z0-9]+\.hubspot|cal\.com\/|acuityscheduling|savvycal|tidycal|zcal\.co|youcanbook\.me|booking|book-a-call|schedule/i;

/** @param {import('./index.js').ScanPage} page */
function pageSummary(page) {
  const e = page.extract;
  const f = page.fetch;
  if (!e) {
    return { url: f.url, finalUrl: f.finalUrl, status: f.status, error: f.error ?? null, contentType: f.contentType, note: 'not an HTML page or not fetched' };
  }
  return {
    url: f.url,
    finalUrl: f.finalUrl,
    status: f.status,
    redirects: f.redirects,
    htmlBytes: f.bytes,
    htmlTruncated: f.truncated,
    lang: e.lang,
    title: e.title,
    description: e.description,
    canonical: e.canonical,
    metaRobots: e.metaRobots,
    headings: e.headings.slice(0, page.role === 'home' ? 60 : 30),
    landmarks: e.landmarks,
    words: e.words,
    mainWords: e.mainWords,
    textTruncated: e.textTruncated,
    linkCount: e.linkCount,
    links: e.links.slice(0, page.role === 'home' ? 40 : 15),
    scripts: e.scripts,
    externalScripts: e.externalScripts,
    scriptChars: e.scriptChars,
    styleChars: e.styleChars,
    noscript: e.noscript,
    text: truncate(e.text, page.role === 'home' ? 12_000 : 4000),
  };
}

/**
 * @param {string} raw
 */
function summariseJsonLd(raw) {
  let doc;
  try {
    doc = JSON.parse(raw);
  } catch {
    return { parsed: false, types: [], keys: [], raw: truncate(raw, 800) };
  }
  const nodes = Array.isArray(doc) ? doc : doc && typeof doc === 'object' && Array.isArray(doc['@graph']) ? doc['@graph'] : [doc];
  const types = [];
  const keys = new Set();
  for (const node of nodes) {
    if (!node || typeof node !== 'object') continue;
    const t = node['@type'];
    if (Array.isArray(t)) types.push(...t.map(String));
    else if (t) types.push(String(t));
    for (const k of Object.keys(node)) keys.add(k);
  }
  return { parsed: true, types: types.slice(0, 20), keys: [...keys].slice(0, 40), raw: truncate(raw, 2500) };
}

/**
 * Fill home_html, pages, headers, structured_data, forms and site_text.
 * @param {import('./index.js').ScanContext} ctx
 */
export function assembleEvidence(ctx) {
  const [home, ...samples] = ctx.pages;
  if (!home?.extract) return;

  ctx.evidence.home_html = pageSummary(home);
  ctx.evidence.pages = samples.map(pageSummary);

  ctx.evidence.headers = ctx.pages.map((p) => ({ url: p.fetch.finalUrl, status: p.fetch.status, headers: p.fetch.headers }));

  ctx.evidence.structured_data = ctx.pages
    .filter((p) => p.extract)
    .map((p) => ({
      url: p.fetch.finalUrl,
      jsonLd: (p.extract?.jsonLd ?? []).map(summariseJsonLd),
      og: p.extract?.og ?? {},
      twitter: p.extract?.twitter ?? {},
      microdataItems: p.extract?.microdataItems ?? 0,
    }));

  ctx.evidence.forms = {
    pages: ctx.pages
      .filter((p) => p.extract)
      .map((p) => ({
        url: p.fetch.finalUrl,
        forms: (p.extract?.forms ?? []).map((f) => ({
          ...f,
          scriptOnly: f.action === '' || /^javascript:/i.test(f.action) || (f.fields.length === 0 && !f.hasSubmit),
        })),
        embeds: p.extract?.embeds ?? [],
        mailto: p.extract?.mailto ?? [],
        tel: p.extract?.tel ?? [],
        bookingLinks: (p.extract?.links ?? []).filter((l) => BOOKING.test(`${l.href} ${l.text}`)).slice(0, 10),
      })),
  };

  const parts = [];
  let total = 0;
  const caps = { home: 12_000, sample: 5000, total: 28_000 };
  for (const p of ctx.pages) {
    if (!p.extract) continue;
    const cap = Math.min(p.role === 'home' ? caps.home : caps.sample, caps.total - total);
    if (cap <= 0) break;
    const text = truncate(p.extract.text, cap);
    total += text.length;
    parts.push(`## Source: ${p.fetch.finalUrl}\n\n${text}`);
  }
  ctx.evidence.site_text = {
    pageCount: parts.length,
    chars: total,
    text: parts.join('\n\n'),
  };
}
