/**
 * A deterministic provider for local development and tests. It reads the
 * check ids out of the request schema and returns a plausible result for
 * each, with scores derived from the check id so they are stable between
 * runs. Set LLM_PROVIDER=mock in .dev.vars to use it.
 */

/** @param {string} s */
function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h;
}

/**
 * @param {Object} [options]
 * @param {(checkId: string, request: import('./index.js').LlmRequest) => Partial<{ score: number, rationale: string, evidence: string[], recommendation: string }>} [options.override]
 * @param {number} [options.delayMs]
 * @returns {import('./index.js').LlmProvider}
 */
export function createMockProvider({ override, delayMs = 0 } = {}) {
  return {
    name: 'mock',
    model: 'mock-1',
    async generate(request) {
      if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
      /** @type {any} */
      const schema = request.schema;
      /** @type {string[]} */
      const ids = schema?.properties?.results?.items?.properties?.check?.enum ?? [];
      const results = ids.map((id) => ({
        check: id,
        score: hash(id) % 5,
        rationale: `Mock assessment for ${id}. No model was called; the score is derived from the check id so local runs are stable.`,
        evidence: [`mock evidence for ${id}`],
        recommendation: `Mock recommendation for ${id}.`,
        ...(override ? override(id, request) : {}),
      }));
      return {
        json: { results },
        model: 'mock-1',
        usage: { input: Math.round(request.prompt.length / 4), output: 200 * results.length, thoughts: 0 },
      };
    },
  };
}
