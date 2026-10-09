import { describe, expect, it } from 'vitest';
import { PHASES } from '../../src/lib/collectors/index.js';
import { LlmError, createMockProvider } from '../../src/lib/llm/index.js';
import { rubric } from '../../src/lib/rubric/index.js';
import { REPORT_VERSION, runScan } from '../../src/lib/scan/run.js';

const ORIGIN = 'https://acme.example.com';
const HTML = `<!doctype html><html><head><title>Acme</title><meta name="description" content="Widgets"></head><body><header><nav><a href="/about">About</a><a href="/pricing">Pricing</a></nav></header><main><h1>Acme</h1><p>We make widgets. Email <a href="mailto:hi@acme.example.com">us</a>.</p></main></body></html>`;

/** @type {typeof fetch} */
const site = async (input) => {
  const url = String(input);
  if (url === `${ORIGIN}/` || url === `${ORIGIN}/about` || url === `${ORIGIN}/pricing`) return new Response(HTML, { headers: { 'content-type': 'text/html' } });
  if (url === `${ORIGIN}/robots.txt`) return new Response('User-agent: *\nAllow: /\n', { headers: { 'content-type': 'text/plain' } });
  return new Response('nope', { status: 404, headers: { 'content-type': 'text/html' } });
};

describe('runScan', () => {
  it('produces a complete report with scores computed in code and progress for every real step', async () => {
    /** @type {string[]} */
    const progress = [];
    /** @type {string[]} */
    const checks = [];
    const provider = createMockProvider({ override: (id) => ({ score: id === 'llms-txt' ? 0 : 4 }) });
    const report = await runScan({
      url: 'acme.example.com',
      provider,
      fetchImpl: site,
      onProgress: (e) => progress.push(`${e.phase}:${e.status}:${e.step}`),
      onCheck: (r) => checks.push(r.id),
      now: () => new Date('2026-09-30T00:00:00Z'),
    });

    expect(report.version).toBe(REPORT_VERSION);
    expect(report.url).toBe(`${ORIGIN}/`);
    expect(report.scannedAt).toBe('2026-09-30T00:00:00.000Z');
    expect(report.rubricHash).toMatch(/^[0-9a-f]{64}$/);
    expect(report.model).toBe('mock-1');

    // every dimension and check from the rubric, in order
    expect(report.dimensions.map((d) => d.id)).toEqual(rubric.dimensions.map((d) => d.id));
    for (const d of report.dimensions) {
      const rd = rubric.dimensionById.get(d.id);
      expect(d.checks.map((c) => c.id)).toEqual(rd.checks.map((c) => c.id));
      expect(d.description).toBe(rd.description);
      expect(d.assessed).toBe(d.total);
      for (const c of d.checks) {
        expect(c.rationale).toMatch(/Mock assessment/);
        expect(c.recommendation).not.toBe('');
      }
    }
    expect(checks).toEqual(rubric.checks.map((c) => c.id));

    // scoring: everything 4 except llms-txt (weight 3 of 10 in discovery) at 0
    const discovery = report.dimensions.find((d) => d.id === 'discovery');
    expect(discovery.score).toBe(70);
    expect(discovery.band).toEqual({ id: 'fair', label: 'Fair' });
    expect(report.dimensions.filter((d) => d.id !== 'discovery').every((d) => d.score === 100)).toBe(true);
    // (20*70 + 80*100) / 100 = 94
    expect(report.overall).toBe(94);
    expect(report.band.id).toBe('strong');

    expect(report.stats.llmCalls).toBe(rubric.dimensions.length);
    expect(report.stats.fetches).toBeGreaterThan(5);
    expect(report.stats.tokens.input).toBeGreaterThan(0);
    expect(report.stats.sampledPages).toEqual([`${ORIGIN}/pricing`, `${ORIGIN}/about`]);
    expect(report.stats.problems).toEqual([]);

    // progress: collectors first, then one assess step per dimension carrying its check labels
    for (const step of PHASES.flat()) expect(progress).toContain(`collect:done:${step.id}`);
    const assessSteps = progress.filter((p) => p.startsWith('assess:'));
    expect(assessSteps).toEqual(rubric.dimensions.flatMap((d) => [`assess:start:${d.id}`, `assess:done:${d.id}`]));
    expect(progress.indexOf('assess:start:discovery')).toBeGreaterThan(progress.lastIndexOf('collect:done:api'));
  });

  it('scores by the chosen site type, skips its checks without asking the model, and records it', async () => {
    /** @type {string[]} */
    const asked = [];
    const provider = createMockProvider({ override: (id) => (asked.push(id), { score: 4 }) });
    /** @type {any[]} */
    const events = [];
    const report = await runScan({ url: `${ORIGIN}/`, provider, fetchImpl: site, siteType: 'publisher', onProgress: (e) => events.push(e) });
    const publisher = rubric.siteTypeById.get('publisher');
    expect(report.siteType).toEqual({ id: 'publisher', title: publisher.title });
    for (const id of publisher.skip) expect(asked).not.toContain(id);
    expect(asked.length).toBe(rubric.checks.length - publisher.skip.length);
    const byId = Object.fromEntries(report.dimensions.flatMap((d) => d.checks.map((c) => [c.id, c])));
    expect(byId['pricing-and-terms']).toMatchObject({ applicable: false, score: null, rationale: '' });
    expect(byId['what-it-does']).toMatchObject({ applicable: true, score: 4 });
    expect(Object.fromEntries(report.dimensions.map((d) => [d.id, d.weight]))).toEqual(publisher.weights);
    const answerability = report.dimensions.find((d) => d.id === 'answerability');
    expect(answerability).toMatchObject({ total: 3, assessed: 3, score: 100 });
    expect(report.overall).toBe(100);
    const start = events.find((e) => e.phase === 'assess' && e.step === 'answerability' && e.status === 'start');
    expect(start.checks.map((c) => c.id)).toEqual(['what-it-does', 'who-its-for', 'how-to-buy-or-contact']);
  });

  it('falls back to the default site type for an unknown id', async () => {
    const report = await runScan({ url: `${ORIGIN}/`, provider: createMockProvider(), fetchImpl: site, siteType: 'spaceship' });
    expect(report.siteType).toEqual({ id: 'general', title: rubric.defaultSiteType.title });
    expect(report.dimensions.every((d) => d.checks.every((c) => c.applicable))).toBe(true);
  });

  it('carries the check progress labels from the rubric on assess events', async () => {
    /** @type {import('../../src/lib/scan/run.js').ScanProgress[]} */
    const events = [];
    await runScan({ url: `${ORIGIN}/`, provider: createMockProvider(), fetchImpl: site, onProgress: (e) => events.push(e) });
    const discovery = events.find((e) => e.phase === 'assess' && e.step === 'discovery');
    expect(discovery.label).toBe('Assessing discovery and access...');
    expect(discovery.checks).toEqual(rubric.dimensionById.get('discovery').checks.map((c) => ({ id: c.id, label: c.progress })));
  });

  it('turns a quota error into a clear scan error', async () => {
    /** @type {import('../../src/lib/llm/index.js').LlmProvider} */
    const exhausted = { name: 'x', model: 'x', async generate() { throw new LlmError('quota', 'day'); } };
    await expect(runScan({ url: `${ORIGIN}/`, provider: exhausted, fetchImpl: site })).rejects.toMatchObject({ code: 'llm-quota', message: expect.stringContaining('daily assessment allowance') });
  });

  it('rejects an unsafe target before fetching anything', async () => {
    let fetched = 0;
    await expect(runScan({ url: 'http://127.0.0.1/', provider: createMockProvider(), fetchImpl: async () => { fetched += 1; return new Response(''); } })).rejects.toMatchObject({ code: 'ip' });
    expect(fetched).toBe(0);
  });

  it('passes robots and unreachable errors through', async () => {
    /** @type {typeof fetch} */
    const blocked = async (input) => (String(input).endsWith('/robots.txt') ? new Response('User-agent: *\nDisallow: /\n', { headers: { 'content-type': 'text/plain' } }) : new Response(HTML, { headers: { 'content-type': 'text/html' } }));
    await expect(runScan({ url: `${ORIGIN}/`, provider: createMockProvider(), fetchImpl: blocked })).rejects.toMatchObject({ code: 'robots' });
  });
});
