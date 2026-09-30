# Platform limits

Numbers checked against the vendor documentation on 2026-09-30. Everything here is for the free plans unless a paid figure is shown for comparison. Re-check a number before a design decision depends on it, and update the checked date when you do.

Where a figure is not published by the vendor it is marked "unofficial" with the source it came from.

## Cloudflare Workers

Sources: https://developers.cloudflare.com/workers/platform/limits/ (page dated 2026-09-05), https://developers.cloudflare.com/workers/platform/pricing/

| Limit | Free | Paid (reference) |
| --- | --- | --- |
| Requests | 100,000 per day, resets midnight UTC, then error 1027 | unlimited |
| CPU time per request | 10 ms | 30 s default, up to 5 min |
| Memory per isolate | 128 MB | 128 MB |
| Subrequests per request | 50 | 10,000 |
| Simultaneous outgoing connections | 6 | 6 |
| Duration of an HTTP request | no limit while the client stays connected | same |
| `waitUntil()` after the response | 30 s | 30 s |
| Environment variables and secrets | 64 per Worker, 5 KB each | 128 per Worker |
| Worker bundle size, uncompressed | 64 MiB | 64 MiB |
| Static asset files | 20,000 per version, 25 MiB each | 100,000 per version |
| Response body size | no enforced limit | same |

What this means for axcheck:

- CPU time counts code execution only. Waiting on `fetch`, KV or the LLM does not count. Parsing does. Cloudflare's own guidance: "Heavier workloads that handle authentication, server-side rendering, or parse large payloads typically use 10-20 ms." Enforcement is soft (occasional overruns are tolerated, consistent overruns are terminated with error 1102), but the scan handler and the report page both need to stay under 10 ms of actual work. Measure both after they exist.
- A subrequest is any `fetch()` plus any KV, Cache API or other binding call. Every hop in a redirect chain counts. The 50 cap covers target-site fetches, LLM calls, Turnstile verification and KV within one scan.
- Six connections can wait for response headers at once. A seventh is queued, not failed. Parallel LLM calls are effectively capped at 6.
- A streaming response keeps the Worker alive while the client is connected, so Server-Sent Events work. The runtime is updated a few times a week and in-flight requests then get a 30 s grace period, so a scan should finish inside a minute or two.
- Requests for static assets are free, unlimited and do not count as Worker requests. Keep the landing page prerendered and do not route it through the Worker with `run_worker_first`.
- Worker-to-Worker `fetch()` on the same zone fails without a service binding or the `global_fetch_strictly_public` compatibility flag. Astro's recommended wrangler config sets that flag, which also makes a scan of the parent site behave like any public request.

## Workers KV

Sources: https://developers.cloudflare.com/kv/platform/limits/ (page dated 2026-04-21), https://developers.cloudflare.com/kv/platform/pricing/, https://developers.cloudflare.com/kv/api/write-key-value-pairs/

| Limit | Free | Paid (reference) |
| --- | --- | --- |
| Reads | 100,000 per day | unlimited |
| Writes to different keys | 1,000 per day | unlimited |
| Writes to the same key | 1 per second | 1 per second |
| Deletes | 1,000 per day | unlimited |
| List operations | 1,000 per day | unlimited |
| Operations per Worker invocation | 1,000 (but the 50 subrequest cap applies first on free) | 1,000 |
| Storage | 1 GB | unlimited |
| Key size | 512 bytes | 512 bytes |
| Value size | 25 MiB | 25 MiB |
| Metadata | 1,024 bytes | 1,024 bytes |
| Minimum `expirationTtl` | 60 s | 60 s |
| Minimum `cacheTtl` | 30 s | 30 s |

Notes:

- One write per completed scan means at most 1,000 scans a day on KV alone. The Gemini quota (below) is the tighter limit.
- Writes can take up to 60 s to become visible in other locations. The scan writes the report and then redirects the same browser to `/r/[id]`, which normally reads from the same location, but the report page must handle a miss gracefully for the first minute.
- Two writes to the same key within one second return a 429. The scan endpoint must not write the same report key twice in quick succession (for example from a retried request).

## Turnstile

Sources: https://developers.cloudflare.com/turnstile/plans/ (page dated 2026-08-14), https://developers.cloudflare.com/turnstile/get-started/client-side-rendering/, https://developers.cloudflare.com/turnstile/get-started/server-side-validation/, https://developers.cloudflare.com/turnstile/troubleshooting/testing/

- Free. Up to 20 widgets per account, 10 hostnames per widget, unlimited challenges, 7 days of analytics. Works without any other Cloudflare product.
- Client: load `https://challenges.cloudflare.com/turnstile/v0/api.js` from that exact URL (no proxying or caching), render with `<div class="cf-turnstile" data-sitekey="...">`. Inside a `<form>` the widget adds a hidden `cf-turnstile-response` input.
- Server: `POST https://challenges.cloudflare.com/turnstile/v0/siteverify` with `secret`, `response` and optionally `remoteip` (form-encoded or JSON). One subrequest per scan.
- Tokens expire after 300 s and can be validated once. A replay returns `timeout-or-duplicate`.
- Widget modes: managed, non-interactive, invisible.
- Test keys (work on any hostname including localhost):

| Purpose | Value |
| --- | --- |
| Site key, always passes, visible | `1x00000000000000000000AA` |
| Site key, always passes, invisible | `1x00000000000000000000BB` |
| Site key, always fails | `2x00000000000000000000AB` |
| Site key, forces interactive challenge | `3x00000000000000000000FF` |
| Secret, always passes | `1x0000000000000000000000000000000AA` |
| Secret, always fails | `2x0000000000000000000000000000000AA` |
| Secret, token already spent | `3x0000000000000000000000000000000AA` |

## Rate limiting

Sources: https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/ (page dated 2026-04-23), https://developers.cloudflare.com/changelog/post/2025-09-19-ratelimit-workers-ga/, https://developers.cloudflare.com/waf/rate-limiting-rules/#availability

Three options, in order of preference:

1. Workers Rate Limiting binding. Generally available since 2025-09-19, configured as a top-level `ratelimits` array in `wrangler.jsonc` (the older `unsafe.bindings` form still works). `period` must be 10 or 60 seconds. Counters are per Cloudflare location and eventually consistent, so treat it as a brake, not an accounting system. The docs do not state a plan restriction; verify on the first deploy. Requires Wrangler 4.36 or later. The docs recommend against keying by IP because of shared addresses, but before Turnstile passes the IP is the only identifier available, so key by IP with a generous limit and rely on Turnstile as the main gate.
2. WAF rate limiting rule on the zone. The free plan allows one rule, matching on path only, counted by IP, over a 10 s window, with a 10 s block. Only possible if `theoverstorygroup.com` is a zone in the same Cloudflare account.
3. Durable Objects. Available on the free plan with the SQLite backend (100,000 requests and 100,000 row writes a day). Not planned; noted only as the fallback if the binding turns out to be paid-only.

## Custom domain and CI

Sources: https://developers.cloudflare.com/workers/configuration/routing/custom-domains/ (page dated 2026-09-29), https://developers.cloudflare.com/workers/ci-cd/builds/limits-and-pricing/ (page dated 2026-05-29)

- A custom domain such as `axcheck.theoverstorygroup.com` needs `theoverstorygroup.com` to be an active zone in the same Cloudflare account, with no existing CNAME on that hostname. Cloudflare creates the DNS record and an Advanced Certificate for the hostname at no charge. Config: `"routes": [{ "pattern": "axcheck.theoverstorygroup.com", "custom_domain": true }]`.
- Until the zone is on Cloudflare the Worker can run on its `workers.dev` subdomain.
- Workers Builds (git-connected deploys from GitHub or GitLab) on the free plan: 3,000 build minutes a month, 1 concurrent build, 20 minute timeout.

## fetch() from a Worker

Sources: https://developers.cloudflare.com/workers/runtime-apis/request/, https://developers.cloudflare.com/workers/runtime-apis/fetch/, https://developers.cloudflare.com/workers/reference/how-the-cache-works/

- `redirect` defaults to `follow` for a new `Request`. In `follow` mode all request headers are forwarded to the redirect target even on a different host. axcheck uses `redirect: 'manual'` and re-validates every hop, which the safety rules require anyway.
- The runtime's follow cap is 20 redirects (from the workerd source, not documented). axcheck caps at 5 per fetch and counts each hop against the scan budget.
- There is no enforced response size limit, only the 128 MB isolate memory. Read bodies as streams and stop at a byte cap rather than calling `.text()` on an unknown body.
- `cf.cacheTtl` and `cf.cacheEverything` work on GET and HEAD to any origin and go through the Worker's own zone cache, which does not replicate between data centres. Not needed for axcheck since reports are cached in KV.

## Browser Run (formerly Browser Rendering)

Sources: https://developers.cloudflare.com/browser-run/limits/ (page dated 2026-09-26), https://developers.cloudflare.com/browser-run/pricing/

Available on the free plan: 10 browser minutes a day, 3 concurrent browsers, one new browser every 20 s, 60 s browser timeout. That is a handful of PDF renders a day, so the print stylesheet stays the default and server-side PDF is a later option only with a clear need.

## Astro and the Cloudflare adapter

Sources: https://docs.astro.build/en/guides/integrations-guide/cloudflare/, https://docs.astro.build/en/guides/deploy/cloudflare/, https://docs.astro.build/en/guides/on-demand-rendering/, https://docs.astro.build/en/install-and-setup/, https://developers.cloudflare.com/workers/wrangler/configuration/, https://developers.cloudflare.com/workers/runtime-apis/nodejs/, npm registry

| Package | Current version | Notes |
| --- | --- | --- |
| `astro` | 7.3.5 | requires Node 22.12 or later (even versions only); Vite 8 |
| `@astrojs/cloudflare` | 14.3.3 | peer: `astro ^7.2.0`, `wrangler ^4.125.0`; Workers only, Pages no longer supported |
| `wrangler` | 4.144.0 | `wrangler.jsonc` recommended for new projects |
| `vitest` | 5.0.2 | requires Node 22.12 or later |

Facts that shape the code:

- Default `output` is `static`. Each on-demand route opts in with `export const prerender = false`. axcheck has two: `/api/scan` and `/r/[id]`. There is no `hybrid` mode any more.
- `Astro.locals.runtime` has been removed. Bindings and vars come from `import { env } from 'cloudflare:workers'`. The execution context is `Astro.locals.cfContext` (for `waitUntil`). `Astro.request.cf` holds the `cf` object. Binding methods such as KV get and put must be called inside a request, not at module scope.
- `astro dev` and `astro preview` run in workerd through Cloudflare's Vite plugin, so KV and other bindings are simulated locally with state under `.wrangler/state`. `.dev.vars` next to the wrangler config supplies local secrets.
- Wrangler config from the Astro deploy guide: `main` is `@astrojs/cloudflare/entrypoints/server`, `assets.directory` is `./dist`, `assets.binding` is `ASSETS`. Cloudflare's own Astro guide still shows the older `dist/_worker.js/index.js` entry; follow the Astro docs.
- `nodejs_compat` is on by default for compatibility dates of 2026-08-04 or later. Astro's snippet still lists it explicitly. axcheck uses a current compatibility date and does not add or remove the flag.
- `import.meta.glob('../rubric/**/*.md', { query: '?raw', import: 'default', eager: true })` returns raw strings. Astro's markdown plugin skips ids carrying `?raw` (verified in the Astro source, not documented), so the rubric files are not compiled as content.
- Streaming responses: return a `Response` whose body is a `ReadableStream`. Do not set `Content-Encoding` on an SSE response (compressed event streams can sit in the encoder buffer). Send `Content-Type: text/event-stream` and `Cache-Control: no-cache, no-transform`.
- `HTMLRewriter` can transform a fetched `Response`; handlers fire as the body streams, so the transformed body must be consumed for them to run. It is zero-copy but still runs inside CPU time.
- Vitest: `getViteConfig` from `astro/config` is the documented integration, but the unit tests here (URL safety, rubric loading, scoring) are plain ES modules that do not need Astro, so a plain `vitest.config.js` is enough. `import.meta.glob` works under Vitest because it runs on Vite.

## Gemini API

Sources: https://ai.google.dev/gemini-api/docs/models, https://ai.google.dev/gemini-api/docs/deprecations, https://ai.google.dev/gemini-api/docs/rate-limits, https://ai.google.dev/gemini-api/docs/pricing, https://ai.google.dev/gemini-api/docs/generate-content/structured-output, https://ai.google.dev/gemini-api/docs/generate-content/thinking, https://ai.google.dev/api/generate-content, https://ai.google.dev/gemini-api/docs/api-errors, https://ai.google.dev/gemini-api/docs/troubleshooting, https://ai.google.dev/gemini-api/docs/safety-settings, https://ai.google.dev/gemini-api/docs/available-regions, https://ai.google.dev/gemini-api/docs/changelog

Models on the free tier (all 1,048,576 input tokens, 65,536 output tokens, structured output supported):

| Model id | Status | Released | Shutdown | Free tier |
| --- | --- | --- | --- | --- |
| `gemini-3.8-flash` | stable | 2026-09-02 | none | yes |
| `gemini-3.7-flash` | stable | 2026-08-13 | none | yes |
| `gemini-3.6-flash` | stable | 2026-07-21 | none | yes |
| `gemini-3.5-flash` | stable | 2026-05-19 | none | yes |
| `gemini-3.5-flash-lite` | stable | 2026-07-21 | none | yes |
| `gemini-3.1-flash-lite` | stable | 2026-05-07 | 2027-05-07, replacement `gemini-3.5-flash-lite` | yes |
| `gemini-3.1-pro-preview` | preview | 2026-02-19 | none | no |
| `gemini-2.5-*` | limited to existing users | 2025 | none | existing users only |

Google's guidance for new projects: "use our latest models: 3.5 Flash-Lite or 3.8 Flash." All Gemini 2.0 models and dated 2.5 previews are already shut down.

Rate limits:

- The rate limits page no longer publishes per-model tables. It says limits "depend on a variety of factors (such as your usage tier) and can be viewed in Google AI Studio" at https://aistudio.google.com/rate-limit (sign-in required). Limits are per project, not per key, and the daily quota resets at midnight Pacific time. Exceeding any limit returns HTTP 429 `RESOURCE_EXHAUSTED`.
- Tiers: Free (no billing), Tier 1 (billing linked, 250 USD cap), Tier 2 and 3 by spend history.
- Unofficial free-tier figures reported through AI Studio in September 2026 (https://www.scriptbyai.com/gemini-api-free-tier-limits/, a forum thread of 2026-09-03 at https://discuss.ai.google.dev/t/180609, and a code change of 2026-09-19 at https://github.com/vrwarp/versicle/pull/1692): every 3.x Flash model about 20 requests a day and 5 per minute; the Flash-Lite models about 500 requests a day; 250,000 input tokens per minute for all. Flash-Lite requests per minute were not found (older Flash-Lite tables show 15). Confirm in AI Studio once the project exists and update this section.
- Free-tier content "is used to improve our products". axcheck sends public web content and rubric text only, no user data.
- Batch API and grounding are not available on the free tier. Context caching is free on the 3.x Flash models but "Not available" on the Flash-Lite models on either tier.
- Australia is on the list of available regions.

Paid prices if the project is later upgraded (USD per 1M tokens, output includes thinking tokens):

| Model | Input | Output |
| --- | --- | --- |
| `gemini-3.5-flash-lite` | 0.30 | 2.50 |
| `gemini-3.1-flash-lite` | 0.25 | 1.50 |
| `gemini-3.8-flash` | 0.75 until 2026-12-31, then 1.50 | 3.75 until 2026-12-31, then 7.50 |

Request shape (REST, `generateContent`):

- `POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent` with header `x-goog-api-key`. `generateContent` is labelled legacy in favour of the Interactions API but "remains fully supported and will continue to receive new mainline Gemini models". No sunset date.
- Structured output: `generationConfig.responseFormat.text` with `mimeType: "application/json"` and `schema` (JSON Schema). The older `responseMimeType` plus `responseSchema` pair is marked deprecated but still accepted, and is the fallback if `responseFormat` misbehaves. Supported keywords: `type`, `enum`, `properties`, `required`, `items`, `prefixItems`, `minItems`, `maxItems`, `minimum`, `maximum`, `anyOf`, `additionalProperties`, `format`, `description`, `$ref`, `$defs`, and the non-standard `propertyOrdering`. `minLength`, `maxLength` and `pattern` are not supported. Unsupported keywords are ignored. Very large or deeply nested schemas can be rejected. Structured output guarantees syntax, not values, so the code clamps and validates every field.
- `temperature`, `topP` and `topK` are deprecated on Gemini 3 and `candidateCount` is unsupported. Do not send them.
- Thinking: `generationConfig.thinkingConfig.thinkingLevel` with values `minimal`, `low`, `medium`, `high`. Flash-Lite defaults to `minimal`. `gemini-3.8-flash` and `gemini-3.7-flash` reject `minimal` (use `low`). Thinking cannot be fully disabled on any 3.x model.
- Response: `candidates[0].content.parts[0].text`, `candidates[0].finishReason` (expect `STOP`; `MAX_TOKENS`, `SAFETY`, `MALFORMED_RESPONSE` and others mean discard), `promptFeedback.blockReason` when the prompt itself was blocked, `usageMetadata` with `promptTokenCount`, `candidatesTokenCount`, `thoughtsTokenCount`.
- Safety filters are off by default on Gemini 2.5 and 3, so benign third-party content is not filtered by the adjustable categories. Core harms are always blocked.
- Errors: 429 for both per-minute and per-day quota, 503 when overloaded, 500 and 504 transient. Retry only 408, 429 and 5xx, with exponential backoff and jitter starting at about 1 s, capped at a small number of attempts. No `Retry-After` header is documented; observed 429 bodies carry a `google.rpc.QuotaFailure` detail whose `quotaId` says whether the limit is per minute or per day, and a `RetryInfo.retryDelay` that is not reliable for daily quotas. axcheck retries per-minute 429s a couple of times and fails the scan with a clear message on a per-day 429.

Recommended `GEMINI_MODEL`: `gemini-3.5-flash-lite`.

- It is one of the two models Google names for new projects, stable since 2026-07-21 with no shutdown date.
- Its free daily quota is the deciding factor. Unofficially about 500 requests a day against about 20 for any 3.x Flash model. At 5 to 6 LLM calls per scan that is roughly 80 scans a day versus 3.
- Full 1M context, structured output, fastest thinking setting by default.
- Caveat: no context caching, so put shared evidence first in the prompt and keep each call small rather than relying on a cached prefix.

Fallback: `gemini-3.1-flash-lite`, same quota bucket size (quotas are per model), shuts down 2027-05-07. Use `gemini-3.8-flash` only for manual quality spot checks. Pin the versioned id rather than an alias: `gemini-flash-latest` currently points at `gemini-3.5-flash` (a 20 a day model) and is hot-swapped on each release, and no `gemini-flash-lite-latest` alias is documented.

## Scan budget

Derived from the numbers above. The code enforces these as constants and the tests check them.

| Item | Per scan | Cap |
| --- | --- | --- |
| Target-site fetches (robots, sitemap, llms.txt, llms-full.txt, home page, sampled pages, markdown alternates, API and MCP probes) | about 15 | 20 including redirect hops |
| LLM calls (one per dimension) | 5 | 8 including retries |
| KV operations (cache read, report write) | 2 | 2 |
| Turnstile verification | 1 | 1 |
| Total subrequests | about 23 | 31, leaving headroom under 50 |
| Bytes read per fetched page | up to 512 KB | hard stop, body streamed |
| Evidence sent to the LLM per scan | about 50k tokens across all calls | fits several scans a minute inside 250k TPM |
| Wall time | typically 20 to 40 s | 90 s, then the scan is failed |
| Scans a day at 5 LLM calls each | about 80 to 100 on Flash-Lite | quota is per model per project |
| CPU time | to be measured | 10 ms |
