/** Small text helpers shared by the collectors. No DOM, no dependencies. */

const NAMED_ENTITIES = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  copy: '\u00a9',
  reg: '\u00ae',
  trade: '\u2122',
  hellip: '\u2026',
  mdash: '\u2014',
  ndash: '\u2013',
  lsquo: '\u2018',
  rsquo: '\u2019',
  ldquo: '\u201c',
  rdquo: '\u201d',
  bull: '\u2022',
  middot: '\u00b7',
  laquo: '\u00ab',
  raquo: '\u00bb',
  euro: '\u20ac',
  pound: '\u00a3',
  yen: '\u00a5',
  deg: '\u00b0',
  times: '\u00d7',
};

/**
 * Decode the HTML entities that occur in ordinary page text. Unknown named
 * entities are left as they are.
 * @param {string} s
 */
export function decodeEntities(s) {
  if (!s.includes('&')) return s;
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, body) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return match;
      try {
        return String.fromCodePoint(code);
      } catch {
        return match;
      }
    }
    const named = NAMED_ENTITIES[body.toLowerCase()];
    return named ?? match;
  });
}

/**
 * Collapse runs of whitespace inside lines and drop blank lines.
 * @param {string} s
 */
export function tidyText(s) {
  return s
    .split('\n')
    .map((line) => line.replace(/[ \t\r\f\v\u00a0]+/g, ' ').trim())
    .filter((line) => line !== '')
    .join('\n');
}

/** @param {string} s */
export function countWords(s) {
  const m = s.match(/\S+/g);
  return m ? m.length : 0;
}

/**
 * Cut a string at a byte-ish length without splitting a surrogate pair.
 * @param {string} s
 * @param {number} max
 */
export function truncate(s, max) {
  if (s.length <= max) return s;
  let end = max;
  const code = s.charCodeAt(end - 1);
  if (code >= 0xd800 && code <= 0xdbff) end -= 1;
  return s.slice(0, end);
}

/**
 * True when a body that claims to be text is really an HTML page (a catch-all
 * route answering 200 for /llms.txt, for example).
 * @param {string} body
 */
export function looksLikeHtml(body) {
  const head = body.slice(0, 512).trimStart().toLowerCase();
  return head.startsWith('<!doctype html') || head.startsWith('<html') || /<(head|body|div|script)[\s>]/.test(head);
}
