/**
 * Fixed per-scan budget. The numbers derive from the free plan limits in
 * docs/limits.md: 50 subrequests per invocation shared between target-site
 * fetches, LLM calls, Turnstile and KV; 6 simultaneous outgoing connections;
 * 10 ms of CPU, which parsing counts against. Tests assert the totals stay
 * under the platform caps.
 */
export const BUDGET = Object.freeze({
  /** Target-site requests per scan, counting every redirect hop. */
  maxFetches: 24,
  /** Redirect hops followed for one request before giving up. */
  maxRedirectsPerFetch: 5,
  /** Per-request timeout covering headers and body. */
  fetchTimeoutMs: 8000,
  /** Linked pages fetched in addition to the home page. */
  samplePages: 3,
  /** Byte caps per fetched body. Bodies are streamed and cut at the cap. */
  bytes: Object.freeze({
    home: 384 * 1024,
    page: 192 * 1024,
    text: 64 * 1024,
    small: 32 * 1024,
  }),
  /** Concurrent target-site requests, under the 6 connection limit. */
  concurrency: 5,
  /** LLM calls per scan: one per dimension, plus retries up to this cap. */
  maxLlmCalls: 8,
  /** Whole scan, after which it is failed with a clear message. */
  scanTimeoutMs: 90_000,
  userAgent: 'agentready/1.0 (+https://agentready.theoverstorygroup.com)',
});

/** Subrequests a scan can make in the worst case, for the tests. */
export const WORST_CASE_SUBREQUESTS = BUDGET.maxFetches + BUDGET.maxLlmCalls + 1 /* report KV */ + 1 /* Turnstile */ + 6; /* two alerts: KV read, email, KV write */
