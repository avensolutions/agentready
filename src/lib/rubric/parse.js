import { FrontmatterError, parseFrontmatter } from './frontmatter.js';

/**
 * @typedef {Object} RubricFile
 * @property {string} path  path ending in dimensions/<id>.md, checks/<id>.md or site-types/<id>.md
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
 * A kind of site, chosen by the person who starts a scan. It changes how
 * the rubric is applied: dimension weights can be overridden, checks that
 * make no sense for that kind of site are skipped, and the body is given to
 * the assessor as guidance on how to read the checks.
 *
 * @typedef {Object} SiteType
 * @property {string} id
 * @property {string} title  the option label on the landing page and the label on the report
 * @property {string} summary  one line under the option
 * @property {number} order  display order of the options
 * @property {boolean} isDefault  preselected when nothing else is chosen
 * @property {Record<string, number>} weights  dimension weight overrides by dimension id
 * @property {string[]} skip  checks not assessed for this kind of site
 * @property {string} guidance  the markdown body, given to the assessor
 * @property {string} path
 */

/**
 * @typedef {Object} Rubric
 * @property {Dimension[]} dimensions  sorted by order, each with its checks sorted by order then id
 * @property {Check[]} checks  every check, in dimension order
 * @property {Map<string, Check>} checkById
 * @property {Map<string, Dimension>} dimensionById
 * @property {SiteType[]} siteTypes  sorted by order
 * @property {Map<string, SiteType>} siteTypeById
 * @property {SiteType} defaultSiteType
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

/**
 * The site type used when a rubric has no site-types/ files: every check
 * applies and dimension weights are used as written.
 * @type {SiteType}
 */
export const GENERAL_SITE_TYPE = Object.freeze({
  id: 'general',
  title: 'General',
  summary: 'A balanced assessment across every area.',
  order: 0,
  isDefault: true,
  weights: Object.freeze({}),
  skip: Object.freeze([]),
  guidance: '',
  path: '',
});

const ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * @param {string} path
 * @returns {{ kind: 'dimension' | 'check' | 'site-type', stem: string } | null}
 */
function classify(path) {
  const match = /(?:^|\/)(dimensions|checks|site-types)\/([^/]+)\.md$/.exec(path.replace(/\\/g, '/'));
  if (!match) return null;
  const kind = match[1] === 'dimensions' ? 'dimension' : match[1] === 'checks' ? 'check' : 'site-type';
  return { kind, stem: match[2] };
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

/** @param {Record<string, any>} data @param {Set<string>} allowed @param {string} where @param {string[]} errors */
function rejectUnknownFields(data, allowed, where, errors) {
  for (const key of Object.keys(data)) {
    if (!allowed.has(key)) errors.push(`${where}: unknown field "${key}"`);
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
  /** @type {SiteType[]} */
  const siteTypes = [];
  const known = new Set(evidenceKeys);

  for (const file of files) {
    const where = file.path;
    const info = classify(file.path);
    if (!info) {
      errors.push(`${where}: not under dimensions/, checks/ or site-types/`);
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

    if (info.kind === 'site-type') {
      rejectUnknownFields(data, new Set(['id', 'title', 'summary', 'order', 'default', 'weights', 'skip']), where, errors);
      const summary = field(data, 'summary', 'string', where, errors);
      const order = field(data, 'order', 'integer', where, errors);
      let isDefault = false;
      if (data.default !== undefined) {
        if (typeof data.default !== 'boolean') errors.push(`${where}: "default" must be true or false`);
        else isDefault = data.default;
      }
      /** @type {Record<string, number>} */
      const weights = {};
      if (data.weights !== undefined) {
        if (!data.weights || typeof data.weights !== 'object' || Array.isArray(data.weights)) {
          errors.push(`${where}: "weights" must be a map of dimension id to weight, for example { discovery: 25 }`);
        } else {
          for (const [dimensionId, value] of Object.entries(data.weights)) {
            if (typeof value !== 'number' || !(value > 0)) errors.push(`${where}: weight for "${dimensionId}" must be a number greater than 0`);
            else weights[dimensionId] = value;
          }
        }
      }
      /** @type {string[]} */
      let skip = [];
      if (data.skip !== undefined) {
        if (!Array.isArray(data.skip) || data.skip.some((v) => typeof v !== 'string')) errors.push(`${where}: "skip" must be a list of check ids`);
        else skip = /** @type {string[]} */ (data.skip);
      }
      if (id && title && summary && order !== undefined) {
        siteTypes.push({ id, title, summary, order, isDefault, weights, skip, guidance: description, path: file.path });
      }
      continue;
    }

    const weight = field(data, 'weight', 'number', where, errors);
    const order = field(data, 'order', 'integer', where, errors, { optional: info.kind === 'check' });
    const progress = field(data, 'progress', 'string', where, errors, { optional: info.kind === 'dimension' });

    if (info.kind === 'dimension') {
      rejectUnknownFields(data, new Set(['id', 'title', 'weight', 'order', 'progress']), where, errors);
      if (id && title && weight && order !== undefined) {
        dimensions.push({ id, title, weight, order, progress, description, checks: [], path: file.path });
      }
      continue;
    }

    rejectUnknownFields(data, new Set(['id', 'dimension', 'title', 'weight', 'order', 'progress', 'evidence']), where, errors);
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

  const siteTypeById = new Map();
  const typeOrders = new Map();
  for (const t of siteTypes) {
    if (siteTypeById.has(t.id)) errors.push(`${t.path}: duplicate site type id "${t.id}"`);
    siteTypeById.set(t.id, t);
    if (typeOrders.has(t.order)) errors.push(`${t.path}: order ${t.order} is also used by "${typeOrders.get(t.order)}"`);
    typeOrders.set(t.order, t.id);
    for (const dimensionId of Object.keys(t.weights)) {
      if (!dimensionById.has(dimensionId)) errors.push(`${t.path}: weights name unknown dimension "${dimensionId}"`);
    }
    const seen = new Set();
    for (const checkId of t.skip) {
      if (!checkById.has(checkId)) errors.push(`${t.path}: skip names unknown check "${checkId}"`);
      if (seen.has(checkId)) errors.push(`${t.path}: check "${checkId}" is skipped twice`);
      seen.add(checkId);
    }
  }
  if (siteTypes.length > 0) {
    const defaults = siteTypes.filter((t) => t.isDefault);
    if (defaults.length !== 1) errors.push(`site types: exactly one must have "default: true" (found ${defaults.length})`);
  }

  if (errors.length > 0) throw new RubricError(errors);

  dimensions.sort((a, b) => a.order - b.order);
  for (const d of dimensions) {
    d.checks.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  }
  const orderedChecks = dimensions.flatMap((d) => d.checks);
  const orderedTypes = siteTypes.length > 0 ? siteTypes.sort((a, b) => a.order - b.order) : [GENERAL_SITE_TYPE];
  return {
    dimensions,
    checks: orderedChecks,
    checkById: new Map(orderedChecks.map((c) => [c.id, c])),
    dimensionById,
    siteTypes: orderedTypes,
    siteTypeById: new Map(orderedTypes.map((t) => [t.id, t])),
    defaultSiteType: /** @type {SiteType} */ (orderedTypes.find((t) => t.isDefault)),
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
