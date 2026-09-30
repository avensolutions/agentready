import { countWords, decodeEntities, tidyText } from './text.js';

/**
 * Single-pass page extraction with HTMLRewriter. No DOM is built; handlers
 * accumulate what the checks need while the HTML streams through.
 */

/**
 * @typedef {Object} FormField
 * @property {string} tag
 * @property {string} type
 * @property {string} name
 */

/**
 * @typedef {Object} FormExtract
 * @property {string} action  resolved, '' when absent
 * @property {string} method  upper-case, GET when absent
 * @property {string} id
 * @property {FormField[]} fields
 * @property {boolean} hasSubmit
 */

/**
 * @typedef {Object} PageExtract
 * @property {string} url
 * @property {string} lang
 * @property {string} title
 * @property {string} description
 * @property {string} canonical
 * @property {string} metaRobots
 * @property {Record<string, string>} og  og:* properties without the prefix
 * @property {Record<string, string>} twitter  twitter:* names without the prefix
 * @property {Array<{ level: number, text: string }>} headings
 * @property {Record<string, number>} landmarks
 * @property {string} text  visible text, block-separated, capped
 * @property {boolean} textTruncated
 * @property {number} words  words in the visible text (before the cap)
 * @property {number} mainWords  words inside main, article or role=main
 * @property {Array<{ href: string, text: string }>} links  absolute, deduplicated, capped
 * @property {number} linkCount
 * @property {Array<{ type: string, href: string, hreflang: string }>} alternates  link rel=alternate
 * @property {string[]} jsonLd  raw JSON-LD script bodies, capped
 * @property {number} microdataItems
 * @property {number} scripts
 * @property {number} externalScripts
 * @property {number} scriptChars  inline script characters
 * @property {number} styleChars  inline style characters
 * @property {string} noscript  text inside noscript, capped
 * @property {FormExtract[]} forms
 * @property {Array<{ kind: string, src: string }>} embeds  third-party form or booking embeds
 * @property {string[]} mailto
 * @property {string[]} tel
 */

const BLOCK_SELECTOR =
  'p, div, li, ul, ol, h1, h2, h3, h4, h5, h6, br, tr, td, th, section, article, header, footer, nav, main, aside, blockquote, pre, table, dl, dt, dd, figure, figcaption, hr, form, fieldset, legend, details, summary, address, option, label';
const LANDMARKS = ['header', 'nav', 'main', 'footer', 'article', 'aside'];
const EMBED_HINTS = /hubspot|hsforms|hs-form|typeform|jotform|calendly|cal\.com|acuityscheduling|hubspotusercontent|meetings\.hubspot|formstack|wufoo|gravityforms|tally\.so|zohoforms|cognitoforms|paperform/i;

/** @param {string} raw @param {string} base */
function resolve(raw, base) {
  try {
    return new URL(decodeEntities(raw.trim()), base).toString();
  } catch {
    return '';
  }
}

/**
 * @param {string} html
 * @param {string} url  the page URL, used to resolve links
 * @param {Object} [limits]
 * @param {number} [limits.textChars]
 * @param {number} [limits.links]
 * @param {number} [limits.jsonLdBlocks]
 * @param {number} [limits.jsonLdChars]
 * @returns {Promise<PageExtract>}
 */
export async function extractPage(html, url, { textChars = 20_000, links = 150, jsonLdBlocks = 8, jsonLdChars = 12_000 } = {}) {
  /** @type {PageExtract} */
  const out = {
    url,
    lang: '',
    title: '',
    description: '',
    canonical: '',
    metaRobots: '',
    og: {},
    twitter: {},
    headings: [],
    landmarks: Object.fromEntries(LANDMARKS.map((l) => [l, 0])),
    text: '',
    textTruncated: false,
    words: 0,
    mainWords: 0,
    links: [],
    linkCount: 0,
    alternates: [],
    jsonLd: [],
    microdataItems: 0,
    scripts: 0,
    externalScripts: 0,
    scriptChars: 0,
    styleChars: 0,
    noscript: '',
    forms: [],
    embeds: [],
    mailto: [],
    tel: [],
  };

  let base = url;
  let text = '';
  let textChars_ = 0;
  let mainDepth = 0;
  let skipDepth = 0; // inside script, style, template, svg, noscript, head
  let inTitle = false;
  let title = '';
  /** @type {{ level: number, text: string } | null} */
  let heading = null;
  /** @type {{ href: string, text: string } | null} */
  let link = null;
  /** @type {FormExtract | null} */
  let form = null;
  /** @type {string | null} */
  let jsonLd = null;
  let noscript = '';
  const seenLinks = new Set();

  /** @param {string} s */
  function pushText(s) {
    if (s === '') return;
    if (mainDepth > 0) out.mainWords += countWords(s);
    out.words += countWords(s);
    if (textChars_ >= textChars) {
      out.textTruncated = true;
      return;
    }
    text += s;
    textChars_ += s.length;
  }
  function pushBreak() {
    if (textChars_ < textChars && !text.endsWith('\n')) {
      text += '\n';
      textChars_ += 1;
    }
  }

  const rewriter = new HTMLRewriter()
    .on('html', {
      element(el) {
        out.lang = (el.getAttribute('lang') ?? '').trim();
      },
    })
    .on('base[href]', {
      element(el) {
        const href = resolve(el.getAttribute('href') ?? '', base);
        if (href) base = href;
      },
    })
    .on('title', {
      element(el) {
        inTitle = true;
        el.onEndTag(() => {
          inTitle = false;
          if (!out.title) out.title = tidyText(decodeEntities(title)).replace(/\n/g, ' ');
        });
      },
      text(chunk) {
        if (inTitle) title += chunk.text;
      },
    })
    .on('meta', {
      element(el) {
        const name = (el.getAttribute('name') ?? '').trim().toLowerCase();
        const property = (el.getAttribute('property') ?? '').trim().toLowerCase();
        const content = decodeEntities((el.getAttribute('content') ?? '').trim());
        if (name === 'description' && !out.description) out.description = content;
        else if (name === 'robots') out.metaRobots = content;
        else if (property.startsWith('og:') && !(property.slice(3) in out.og)) out.og[property.slice(3)] = content;
        else if (name.startsWith('twitter:') && !(name.slice(8) in out.twitter)) out.twitter[name.slice(8)] = content;
      },
    })
    .on('link[rel]', {
      element(el) {
        const rel = (el.getAttribute('rel') ?? '').trim().toLowerCase().split(/\s+/);
        const href = el.getAttribute('href') ?? '';
        if (rel.includes('canonical') && !out.canonical) out.canonical = resolve(href, base);
        if (rel.includes('alternate')) {
          out.alternates.push({
            type: (el.getAttribute('type') ?? '').trim().toLowerCase(),
            href: resolve(href, base),
            hreflang: (el.getAttribute('hreflang') ?? '').trim().toLowerCase(),
          });
        }
      },
    })
    .on('script', {
      element(el) {
        out.scripts += 1;
        const type = (el.getAttribute('type') ?? '').trim().toLowerCase();
        if (el.getAttribute('src')) out.externalScripts += 1;
        const isJsonLd = type === 'application/ld+json';
        if (isJsonLd) jsonLd = '';
        skipDepth += 1;
        el.onEndTag(() => {
          skipDepth -= 1;
          if (isJsonLd && jsonLd !== null) {
            if (out.jsonLd.length < jsonLdBlocks) out.jsonLd.push(jsonLd.slice(0, jsonLdChars).trim());
            jsonLd = null;
          }
        });
      },
      text(chunk) {
        if (jsonLd !== null) {
          if (jsonLd.length < jsonLdChars) jsonLd += chunk.text;
        } else {
          out.scriptChars += chunk.text.length;
        }
      },
    })
    .on('style', {
      element(el) {
        skipDepth += 1;
        el.onEndTag(() => {
          skipDepth -= 1;
        });
      },
      text(chunk) {
        out.styleChars += chunk.text.length;
      },
    })
    .on('template, svg, head', {
      element(el) {
        skipDepth += 1;
        el.onEndTag(() => {
          skipDepth -= 1;
        });
      },
    })
    .on('noscript', {
      element(el) {
        skipDepth += 1;
        el.onEndTag(() => {
          skipDepth -= 1;
        });
      },
      text(chunk) {
        if (noscript.length < 600) noscript += chunk.text;
      },
    })
    .on('main, article, [role="main"]', {
      element(el) {
        mainDepth += 1;
        el.onEndTag(() => {
          mainDepth -= 1;
        });
      },
    })
    .on(LANDMARKS.join(', '), {
      element(el) {
        out.landmarks[el.tagName] += 1;
      },
    })
    .on('[itemscope]', {
      element() {
        out.microdataItems += 1;
      },
    })
    .on('h1, h2, h3, h4, h5, h6', {
      element(el) {
        heading = { level: Number(el.tagName[1]), text: '' };
        el.onEndTag(() => {
          if (heading && out.headings.length < 200) {
            const t = tidyText(decodeEntities(heading.text)).replace(/\n/g, ' ');
            out.headings.push({ level: heading.level, text: t.slice(0, 200) });
          }
          heading = null;
        });
      },
      text(chunk) {
        if (heading) heading.text += chunk.text;
      },
    })
    .on('a[href]', {
      element(el) {
        // a link is a word of its own even when the markup has no
        // whitespace between adjacent links (only one end-tag handler is
        // allowed per element, so the closing space is added below)
        if (skipDepth === 0) pushText(' ');
        const raw = (el.getAttribute('href') ?? '').trim();
        const lower = raw.toLowerCase();
        if (lower.startsWith('mailto:')) {
          const addr = decodeEntities(raw.slice(7).split('?')[0]);
          if (addr && !out.mailto.includes(addr) && out.mailto.length < 20) out.mailto.push(addr);
          return;
        }
        if (lower.startsWith('tel:')) {
          const num = raw.slice(4);
          if (num && !out.tel.includes(num) && out.tel.length < 20) out.tel.push(num);
          return;
        }
        if (lower.startsWith('javascript:') || lower.startsWith('#') || raw === '') return;
        const href = resolve(raw, base);
        if (!href) return;
        out.linkCount += 1;
        link = { href, text: '' };
        el.onEndTag(() => {
          if (link) {
            const t = tidyText(decodeEntities(link.text)).replace(/\n/g, ' ').slice(0, 120);
            const key = link.href.replace(/#.*$/, '');
            if (!seenLinks.has(key) && out.links.length < links) {
              seenLinks.add(key);
              out.links.push({ href: key, text: t });
            }
          }
          link = null;
          if (skipDepth === 0) pushText(' ');
        });
      },
      text(chunk) {
        if (link) link.text += chunk.text;
      },
    })
    .on('form', {
      element(el) {
        form = {
          action: resolve(el.getAttribute('action') ?? '', base),
          method: (el.getAttribute('method') ?? 'GET').trim().toUpperCase(),
          id: (el.getAttribute('id') ?? el.getAttribute('name') ?? '').trim(),
          fields: [],
          hasSubmit: false,
        };
        const current = form;
        el.onEndTag(() => {
          if (out.forms.length < 20) out.forms.push(current);
          form = null;
        });
      },
    })
    .on('input, select, textarea, button', {
      element(el) {
        if (!form) return;
        const type = (el.getAttribute('type') ?? (el.tagName === 'button' ? 'submit' : el.tagName)).trim().toLowerCase();
        if (type === 'submit' || type === 'image') form.hasSubmit = true;
        if (type === 'hidden' && form.fields.length > 30) return;
        if (form.fields.length < 40) form.fields.push({ tag: el.tagName, type, name: (el.getAttribute('name') ?? '').trim() });
      },
    })
    .on('iframe[src], div[class], div[data-form-id], div[data-portal-id], div[data-tf-live], div[data-tf-widget]', {
      element(el) {
        const src = el.getAttribute('src') ?? '';
        const cls = el.getAttribute('class') ?? '';
        const marker = src || cls || 'data-form';
        if (out.embeds.length < 10 && EMBED_HINTS.test(marker + ' ' + (el.getAttribute('data-form-id') ? 'hs-form' : ''))) {
          const hint = EMBED_HINTS.exec(marker);
          out.embeds.push({ kind: (hint ? hint[0] : 'form').toLowerCase(), src: src ? resolve(src, base) : '' });
        }
      },
    })
    .on(BLOCK_SELECTOR, {
      element() {
        pushBreak();
      },
    })
    .on('button, img[alt]', {
      // buttons are words of their own even when the markup has no
      // whitespace around them; image alt text stands in for the image
      element(el) {
        if (skipDepth > 0) return;
        pushText(' ');
        if (el.tagName === 'img') {
          const alt = (el.getAttribute('alt') ?? '').trim();
          if (alt) pushText(decodeEntities(alt));
        } else {
          el.onEndTag(() => pushText(' '));
        }
      },
    })
    .on('body', {
      text(chunk) {
        if (skipDepth > 0 || inTitle) return;
        pushText(decodeEntities(chunk.text));
      },
    });

  const transformed = rewriter.transform(new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } }));
  // handlers run as the body streams; drain it without keeping the output
  const reader = transformed.body?.getReader();
  if (reader) {
    for (;;) {
      const { done } = await reader.read();
      if (done) break;
    }
  }

  out.text = tidyText(text);
  out.noscript = tidyText(decodeEntities(noscript)).slice(0, 500);
  return out;
}
