// Build-time rubric validation. Runs before `astro build` (see the prebuild
// script) and exits non-zero with every problem listed. Uses the same parser
// as the runtime loader.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { EVIDENCE_KEY_NAMES } from '../src/lib/evidence/keys.js';
import { RubricError, hashRubric, parseRubric } from '../src/lib/rubric/parse.js';

const root = new URL('../rubric/', import.meta.url);

/** @returns {import('../src/lib/rubric/parse.js').RubricFile[]} */
function readRubricFiles() {
  const files = [];
  for (const dir of ['dimensions', 'checks', 'site-types']) {
    const dirPath = new URL(`${dir}/`, root);
    for (const name of readdirSync(dirPath)) {
      if (!name.endsWith('.md')) continue;
      files.push({ path: join('rubric', dir, name).replace(/\\/g, '/'), text: readFileSync(new URL(name, dirPath), 'utf8') });
    }
  }
  return files;
}

try {
  const files = readRubricFiles();
  const rubric = parseRubric(files, EVIDENCE_KEY_NAMES);
  const hash = await hashRubric(files);
  const totalWeight = rubric.dimensions.reduce((sum, d) => sum + d.weight, 0);
  console.log(`rubric ok: ${rubric.dimensions.length} dimensions, ${rubric.checks.length} checks, ${rubric.siteTypes.length} site types, dimension weights sum to ${totalWeight}, hash ${hash.slice(0, 12)}`);
  for (const d of rubric.dimensions) {
    console.log(`  ${String(d.order).padStart(2)}. ${d.title} (weight ${d.weight}): ${d.checks.map((c) => c.id).join(', ')}`);
  }
  for (const t of rubric.siteTypes) {
    const weights = Object.entries(t.weights).map(([k, v]) => `${k} ${v}`).join(', ');
    console.log(`  site type ${t.id}${t.isDefault ? ' (default)' : ''}: ${weights ? `weights ${weights}` : 'dimension weights as written'}${t.skip.length ? `; skips ${t.skip.join(', ')}` : ''}`);
  }
} catch (err) {
  if (err instanceof RubricError) {
    console.error(err.message);
  } else {
    console.error(err);
  }
  process.exit(1);
}
