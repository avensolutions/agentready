/**
 * Registry of evidence keys. Each collector produces exactly one key. A check
 * may only name keys listed here; the rubric validator enforces it, so adding
 * a collector means adding its key here first (and documenting it in
 * rubric/README.md, which a test checks).
 *
 * @type {Record<string, string>}
 */
export const EVIDENCE_KEYS = {
  robots_txt:
    'robots.txt: HTTP status, the body (capped), the groups that apply to common AI user agents and to the wildcard, and any Sitemap directives.',
  sitemap:
    'Sitemap discovery: the URL tried (from robots.txt or /sitemap.xml), HTTP status, whether it parsed as a sitemap or sitemap index, URL count, a sample of URLs and whether lastmod dates are present.',
  llms_txt:
    '/llms.txt: HTTP status, content type, size and the body (capped).',
  llms_full_txt:
    '/llms-full.txt: HTTP status, content type, size, the headings found and the first part of the body (capped).',
  home_html:
    'The home page as served without JavaScript: final URL, status, title, meta description, canonical, heading outline, landmark counts, main text (capped), word counts, link sample, script and noscript signals.',
  pages:
    'A small sample of linked pages with the same extraction as home_html, in a smaller form.',
  headers:
    'Response headers of the home page and the sampled pages that matter to agents: content-type, cache-control, link, x-robots-tag, content-language, vary, server.',
  markdown_alternates:
    'Probes for markdown versions of pages: Accept: text/markdown negotiation, .md paths alongside HTML paths, and link rel="alternate" elements, with status and content type of each.',
  structured_data:
    'JSON-LD blocks (parsed, with type and top-level properties), Open Graph and Twitter tags, and microdata presence for the home page and sampled pages.',
  api_surface:
    'Probes for API and agent surfaces: OpenAPI and Swagger paths, .well-known entries, documentation paths, MCP endpoints, and links in the page text that point at developer documentation, with status, content type and a summary of any document found.',
  forms:
    'Forms found on the home page and sampled pages: action, method, field names and types, whether submission depends on script or a third-party embed, plus mailto and tel links and booking links.',
  site_text:
    'The readable text of the home page and sampled pages, concatenated with a source URL heading per page, capped in size. Used for answerability.',
};

/** @type {string[]} */
export const EVIDENCE_KEY_NAMES = Object.keys(EVIDENCE_KEYS);
