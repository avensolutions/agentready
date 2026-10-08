# agentready

agentready takes a website address, assesses the site for agent experience (AX, also called AEO) and returns an overall score with a score per dimension, findings and recommendations. It is a tool from [Overstory Group](https://theoverstorygroup.com/), served at `agentready.theoverstorygroup.com`.

## Stack

- Astro 7 with the Cloudflare adapter, deployed as a Cloudflare Worker on the free plan
- Plain JavaScript (ES modules, JSDoc for types)
- Google Gemini API for the assessment, behind a provider-neutral interface in `src/lib/llm/`
- Workers KV for finished reports
- Vitest for unit tests

Platform limits that shape the design are recorded in `docs/limits.md`.

## Run locally

Prerequisites: Node.js 22.12 or later (even versions only) and npm.

```bash
npm install
cp .dev.vars.example .dev.vars   # then fill in GEMINI_API_KEY
npm run dev                      # http://localhost:4321, runs in workerd
```

Other commands:

```bash
npm run build    # production build into dist/, including rubric validation
npm run preview  # serve the production build in workerd
npm test         # unit tests
npm run deploy   # build and deploy with wrangler
```

## Layout

- `src/styles/tokens.css` - design tokens derived from the parent site; components use only these
- `src/layouts/`, `src/components/` - shared chrome
- `src/pages/` - landing page, scan endpoint and report page
- `src/lib/` - URL safety, collectors, LLM provider, scoring
- `rubric/` - dimensions, checks and site types as markdown with YAML frontmatter
- `docs/` - platform limits and other notes
- `test/` - Vitest unit tests

## Configuration

`wrangler.jsonc` holds the Worker config, the `REPORTS` KV binding, the `SCAN_LIMITER` rate limiting binding and plain vars (`GEMINI_MODEL`, `REPORT_TTL_DAYS`). Secrets (`GEMINI_API_KEY`, `TURNSTILE_SECRET_KEY`) go in `.dev.vars` locally and `npx wrangler secret put <NAME>` for deploys. The public Turnstile site key is a build-time variable, `PUBLIC_TURNSTILE_SITE_KEY`, set in `.env` or the build environment. Never commit keys.

Set `LLM_PROVIDER=mock` in `.dev.vars` to run locally without a Gemini key.

Deployment steps are in `docs/deploy.md`.
