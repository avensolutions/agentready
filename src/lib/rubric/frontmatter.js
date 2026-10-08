/**
 * Strict parser for the YAML subset used in rubric frontmatter.
 *
 * Supported:
 * - `key: value` where value is a bare string, a quoted string ('...' or
 *   "..."), a number, true or false
 * - `key: [a, b, c]` flow lists of those scalars
 * - `key: { a: 1, b: two }` flow maps of those scalars
 * - blank lines and `#` comment lines
 *
 * Anything else (block lists, nested maps, multi-line strings, duplicate
 * keys) is an error. The subset is deliberately small so a typo in a rubric
 * file fails the build rather than silently changing meaning.
 */

export class FrontmatterError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = 'FrontmatterError';
  }
}

const KEY_RE = /^([A-Za-z_][A-Za-z0-9_-]*):(?:\s+(.*))?$/;
const MAP_ENTRY_RE = /^([A-Za-z_][A-Za-z0-9_-]*):\s*(.+)$/;
const NUMBER_RE = /^-?(?:\d+\.?\d*|\.\d+)$/;

/**
 * Split a document into its frontmatter block and body.
 * @param {string} text
 * @returns {{ frontmatter: string, body: string }}
 */
export function splitFrontmatter(text) {
  const normalised = text.replace(/\r\n/g, '\n');
  if (!normalised.startsWith('---\n')) {
    throw new FrontmatterError('document must start with a "---" line');
  }
  const end = normalised.indexOf('\n---', 4);
  if (end === -1) {
    throw new FrontmatterError('frontmatter is not closed with a "---" line');
  }
  const closeLineEnd = normalised.indexOf('\n', end + 1);
  const closeLine = normalised.slice(end + 1, closeLineEnd === -1 ? undefined : closeLineEnd);
  if (closeLine.trim() !== '---') {
    throw new FrontmatterError('frontmatter is not closed with a "---" line');
  }
  return {
    frontmatter: normalised.slice(4, end),
    body: closeLineEnd === -1 ? '' : normalised.slice(closeLineEnd + 1),
  };
}

/**
 * @param {string} raw
 * @param {string} key
 * @returns {string | number | boolean}
 */
function parseScalar(raw, key) {
  const value = raw.trim();
  if (value === '') {
    throw new FrontmatterError(`"${key}" has no value`);
  }
  if (
    (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
    (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
  ) {
    return value.slice(1, -1);
  }
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (NUMBER_RE.test(value)) return Number(value);
  if (value.startsWith('[') || value.startsWith('{') || value.startsWith('|') || value.startsWith('>')) {
    throw new FrontmatterError(`"${key}" uses unsupported YAML syntax: ${value}`);
  }
  return value;
}

/**
 * @param {string} raw
 * @param {string} key
 * @returns {Array<string | number | boolean>}
 */
function parseFlowList(raw, key) {
  const inner = raw.trim().slice(1, -1).trim();
  if (inner === '') return [];
  if (inner.includes('[') || inner.includes('{')) {
    throw new FrontmatterError(`"${key}" nested lists are not supported`);
  }
  return inner.split(',').map((item) => {
    if (item.trim() === '') {
      throw new FrontmatterError(`"${key}" has an empty list item`);
    }
    return parseScalar(item, key);
  });
}

/**
 * @param {string} raw
 * @param {string} key
 * @returns {Record<string, string | number | boolean>}
 */
function parseFlowMap(raw, key) {
  const inner = raw.trim().slice(1, -1).trim();
  /** @type {Record<string, string | number | boolean>} */
  const out = {};
  if (inner === '') return out;
  if (inner.includes('[') || inner.includes('{')) {
    throw new FrontmatterError(`"${key}" nested maps are not supported`);
  }
  for (const item of inner.split(',')) {
    const match = MAP_ENTRY_RE.exec(item.trim());
    if (!match) {
      throw new FrontmatterError(`"${key}" map entries must look like "name: value", got "${item.trim()}"`);
    }
    const [, name, value] = match;
    if (Object.prototype.hasOwnProperty.call(out, name)) {
      throw new FrontmatterError(`"${key}" has a duplicate map key "${name}"`);
    }
    out[name] = parseScalar(value, `${key}.${name}`);
  }
  return out;
}

/**
 * Parse a document with frontmatter.
 * @param {string} text
 * @returns {{ data: Record<string, string | number | boolean | Array<string | number | boolean> | Record<string, string | number | boolean>>, body: string }}
 */
export function parseFrontmatter(text) {
  const { frontmatter, body } = splitFrontmatter(text);
  /** @type {Record<string, any>} */
  const data = {};
  const lines = frontmatter.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.trim() === '' || line.trim().startsWith('#')) continue;
    if (/^\s/.test(line)) {
      throw new FrontmatterError(`line ${i + 1}: indented lines are not supported`);
    }
    const match = KEY_RE.exec(line);
    if (!match) {
      throw new FrontmatterError(`line ${i + 1}: expected "key: value", got "${line}"`);
    }
    const [, key, rawValue = ''] = match;
    if (Object.prototype.hasOwnProperty.call(data, key)) {
      throw new FrontmatterError(`line ${i + 1}: duplicate key "${key}"`);
    }
    const trimmed = rawValue.trim();
    if (trimmed.startsWith('[')) {
      if (!trimmed.endsWith(']')) {
        throw new FrontmatterError(`line ${i + 1}: "${key}" list is not closed`);
      }
      data[key] = parseFlowList(trimmed, key);
    } else if (trimmed.startsWith('{')) {
      if (!trimmed.endsWith('}')) {
        throw new FrontmatterError(`line ${i + 1}: "${key}" map is not closed`);
      }
      data[key] = parseFlowMap(trimmed, key);
    } else {
      data[key] = parseScalar(trimmed, key);
    }
  }
  return { data, body };
}
