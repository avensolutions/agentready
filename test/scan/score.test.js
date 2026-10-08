import { describe, expect, it } from 'vitest';
import { rubric } from '../../src/lib/rubric/index.js';
import { BANDS, bandFor, scoreDimension, scoreReport, weightedMean } from '../../src/lib/scan/score.js';

/** @param {Record<string, number | null>} scores */
function results(scores) {
  return new Map(Object.entries(scores).map(([id, score]) => [id, { id, score, rationale: 'r', evidence: [], recommendation: '' }]));
}

describe('weightedMean', () => {
  it('weights scores and skips unscored items', () => {
    expect(weightedMean([{ weight: 3, score: 4 }, { weight: 1, score: 0 }])).toBe(3);
    expect(weightedMean([{ weight: 3, score: null }, { weight: 1, score: 2 }])).toBe(2);
    expect(weightedMean([{ weight: 3, score: null }])).toBe(null);
    expect(weightedMean([])).toBe(null);
  });
});

describe('scoreDimension', () => {
  const discovery = rubric.dimensionById.get('discovery');

  it('maps the weighted mean of 0 to 4 scores onto 0 to 100', () => {
    const all4 = Object.fromEntries(discovery.checks.map((c) => [c.id, 4]));
    expect(scoreDimension(discovery, results(all4))).toEqual({ score: 100, assessed: 4, total: 4 });
    const all0 = Object.fromEntries(discovery.checks.map((c) => [c.id, 0]));
    expect(scoreDimension(discovery, results(all0)).score).toBe(0);
  });

  it('applies check weights', () => {
    // robots-ai-access 3, sitemap 2, llms-txt 3, llms-full-txt 2 (weights from the rubric)
    const weights = Object.fromEntries(discovery.checks.map((c) => [c.id, c.weight]));
    expect(weights).toEqual({ 'robots-ai-access': 3, sitemap: 2, 'llms-txt': 3, 'llms-full-txt': 2 });
    const mixed = results({ 'robots-ai-access': 4, sitemap: 0, 'llms-txt': 2, 'llms-full-txt': 0 });
    // (3*4 + 2*0 + 3*2 + 2*0) / (10 * 4) = 18/40 = 45
    expect(scoreDimension(discovery, mixed).score).toBe(45);
  });

  it('leaves unassessed checks out and reports the count', () => {
    const partial = results({ 'robots-ai-access': 4, sitemap: null, 'llms-txt': 4 });
    // llms-full-txt has no result at all
    expect(scoreDimension(discovery, partial)).toEqual({ score: 100, assessed: 2, total: 4 });
    expect(scoreDimension(discovery, results({})).score).toBe(null);
  });
});

describe('scoreReport', () => {
  it('combines dimension scores by dimension weight and rounds', () => {
    /** @type {Record<string, number | null>} */
    const scores = {};
    for (const d of rubric.dimensions) {
      for (const c of d.checks) scores[c.id] = d.id === 'answerability' ? 4 : d.id === 'discovery' ? 2 : 0;
    }
    const report = scoreReport(rubric, results(scores));
    const byId = Object.fromEntries(report.dimensions.map((d) => [d.id, d.score]));
    expect(byId).toEqual({ discovery: 50, retrievability: 0, 'structured-data': 0, answerability: 100, actionability: 0 });
    // (20*50 + 25*100) / 100 = 35
    expect(report.overall).toBe(35);
  });

  it('excludes dimensions with no assessed checks from the overall score', () => {
    /** @type {Record<string, number | null>} */
    const scores = {};
    for (const c of rubric.dimensionById.get('discovery').checks) scores[c.id] = 3;
    const report = scoreReport(rubric, results(scores));
    expect(report.overall).toBe(75);
    expect(report.dimensions.find((d) => d.id === 'actionability')).toEqual({ id: 'actionability', weight: 15, score: null, assessed: 0, total: 4 });
    expect(scoreReport(rubric, results({})).overall).toBe(null);
  });
});

describe('bandFor', () => {
  it('maps scores to bands with inclusive lower bounds', () => {
    expect(BANDS.map((b) => b.min)).toEqual([75, 50, 25, 0]);
    expect(bandFor(100).id).toBe('strong');
    expect(bandFor(75).id).toBe('strong');
    expect(bandFor(74).id).toBe('fair');
    expect(bandFor(50).id).toBe('fair');
    expect(bandFor(49).id).toBe('weak');
    expect(bandFor(25).id).toBe('weak');
    expect(bandFor(24).id).toBe('poor');
    expect(bandFor(0).id).toBe('poor');
    expect(bandFor(null)).toEqual({ id: 'none', label: 'Not assessed' });
  });
});

describe('scoreReport with a site type', () => {
  const publisher = rubric.siteTypeById.get('publisher');

  it('uses the site type weights and leaves skipped checks out of the means', () => {
    /** @type {Record<string, number | null>} */
    const scores = {};
    for (const c of rubric.checks) scores[c.id] = 4;
    for (const id of publisher.skip) scores[id] = 0; // would drag the means down if counted
    const report = scoreReport(rubric, results(scores), publisher);
    expect(report.dimensions.every((d) => d.score === 100)).toBe(true);
    expect(report.overall).toBe(100);
    expect(Object.fromEntries(report.dimensions.map((d) => [d.id, d.weight]))).toEqual(publisher.weights);
    const answerability = report.dimensions.find((d) => d.id === 'answerability');
    expect(answerability.total).toBe(rubric.dimensionById.get('answerability').checks.length - 1);
  });

  it('combines dimensions by the site type weights', () => {
    /** @type {Record<string, number | null>} */
    const scores = {};
    for (const c of rubric.checks) scores[c.id] = c.dimension === 'retrievability' ? 4 : 0;
    // retrievability weighs 30 of 100 for a publisher and 25 of 100 as written
    expect(scoreReport(rubric, results(scores), publisher).overall).toBe(30);
    expect(scoreReport(rubric, results(scores)).overall).toBe(25);
  });
});
