import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { EVIDENCE_KEY_NAMES } from '../../src/lib/evidence/keys.js';
import { rubric, rubricFiles, rubricHash } from '../../src/lib/rubric/index.js';

// Loads the real rubric through the same Vite glob the Worker uses.
describe('bundled rubric', () => {
  it('loads every file under rubric/dimensions and rubric/checks', () => {
    expect(rubricFiles.length).toBeGreaterThan(0);
    expect(rubricFiles.every((f) => /^rubric\/(dimensions|checks)\/[a-z0-9-]+\.md$/.test(f.path))).toBe(true);
  });

  it('has the five starting dimensions in order', () => {
    expect(rubric.dimensions.map((d) => d.id)).toEqual(['discovery', 'retrievability', 'structured-data', 'answerability', 'actionability']);
  });

  it('gives every dimension at least three checks and a progress label', () => {
    for (const d of rubric.dimensions) {
      expect(d.checks.length, d.id).toBeGreaterThanOrEqual(3);
      expect(d.progress, d.id).toMatch(/\.\.\.$/);
    }
  });

  it('gives every check a progress label ending in an ellipsis and known evidence', () => {
    for (const c of rubric.checks) {
      expect(c.progress, c.id).toMatch(/\.\.\.$/);
      for (const key of c.evidence) expect(EVIDENCE_KEY_NAMES, `${c.id} -> ${key}`).toContain(key);
    }
  });

  it('uses every evidence key in at least one check', () => {
    const used = new Set(rubric.checks.flatMap((c) => c.evidence));
    for (const key of EVIDENCE_KEY_NAMES) expect(used.has(key), key).toBe(true);
  });

  it('keeps plain keyboard punctuation in rubric prose', () => {
    for (const f of rubricFiles) {
      expect(f.text, f.path).not.toMatch(/[\u2013\u2014\u2018\u2019\u201c\u201d\u2192]/);
    }
  });

  it('produces a stable hash', async () => {
    const hash = await rubricHash();
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(await rubricHash()).toBe(hash);
  });
});

describe('rubric/README.md', () => {
  const readme = readFileSync(new URL('../../rubric/README.md', import.meta.url), 'utf8');

  it('documents every evidence key', () => {
    for (const key of EVIDENCE_KEY_NAMES) expect(readme, key).toContain(`\`${key}\``);
  });

  it('does not document keys that no longer exist', () => {
    const section = readme.split(/^## Evidence keys$/m)[1]?.split(/^## /m)[0] ?? '';
    const documented = [...section.matchAll(/^\| `([a-z_]+)` \|/gm)].map((m) => m[1]);
    expect(documented.length).toBe(EVIDENCE_KEY_NAMES.length);
    for (const key of documented) expect(EVIDENCE_KEY_NAMES, key).toContain(key);
  });
});
