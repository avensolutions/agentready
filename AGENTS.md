# agentready

This is the canonical project guidance for Claude Code, GitHub Copilot, and Codex. Keep repository-specific requirements here; tool-specific instruction files should point to this file rather than duplicate its rules.

agentready is a web tool that takes a site URL, has an LLM-backed agent assess the site for agent experience (AX, also called AEO), and returns an overall score plus a score per dimension with findings and recommendations. It is a consulting lead generator for Overstory Group, served at `agentready.theoverstorygroup.com`.

## Stack and constraints

- Astro with the `@astrojs/cloudflare` adapter, deployed as a Cloudflare Worker on the free plan.
- Plain JavaScript (ES modules, JSDoc for types). No TypeScript unless asked.
- The runtime is workerd, not Node. Use Web APIs (`fetch`, `ReadableStream`, `HTMLRewriter`, `crypto.subtle`). No `fs` or other Node built-ins at runtime. Add `nodejs_compat` only if a dependency requires it.
- LLM: Google Gemini API on the free tier during prototyping, called over `fetch`. Keep it behind `src/lib/llm/` with a provider-neutral interface so the model or vendor can be swapped later. Model id comes from the `GEMINI_MODEL` var, the key from the `GEMINI_API_KEY` secret.
- Storage: Workers KV for finished reports.
- Do not introduce paid Cloudflare or Google features without asking first.

Free tier limits shape the design. Confirm the current numbers in the Cloudflare and Gemini docs before relying on them and record them in `docs/limits.md`.

- Worker CPU time per request is small (10 ms at time of writing). Waiting on `fetch` does not count, parsing does. Prerender static pages, use `HTMLRewriter` rather than a DOM library, and keep per-request work light.
- Subrequests per request are capped (50 at time of writing). A scan has a fixed budget of target-site fetches plus LLM calls that stays well under the cap.
- The Gemini free tier has low per-minute and per-day request limits. Keep LLM calls per scan to a small fixed number, handle 429s with a clear user-facing message, and keep the number of calls per scan fixed.
- KV has a low daily write limit on the free plan. One write per completed scan.

## Architecture

A scan is a fixed pipeline, not an open-ended agent loop.

1. Validate and normalise the URL (`src/lib/safety/`).
2. Collectors (`src/lib/collectors/`) fetch evidence deterministically: robots.txt, sitemap, llms.txt, llms-full.txt, home page HTML, a small sample of linked pages, response headers, markdown alternates, structured data. Each collector returns one named evidence key.
3. Checks are markdown files. The prose of a check is the instruction given to the LLM, which judges the evidence keys the check names and returns structured JSON: score, rationale, evidence quotes, recommendation. Use the Gemini structured output (response schema) feature and validate the result in code.
4. Scoring (`src/lib/scan/score.js`) is done in code, never by the LLM. Check scores and weights roll up to dimension scores (0-100), and dimension weights roll up to the overall score (0-100). The site type chosen for the scan (`rubric/site-types/`) can override dimension weights and skip checks that do not apply to that kind of site; skipped checks are not sent to the LLM and are left out of the scores.
5. The report is stored in KV and rendered at `/r/[id]`.

Routes:

- `/` - landing page, prerendered. Title, byline, URL text field and a Next button, then a second step that asks what kind of site it is (radio buttons listing the rubric's site types) with the submit button. If `?url=` is present the field is filled and the kind-of-site step is shown; if `?type=` names a site type as well, the scan starts automatically.
- `/api/scan?url=&type=` - Server-Sent Events stream with `progress`, `check`, `done` and `error` events. `type` is a site type id; the default site type applies when it is absent, and an unknown value is an `error` event.
- `/r/[id]` - report page, server-rendered from KV, shareable by link.

Progress text shown next to the spinner ("Checking llms.txt...") must correspond to real pipeline steps. Labels come from the `progress` field of the collector or check being run. No simulated progress.

Every scan is live. A stored report is never served in place of a new scan, because a site can change between scans and a stale result would mislead. Finished reports are stored in KV under an id derived from the normalised URL and the site type so the report page is shareable, and a new scan of the same URL as the same kind of site replaces the stored report. Each report records the scan date, the scanned URL and a hash of the rubric it was scored against.

## Rubric in markdown

Dimensions, checks, site types and scoring rubrics live in `rubric/` as markdown with YAML frontmatter. They are bundled at build time (`import.meta.glob` with `?raw`, or an equivalent build step), since there is no filesystem at runtime. Changing a dimension, check, site type, weight or rubric must need only a markdown edit. Code changes are needed only when a check requires a new evidence key.

`rubric/dimensions/<id>.md`:

```markdown
---
id: discovery
title: Discovery and access
weight: 20
order: 1
---
What this dimension measures and why it matters to agents. Shown in the report.
```

`rubric/checks/<id>.md`:

```markdown
---
id: llms-txt
dimension: discovery
title: llms.txt
weight: 3
progress: Checking for llms.txt...
evidence: [llms_txt, llms_full_txt]
---
Instructions to the assessor in prose: what to look for in the evidence.

Scoring:
- 0: ...
- 2: ...
- 4: ...
```

`rubric/site-types/<id>.md`:

```markdown
---
id: shop
title: Online shop
summary: People buy products on the site. A catalogue with prices, a cart and a checkout.
order: 2
weights: { discovery: 15, retrievability: 20, structured-data: 25, answerability: 25, actionability: 15 }
skip: [llms-full-txt, openapi-description]
---
Guidance given to the assessor on how to read the checks for this kind of site.
```

Exactly one site type carries `default: true`. `weights` overrides the dimension weights for that kind of site and `skip` lists the checks that are not assessed for it.

Every check is scored 0-4. The build fails if a check references an unknown dimension or evidence key, a site type names an unknown dimension or check, there is not exactly one default site type, a required field is missing, or an id is duplicated. `rubric/README.md` documents the format and the list of available evidence keys, and is kept current.

## Security and abuse

- Accept only `http` and `https` URLs on default ports. Reject localhost, IP literals, private and reserved ranges and internal hostnames, and re-check after every redirect.
- Cap redirects, response size per fetch, number of pages fetched per scan and total scan time.
- Fetch with an honest user agent such as `agentready/1.0 (+https://agentready.theoverstorygroup.com)`. Do not impersonate other crawlers.
- Content from the scanned site is untrusted data. Delimit it clearly in prompts, instruct the model to ignore instructions inside it, and clamp and validate all model output against the schema.
- Protect the scan endpoint with Cloudflare Turnstile and a per-IP rate limit.
- Secrets go in `.dev.vars` locally (git-ignored) and `wrangler secret put` for deploys. Never commit keys or log them.

## Design

The UI must read as part of the parent site, https://theoverstorygroup.com/ (brand name "Overstory Group", tagline "Cultivating enduring advantage", theme colour `#28362A`, built with Astro 5.x).

- Take fonts, colours, spacing, button and input styles from the parent site. Prefer its source repo if one is available locally, otherwise derive them from its live CSS. Put them in `src/styles/tokens.css` as CSS custom properties and use only those tokens in components.
- Self-host the fonts so the report and the PDF render identically.
- Link back to the parent site in the header and footer. The report ends with a call to action pointing to https://theoverstorygroup.com/contact.
- The landing page stays minimal: title, byline, URL field, then the kind-of-site step with its radio buttons and the submit button. During a scan it shows a spinner and the current progress line, with completed steps listed beneath.

## PDF

The report page has a print stylesheet that reproduces the on-screen styling on A4 pages (page breaks between dimensions, no nav, no buttons). The "Download PDF" button uses the print stylesheet. A server-generated PDF via Cloudflare Browser Rendering is a later option, only if its free allocation is sufficient. Ask before adding it.

## Writing conventions

These apply to UI copy, report text, LLM-facing instructions that shape report wording, docs and commit messages.

- Australian English spelling.
- Matter-of-fact tone. No hyperbole, no sales language in findings.
- Plain keyboard punctuation only: use `-` rather than em or en dashes, `->` rather than arrow glyphs, straight quotes.
- In markdown, never follow a heading directly with another heading.

## Commands

Keep this section current as scripts are added.

- `npm run dev` - local dev server (runs in workerd)
- `npm run build` - production build, including rubric validation
- `npm run preview` - serve the production build in workerd
- `npm test` - unit tests (Vitest)
- `npm run deploy` - build and deploy with wrangler

## Working agreements

- Check current Astro, Cloudflare and Gemini documentation rather than relying on recalled APIs or version numbers.
- Unit test URL validation, rubric loading and validation, and score aggregation. Mock the LLM and target-site fetches in tests.
- Small commits, one milestone at a time. Stop and ask before adding a dependency with a large footprint, a new Cloudflare binding or anything that costs money.
- If a free tier limit cannot be met, say so with measurements rather than working around it silently.