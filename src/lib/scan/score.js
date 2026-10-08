/**
 * Score aggregation. Done in code, never by the model.
 *
 * - a check scores 0 to 4 (or null when it could not be assessed)
 * - a dimension scores 0 to 100: the weighted mean of its assessed checks
 *   divided by 4, times 100
 * - the overall score is 0 to 100: the weighted mean of the scored dimensions
 *
 * Unassessed checks and dimensions are left out of the means rather than
 * counted as zero, and the report says so. A site type can override the
 * dimension weights and skip checks that do not apply to that kind of site;
 * skipped checks are left out of the means entirely.
 */

/** Score bands for display. Thresholds are inclusive lower bounds. */
export const BANDS = Object.freeze([
  { id: 'strong', label: 'Strong', min: 75 },
  { id: 'fair', label: 'Fair', min: 50 },
  { id: 'weak', label: 'Weak', min: 25 },
  { id: 'poor', label: 'Poor', min: 0 },
]);

/**
 * @param {number | null} score  0 to 100
 * @returns {{ id: string, label: string }}
 */
export function bandFor(score) {
  if (score === null || !Number.isFinite(score)) return { id: 'none', label: 'Not assessed' };
  const band = BANDS.find((b) => score >= b.min) ?? BANDS[BANDS.length - 1];
  return { id: band.id, label: band.label };
}

/**
 * Weighted mean of scored items, or null when nothing is scored.
 * @param {Array<{ weight: number, score: number | null }>} items
 */
export function weightedMean(items) {
  let total = 0;
  let weights = 0;
  for (const item of items) {
    if (item.score === null || !Number.isFinite(item.score) || !(item.weight > 0)) continue;
    total += item.weight * item.score;
    weights += item.weight;
  }
  return weights > 0 ? total / weights : null;
}

/**
 * @param {import('../rubric/parse.js').Dimension} dimension
 * @param {Map<string, import('./assess.js').CheckResult>} resultsById
 * @param {Iterable<string>} [skip]  ids of checks that do not apply and are left out entirely
 * @returns {{ score: number | null, assessed: number, total: number }}  total counts the applicable checks
 */
export function scoreDimension(dimension, resultsById, skip = []) {
  const skipped = new Set(skip);
  const items = dimension.checks.filter((c) => !skipped.has(c.id)).map((c) => ({ weight: c.weight, score: resultsById.get(c.id)?.score ?? null }));
  const mean = weightedMean(items);
  return {
    score: mean === null ? null : Math.round((mean / 4) * 100),
    assessed: items.filter((i) => i.score !== null).length,
    total: items.length,
  };
}

/**
 * @param {import('../rubric/parse.js').Rubric} rubric
 * @param {Map<string, import('./assess.js').CheckResult>} resultsById
 * @param {import('../rubric/parse.js').SiteType} [siteType]  overrides dimension weights and skips checks; without it the rubric applies as written
 * @returns {{ overall: number | null, dimensions: Array<{ id: string, weight: number, score: number | null, assessed: number, total: number }> }}  weight is the one used
 */
export function scoreReport(rubric, resultsById, siteType) {
  const dimensions = rubric.dimensions.map((d) => ({
    id: d.id,
    weight: siteType?.weights[d.id] ?? d.weight,
    ...scoreDimension(d, resultsById, siteType?.skip ?? []),
  }));
  const overall = weightedMean(dimensions.map((d) => ({ weight: d.weight, score: d.score })));
  return {
    overall: overall === null ? null : Math.round(overall),
    dimensions,
  };
}
