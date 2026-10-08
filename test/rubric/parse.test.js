import { describe, expect, it } from 'vitest';
import { GENERAL_SITE_TYPE, RubricError, hashRubric, parseRubric } from '../../src/lib/rubric/parse.js';

const KEYS = ['alpha', 'beta'];

/** @param {Record<string, string | number | string[]>} fields @param {string} [body] */
function doc(fields, body = 'Look at things.\n\nScoring:\n- 0: none\n- 1: some\n- 2: half\n- 3: most\n- 4: all\n') {
  const front = Object.entries(fields)
    .map(([k, v]) => `${k}: ${Array.isArray(v) ? `[${v.join(', ')}]` : v}`)
    .join('\n');
  return `---\n${front}\n---\n${body}`;
}

const dimension = { path: 'rubric/dimensions/one.md', text: doc({ id: 'one', title: 'One', weight: 10, order: 1 }, 'About one.\n') };
const check = {
  path: 'rubric/checks/first.md',
  text: doc({ id: 'first', dimension: 'one', title: 'First', weight: 2, progress: 'Checking first...', evidence: ['alpha'] }),
};

/** @param {import('../../src/lib/rubric/parse.js').RubricFile[]} files */
function errorsOf(files) {
  try {
    parseRubric(files, KEYS);
  } catch (err) {
    if (err instanceof RubricError) return err.errors;
    throw err;
  }
  return [];
}

describe('parseRubric', () => {
  it('assembles dimensions with their checks in order', () => {
    const second = {
      path: 'rubric/checks/second.md',
      text: doc({ id: 'second', dimension: 'one', title: 'Second', weight: 1, order: -1, progress: 'Checking second...', evidence: ['alpha', 'beta'] }),
    };
    const rubric = parseRubric([check, dimension, second], KEYS);
    expect(rubric.dimensions.map((d) => d.id)).toEqual(['one']);
    expect(rubric.dimensions[0].description).toBe('About one.');
    expect(rubric.dimensions[0].checks.map((c) => c.id)).toEqual(['second', 'first']);
    expect(rubric.checks.map((c) => c.id)).toEqual(['second', 'first']);
    expect(rubric.checkById.get('first')?.evidence).toEqual(['alpha']);
    expect(rubric.checkById.get('first')?.instructions).toContain('- 4: all');
  });

  it('reports every problem at once', () => {
    const bad = {
      path: 'rubric/checks/broken.md',
      text: doc({ id: 'Broken', dimension: 'missing', title: 'B', weight: 0, progress: 'x', evidence: ['nope', 'alpha', 'alpha'] }, 'No scoring here.\n'),
    };
    const errors = errorsOf([dimension, check, bad]);
    expect(errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining('id "Broken" must be lower-case kebab-case'),
        expect.stringContaining('does not match file name "broken"'),
        expect.stringContaining('"weight" must be a number greater than 0'),
        expect.stringContaining('unknown evidence key "nope"'),
        expect.stringContaining('evidence key "alpha" listed twice'),
        expect.stringContaining('scoring must define level 0 exactly once'),
        expect.stringContaining('scoring must define level 4 exactly once'),
      ]),
    );
    // the check with a bad weight is not assembled, so the dimension error
    // is not reported for it, but the unknown dimension still is once the
    // check is otherwise valid
    const bad2 = { ...bad, text: doc({ id: 'broken', dimension: 'missing', title: 'B', weight: 1, progress: 'x', evidence: ['alpha'] }) };
    expect(errorsOf([dimension, check, bad2])).toEqual([expect.stringContaining('unknown dimension "missing"')]);
  });

  it('requires every dimension to have a check and unique orders', () => {
    const empty = { path: 'rubric/dimensions/two.md', text: doc({ id: 'two', title: 'Two', weight: 5, order: 1 }, 'About two.\n') };
    const errors = errorsOf([dimension, check, empty]);
    expect(errors).toEqual(
      expect.arrayContaining([expect.stringContaining('order 1 is also used by "one"'), expect.stringContaining('dimension "two" has no checks')]),
    );
  });

  it('rejects duplicate ids, unknown fields and missing required fields', () => {
    const dupe = { path: 'elsewhere/checks/first.md', text: check.text };
    const extra = { path: 'rubric/dimensions/three.md', text: doc({ id: 'three', title: 'T', weight: 1, order: 3, colour: 'red' }, 'x') };
    const missing = { path: 'rubric/checks/nofields.md', text: doc({ id: 'nofields', dimension: 'one' }) };
    const errors = errorsOf([dimension, check, dupe, extra, missing]);
    expect(errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining('duplicate check id "first"'),
        expect.stringContaining('unknown field "colour"'),
        expect.stringContaining('missing required field "title"'),
        expect.stringContaining('missing required field "progress"'),
        expect.stringContaining('missing required field "evidence"'),
      ]),
    );
  });

  it('rejects files outside dimensions/ and checks/ and invalid frontmatter', () => {
    const stray = { path: 'rubric/notes.md', text: '---\nid: x\n---\n' };
    const broken = { path: 'rubric/checks/bad.md', text: 'no frontmatter' };
    const errors = errorsOf([dimension, check, stray, broken]);
    expect(errors).toEqual(
      expect.arrayContaining([expect.stringContaining('not under dimensions/, checks/ or site-types/'), expect.stringContaining('must start with a "---" line')]),
    );
  });

  it('fails on an empty rubric', () => {
    expect(errorsOf([])).toEqual(['no dimensions found']);
  });
});

const siteType = {
  path: 'rubric/site-types/shop.md',
  text: "---\nid: shop\ntitle: Online shop\nsummary: People buy things.\norder: 1\ndefault: true\nweights: { one: 30 }\nskip: [first]\n---\nJudge as a shopper's agent.\n",
};
const plainType = { path: 'rubric/site-types/general.md', text: '---\nid: general\ntitle: General\nsummary: Everything applies.\norder: 2\n---\nApply every check.\n' };

describe('site types', () => {
  it('assembles site types with weights, skips and guidance, in order, with one default', () => {
    const rubric = parseRubric([dimension, check, plainType, siteType], KEYS);
    expect(rubric.siteTypes.map((t) => t.id)).toEqual(['shop', 'general']);
    expect(rubric.defaultSiteType.id).toBe('shop');
    expect(rubric.siteTypeById.get('shop')).toMatchObject({ title: 'Online shop', summary: 'People buy things.', order: 1, isDefault: true, weights: { one: 30 }, skip: ['first'], guidance: "Judge as a shopper's agent." });
    expect(rubric.siteTypeById.get('general')).toMatchObject({ isDefault: false, weights: {}, skip: [] });
  });

  it('falls back to a built-in general type when the rubric has none', () => {
    const rubric = parseRubric([dimension, check], KEYS);
    expect(rubric.siteTypes).toEqual([GENERAL_SITE_TYPE]);
    expect(rubric.defaultSiteType).toBe(GENERAL_SITE_TYPE);
  });

  it('validates references, the default flag, orders and fields', () => {
    const bad = { path: 'rubric/site-types/bad.md', text: '---\nid: bad\ntitle: Bad\nsummary: s\norder: 1\nweights: { nope: 5, one: 0 }\nskip: [missing, first, first]\ncolour: red\n---\nx\n' };
    expect(errorsOf([dimension, check, siteType, bad])).toEqual(
      expect.arrayContaining([
        expect.stringContaining('weights name unknown dimension "nope"'),
        expect.stringContaining('weight for "one" must be a number greater than 0'),
        expect.stringContaining('skip names unknown check "missing"'),
        expect.stringContaining('check "first" is skipped twice'),
        expect.stringContaining('unknown field "colour"'),
        expect.stringContaining('order 1 is also used by "shop"'),
      ]),
    );
    expect(errorsOf([dimension, check, plainType])).toEqual([expect.stringContaining('exactly one must have "default: true" (found 0)')]);
    const second = { ...plainType, text: plainType.text.replace('order: 2\n', 'order: 2\ndefault: true\n') };
    expect(errorsOf([dimension, check, siteType, second])).toEqual([expect.stringContaining('(found 2)')]);
    const noSummary = { path: 'rubric/site-types/nosummary.md', text: '---\nid: nosummary\ntitle: T\norder: 3\ndefault: true\n---\nx\n' };
    expect(errorsOf([dimension, check, noSummary])).toEqual([expect.stringContaining('missing required field "summary"')]);
  });
});

describe('hashRubric', () => {
  it('is stable across file order and line endings, and changes with content', async () => {
    const a = await hashRubric([dimension, check]);
    const b = await hashRubric([check, dimension]);
    const c = await hashRubric([dimension, { ...check, text: check.text.replace(/\n/g, '\r\n') }]);
    const d = await hashRubric([dimension, { ...check, text: check.text.replace('- 4: all', '- 4: everything') }]);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(b).toBe(a);
    expect(c).toBe(a);
    expect(d).not.toBe(a);
  });
});
