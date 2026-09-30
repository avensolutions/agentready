import { collectEvidence } from '../collectors/index.js';
import { LlmError } from '../llm/index.js';
import { rubric as bundledRubric, rubricHash } from '../rubric/index.js';
import { normaliseTarget } from '../safety/url.js';
import { assessDimension } from './assess.js';
import { BUDGET } from './budget.js';
import { ScanError } from './errors.js';
import { bandFor, scoreReport } from './score.js';

/**
 * The scan pipeline end to end: normalise, collect, assess each dimension,
 * score in code, and shape the report. The endpoint streams the progress
 * events this emits; the report page renders the returned report.
 */

/**
 * @typedef {Object} ReportCheck
 * @property {string} id
 * @property {string} title
 * @property {number} weight
 * @property {number | null} score  0 to 4
 * @property {string} rationale
 * @property {string[]} evidence
 * @property {string} recommendation
 *
 * @typedef {Object} ReportDimension
 * @property {string} id
 * @property {string} title
 * @property {string} description
 * @property {number} weight
 * @property {number | null} score  0 to 100
 * @property {{ id: string, label: string }} band
 * @property {number} assessed
 * @property {number} total
 * @property {ReportCheck[]} checks
 *
 * @typedef {Object} Report
 * @property {number} version  report format version
 * @property {string} url  the normalised URL that was scanned
 * @property {string} scannedAt  ISO timestamp
 * @property {string} rubricHash
 * @property {string} model
 * @property {number | null} overall  0 to 100
 * @property {{ id: string, label: string }} band
 * @property {ReportDimension[]} dimensions
 * @property {{ fetches: number, llmCalls: number, tokens: { input: number, output: number, thoughts: number }, elapsedMs: number, sampledPages: string[], problems: string[] }} stats
 */

export const REPORT_VERSION = 1;

/**
 * @typedef {Object} ScanProgress
 * @property {'collect' | 'assess'} phase
 * @property {string} step  collector id or dimension id
 * @property {string} label  text for the spinner line
 * @property {'start' | 'done'} status
 * @property {Array<{ id: string, label: string }>} [checks]  the checks covered by an assess step, with their progress labels
 */

/**
 * @param {Object} options
 * @param {string} options.url  raw user input
 * @param {import('../llm/index.js').LlmProvider} options.provider
 * @param {typeof fetch} [options.fetchImpl]  target-site fetch, injectable for tests
 * @param {(event: ScanProgress) => void} [options.onProgress]
 * @param {(result: import('./assess.js').CheckResult & { dimension: string }) => void} [options.onCheck]
 * @param {import('../rubric/parse.js').Rubric} [options.rubric]
 * @param {AbortSignal} [options.signal]
 * @param {(ms: number) => Promise<void>} [options.sleep]
 * @param {() => Date} [options.now]
 * @returns {Promise<Report>}
 */
export async function runScan({ url, provider, fetchImpl, onProgress = () => {}, onCheck = () => {}, rubric = bundledRubric, signal, sleep, now = () => new Date() }) {
  const started = Date.now();
  const target = normaliseTarget(url);

  const { evidence, stats: collectStats } = await collectEvidence({
    url: target.url,
    fetchImpl,
    onProgress: (e) => onProgress({ phase: 'collect', step: e.step, label: e.label, status: e.status === 'skipped' ? 'done' : e.status }),
  });

  let llmCalls = 0;
  const calls = { remaining: () => BUDGET.maxLlmCalls - llmCalls, spend: () => (llmCalls += 1) };
  const tokens = { input: 0, output: 0, thoughts: 0 };
  /** @type {string[]} */
  const problems = [];
  /** @type {Map<string, import('./assess.js').CheckResult>} */
  const resultsById = new Map();

  for (const dimension of rubric.dimensions) {
    const label = dimension.progress ?? `Assessing ${dimension.title.toLowerCase()}...`;
    const checkLabels = dimension.checks.map((c) => ({ id: c.id, label: c.progress }));
    onProgress({ phase: 'assess', step: dimension.id, label, status: 'start', checks: checkLabels });
    let outcome;
    try {
      outcome = await assessDimension({ dimension, evidence, provider, calls, signal, sleep });
    } catch (err) {
      throw toScanError(err);
    }
    tokens.input += outcome.usage.input;
    tokens.output += outcome.usage.output;
    tokens.thoughts += outcome.usage.thoughts;
    problems.push(...outcome.problems.map((p) => `${dimension.id}: ${p}`));
    for (const result of outcome.results) {
      resultsById.set(result.id, result);
      onCheck({ ...result, dimension: dimension.id });
    }
    onProgress({ phase: 'assess', step: dimension.id, label, status: 'done', checks: checkLabels });
  }

  const scores = scoreReport(rubric, resultsById);
  const dimensions = rubric.dimensions.map((d, i) => {
    const s = scores.dimensions[i];
    return {
      id: d.id,
      title: d.title,
      description: d.description,
      weight: d.weight,
      score: s.score,
      band: bandFor(s.score),
      assessed: s.assessed,
      total: s.total,
      checks: d.checks.map((c) => {
        const r = resultsById.get(c.id);
        return {
          id: c.id,
          title: c.title,
          weight: c.weight,
          score: r?.score ?? null,
          rationale: r?.rationale ?? '',
          evidence: r?.evidence ?? [],
          recommendation: r?.recommendation ?? '',
        };
      }),
    };
  });

  return {
    version: REPORT_VERSION,
    url: target.url,
    scannedAt: now().toISOString(),
    rubricHash: await rubricHash(),
    model: provider.model,
    overall: scores.overall,
    band: bandFor(scores.overall),
    dimensions,
    stats: {
      fetches: collectStats.fetches,
      llmCalls,
      tokens,
      elapsedMs: Date.now() - started,
      sampledPages: /** @type {any} */ (evidence.pages)?.map?.((p) => p.url) ?? [],
      problems,
    },
  };
}

/** @param {unknown} err */
function toScanError(err) {
  if (err instanceof ScanError) return err;
  if (err instanceof LlmError) {
    if (err.code === 'quota') return new ScanError('llm-quota', 'The assessment service has used its daily allowance. Please try again tomorrow.', { cause: err.code });
    if (err.code === 'rate-limit') return new ScanError('llm-quota', 'The assessment service is busy. Please try again in a few minutes.', { cause: err.code });
    if (err.code === 'config') return new ScanError('internal', 'The assessment service is not configured.', { cause: err.code });
    return new ScanError('llm', `The assessment could not be completed: ${err.message}`, { cause: err.code });
  }
  if (err && typeof err === 'object' && 'budget' in err) return new ScanError('budget', 'The scan used up its assessment budget before finishing.');
  return new ScanError('internal', 'The scan failed unexpectedly.', { cause: String(err) });
}
