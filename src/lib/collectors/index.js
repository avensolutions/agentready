import { EVIDENCE_KEY_NAMES } from '../evidence/keys.js';
import { BUDGET } from '../scan/budget.js';
import { ScanError } from '../scan/errors.js';
import { assembleEvidence } from './evidence.js';
import { createFetcher } from './fetch.js';
import { collectLlmsFullTxt, collectLlmsTxt } from './llms.js';
import { collectHome, collectSamplePages } from './pages.js';
import { collectApiSurface, collectMarkdownAlternates } from './probes.js';
import { collectRobots } from './robots.js';
import { collectSitemap } from './sitemap.js';

/**
 * The evidence pipeline. Deterministic, budgeted, and ordered so that the
 * cheap gating steps run first: robots.txt (which can stop the scan), then
 * the home page and the site-level files, then everything that depends on
 * the home page.
 */

/**
 * @typedef {Object} ScanPage
 * @property {'home' | 'sample'} role
 * @property {import('./fetch.js').FetchResult} fetch
 * @property {import('./html.js').PageExtract | null} extract
 */

/**
 * @typedef {Object} ProgressEvent
 * @property {string} step
 * @property {string} label
 * @property {'start' | 'done' | 'skipped'} status
 */

/**
 * @typedef {Object} ScanContext
 * @property {string} url  normalised target URL
 * @property {string} origin
 * @property {typeof BUDGET} budget
 * @property {import('./fetch.js').Fetcher} fetcher
 * @property {Record<string, unknown>} evidence
 * @property {ScanPage[]} pages
 * @property {{ parsed: ReturnType<typeof import('./robots.js').parseRobots>, self: ReturnType<typeof import('./robots.js').evaluateAgent> } | undefined} robots
 * @property {{ present: boolean, body: string } | undefined} llmsTxt
 * @property {string[]} sitemapUrls
 * @property {string[]} sampleUrls
 */

/**
 * @typedef {Object} Collector
 * @property {string} id
 * @property {string} progress  label shown while the step runs
 * @property {(ctx: ScanContext) => Promise<void>} run
 */

/** Steps in phases. Steps in one phase run in parallel. */
export const PHASES = /** @type {Collector[][]} */ ([
  [{ id: 'robots', progress: 'Reading robots.txt...', run: collectRobots }],
  [
    { id: 'home', progress: 'Fetching the page...', run: collectHome },
    { id: 'llms_txt', progress: 'Checking for llms.txt...', run: collectLlmsTxt },
    { id: 'llms_full_txt', progress: 'Checking for llms-full.txt...', run: collectLlmsFullTxt },
    { id: 'sitemap', progress: 'Looking for a sitemap...', run: collectSitemap },
  ],
  [
    { id: 'pages', progress: 'Reading a sample of linked pages...', run: collectSamplePages },
    { id: 'markdown', progress: 'Probing for markdown versions...', run: collectMarkdownAlternates },
  ],
  [{ id: 'api', progress: 'Probing for API and MCP surfaces...', run: collectApiSurface }],
]);

/**
 * Run every collector against a target and return the evidence.
 *
 * @param {Object} options
 * @param {string} options.url  normalised target URL (see normaliseTarget)
 * @param {typeof fetch} [options.fetchImpl]
 * @param {(event: ProgressEvent) => void} [options.onProgress]
 * @param {typeof BUDGET} [options.budget]
 * @returns {Promise<{ evidence: Record<string, unknown>, pages: ScanPage[], stats: { fetches: number, elapsedMs: number } }>}
 */
export async function collectEvidence({ url, fetchImpl, onProgress = () => {}, budget = BUDGET }) {
  const started = Date.now();
  /** @type {ScanContext} */
  const ctx = {
    url,
    origin: new URL(url).origin,
    budget,
    fetcher: createFetcher({ fetchImpl, maxFetches: budget.maxFetches, timeoutMs: budget.fetchTimeoutMs, userAgent: budget.userAgent }),
    evidence: {},
    pages: [],
    robots: undefined,
    llmsTxt: undefined,
    sitemapUrls: [],
    sampleUrls: [],
  };

  for (const phase of PHASES) {
    await Promise.all(
      phase.map(async (step) => {
        onProgress({ step: step.id, label: step.progress, status: 'start' });
        await step.run(ctx);
        onProgress({ step: step.id, label: step.progress, status: 'done' });
      }),
    );
    if (ctx.robots && !ctx.robots.self.allowedPath) {
      throw new ScanError('robots', "The site's robots.txt does not allow axcheck to read this page, so it was not scanned.", {
        url,
        matched: ctx.robots.self.matched,
        disallow: ctx.robots.self.disallow,
      });
    }
  }

  assembleEvidence(ctx);

  for (const key of EVIDENCE_KEY_NAMES) {
    if (!(key in ctx.evidence)) ctx.evidence[key] = { missing: true, note: 'This evidence could not be collected.' };
  }

  return {
    evidence: ctx.evidence,
    pages: ctx.pages,
    stats: { fetches: ctx.fetcher.used, elapsedMs: Date.now() - started },
  };
}
