/**
 * Bundles the rubric at build time. There is no filesystem at runtime, so the
 * markdown is inlined by Vite. The `?raw` query makes Astro skip its markdown
 * pipeline for these files.
 */
import { EVIDENCE_KEY_NAMES } from '../evidence/keys.js';
import { hashRubric, parseRubric } from './parse.js';

const modules = import.meta.glob('/rubric/{dimensions,checks}/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
});

/** @type {import('./parse.js').RubricFile[]} */
export const rubricFiles = Object.entries(modules)
  .map(([path, text]) => ({ path: path.replace(/^\//, ''), text: /** @type {string} */ (text) }))
  .sort((a, b) => a.path.localeCompare(b.path));

/** The validated rubric. Importing this module fails if the rubric is invalid. */
export const rubric = parseRubric(rubricFiles, EVIDENCE_KEY_NAMES);

/** @type {Promise<string> | undefined} */
let hashPromise;

/** SHA-256 of the rubric files, memoised. */
export function rubricHash() {
  hashPromise ??= hashRubric(rubricFiles);
  return hashPromise;
}
