import { FrontmatterError, parseFrontmatter } from './frontmatter.js';

/**
 * @typedef {Object} RubricFile
 * @property {string} path  path ending in dimensions/<id>.md or checks/<id>.md
 * @property {string} text  file contents
 */

/**
 * @typedef {Object} Check
 * @property {string} id
 * @property {string} dimension
 * @property {string} title
 * @property {number} weight
 * @property {number} order
 * @property {string} progress
 * @property {string[]} evidence
 * @property {string} instructions  the markdown body, given to the assessor
 * @property {string} path
 */

/**
 * @typedef {Object} Dimension
 * @property {string} id
 * @property {string} title
 * @property {number} weight
 * @property {number} order
 * @property {string} [progress]
 * @property {string} description  the markdown body, shown in the report
 * @property {Check[]} checks
 * @property {string} path
 */

/**
 * @typedef {Object} Rubric
 * @property {Dimension[]} dimensions  sorted by order, each with its checks sorted by order then id
 * @property {Check[]} checks  every check, in dimension order
 * @property {Map<string, Check>} checkById
 * @property {Map<string, Dimension>} dimensionById
 */

export class RubricError extends Error {
  /** @param {string[]} errors */
  constructor(errors) {
    super(`Rubric validation failed with ${errors.length} error${errors.length === 1 ? '' : 's'}:\n- ${errors.join('\n- ')}`);
    this.name = 'RubricError';
    this.errors = errors;
  }
}

/** Scores every check must define, one line each: `- N: ...` */
export const SCORE_LEVELS = [0, 1, 2, 3, 4];

const ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * @param {string} path
 * @returns {{ kind: 'dimension' | 'check', stem: string } | null}
 */
function classify(path) {
  const match = /(?:^|\/)(dimensions|checks)\/([^/]+)\.md$/.exec(path.replace(/\\/g, '/'));
  if (!match) return null;
  return { kind: match[1] === 'dimensions' ? 'dimension' : 'check', stem: match[2] };
}

/**
 * @param {Record<string, any>} data
 * @param {string} key
 * @param {'string' | 'number' | 'integer' | 'string[]'} type
 * @param {string} where
 * @param {string[]} errors
 * @param {{ optional?: boolean }} [opts]
 * @returns {any}
 */
function field(data, key, type, where, errors, opts = {}) {
  const value = data[key];
  if (value === undefined) {
    if (!opts.optional) errors.push(`${where}: missing required field "${key}"`);
    return undefined;
  }
  switch (type) {
    case 'string':
      if (typeof value !== 'string' || value.trim() === '') {
        errors.push(`${where}: "${key}" must be a non-empty string`);
        return undefined;
      }
      return value.trim();
    case 'number':
      if (typeof value !== 'number' || !(value > 0)) {
        errors.push(`${where}: "${key}" must be a number greater than 0`);
        return undefined;
      }
      return value;
    case 'integer':
      if (!Number.isInteger(value)) {
        errors.push(`${where}: "${key}" must be an integer`);
        return undefined;
      }
      return value;
    case 'string[]':
      if (!Array.isArray(value) || value.length === 0 || value.some((v) => typeof v !== 'string')) {
        errors.push(`${where}: "${key}" must be a non-empty list of strings`);
        return undefined;
      }
      return value;
    default:
      return value;
  }
}

/**
 * Parse and validate rubric files. Throws RubricError listing every problem
 * found, so one build failure shows all of them.
 *
 * @param {RubricFile[]} files
 * @param {string[]} evidenceKeys  the known evidence keys
 * @returns {Rubric}
 */
export function parseRubric(files, evidenceKeys) {
  /** @type {string[]} */
  const errors = [];
  /** @type {Dimension[]} */
  const dimensions = [];
  /** @type {Check[]} */
  const checks = [];
  const known = new Set(evidenceKeys);

  for (const file of files) {
    const where = file.path;
    const info = classify(file.path);
    if (!info) {
      errors.push(`${where}: not under dimensions/ or checks/`);
      continue;
    }
    let parsed;
    try {
      parsed = parseFrontmatter(file.text);
    } catch (err) {
      errors.push(`${where}: ${err instanceof FrontmatterError ? err.message : String(err)}`);
      continue;
    }
    const { data, body } = parsed;
    const description = body.trim();
    if (description === '') errors.push(`${where}: body is empty`);

    const id = field(data, 'id', 'string', where, errors);
    if (id !== undefined) {
      if (!ID_RE.test(id)) errors.push(`${where}: id "${id}" must be lower-case kebab-case`);
      if (id !== info.stem) errors.push(`${where}: id "${id}" does not match file name "${info.stem}"`);
    }
    const title = field(data, 'title', 'string', where, errors);
    const weight = field(data, 'weight', 'number', where, errors);
    const order = field(data, 'order', 'integer', where, errors, { optional: info.kind === 'check' });
    const progress = field(data, 'progress', 'string', where, errors, { optional: info.kind === 'dimension' });

    if (info.kind === 'dimension') {
      const allowed = new Set(['id', 'title', 'weight', 'order', 'progress']);
      for (const key of Object.keys(data)) {
        if (!allowed.has(key)) errors.push(`${where}: unknown field "${key}"`);
      }
      if (id && title && weight && order !== undefined) {
        dimensions.push({ id, title, weight, order, progress, description, checks: [], path: file.path });
      }
      continue;
    }

    const allowed = new Set(['id', 'dimension', 'title', 'weight', 'order', 'progress', 'evidence']);
    for (const key of Object.keys(data)) {
      if (!allowed.has(key)) errors.push(`${where}: unknown field "${key}"`);
    }
    const dimension = field(data, 'dimension', 'string', where, errors);
    const evidence = field(data, 'evidence', 'string[]', where, errors);
    if (evidence) {
      const seen = new Set();
      for (const key of evidence) {
        if (!known.has(key)) errors.push(`${where}: unknown evidence key "${key}"`);
        if (seen.has(key)) errors.push(`${where}: evidence key "${key}" listed twice`);
        seen.add(key);
      }
    }
    for (const level of SCORE_LEVELS) {
      const count = description.split('\n').filter((line) => new RegExp(`^-\\s+${level}:`).test(line.trim())).length;
      if (count !== 1) errors.push(`${where}: scoring must define level ${level} exactly once ("- ${level}: ...")`);
    }
    if (id && dimension && title && weight && progress && evidence) {
      checks.push({
        id,
        dimension,
        title,
        weight,
        order: order ?? 0,
        progress,
        evidence,
        instructions: description,
        path: file.path,
      });
    }
  }

  // cross-file checks
  const dimensionById = new Map();
  const orders = new Map();
  for (const d of dimensions) {
    if (dimensionById.has(d.id)) errors.push(`${d.path}: duplicate dimension id "${d.id}"`);
    dimensionById.set(d.id, d);
    if (orders.has(d.order)) errors.push(`${d.path}: order ${d.order} is also used by "${orders.get(d.order)}"`);
    orders.set(d.order, d.id);
  }
  const checkById = new Map();
  for (const c of checks) {
    if (checkById.has(c.id)) errors.push(`${c.path}: duplicate check id "${c.id}"`);
    checkById.set(c.id, c);
    const d = dimensionById.get(c.dimension);
    if (!d) {
      errors.push(`${c.path}: unknown dimension "${c.dimension}"`);
    } else {
      d.checks.push(c);
    }
  }
  if (dimensions.length === 0) errors.push('no dimensions found');
  for (const d of dimensions) {
    if (d.checks.length === 0) errors.push(`${d.path}: dimension "${d.id}" has no checks`);
  }

  if (errors.length > 0) throw new RubricError(errors);

  dimensions.sort((a, b) => a.order - b.order);
  for (const d of dimensions) {
    d.checks.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  }
  const orderedChecks = dimensions.flatMap((d) => d.checks);
  return {
    dimensions,
    checks: orderedChecks,
    checkById: new Map(orderedChecks.map((c) => [c.id, c])),
    dimensionById,
  };
}

/**
 * Stable SHA-256 over the rubric files, so a report can record which rubric
 * it was scored against. Uses Web Crypto, available in workerd and Node.
 *
 * @param {RubricFile[]} files
 * @returns {Promise<string>} lower-case hex digest
 */
export async function hashRubric(files) {
  const sorted = [...files].sort((a, b) => a.path.localeCompare(b.path));
  const material = sorted.map((f) => `${f.path}\n${f.text.replace(/\r\n/g, '\n')}\n`).join('\n');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(material));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}
