# Deployment

agentready runs as one Cloudflare Worker on the free plan with a KV namespace, a rate limiting binding, a Turnstile widget and a Gemini API key. Everything below is run from the repository root. Wrangler is a dev dependency, so `npx wrangler` uses the pinned version.

## What you need

- A Cloudflare account. The custom domain also needs `theoverstorygroup.com` to be an active zone in that account (see step 7).
- A Google AI Studio API key from https://aistudio.google.com/apikey on the free tier.
- Node.js 22.12 or later and npm. Note: npm 11.0.0 has a bug that breaks installs in this repository; if `npm install` fails with "Cannot read properties of null (reading 'edgesOut')", run `npx -y npm@latest install` or update npm with `npm install -g npm@latest`.

## 1. Log in

```bash
npx wrangler login
npx wrangler whoami
```

## 2. Create the KV namespace

```bash
npx wrangler kv namespace create REPORTS
```

Copy the `id` from the output into `wrangler.jsonc` under `kv_namespaces`, replacing `REPLACE_WITH_KV_NAMESPACE_ID`. Commit that change.

## 3. Create the Turnstile widget

In the Cloudflare dashboard open Turnstile and add a widget:

- Name: `agentready`
- Hostnames: `agentready.theoverstorygroup.com`, plus the `workers.dev` hostname from step 5 while the custom domain is not live
- Widget mode: Managed

Turnstile gives a site key (public) and a secret key.

- Site key: it is baked into the landing page at build time. Put it in `.env` (git-ignored) as `PUBLIC_TURNSTILE_SITE_KEY=...`, or set that variable in the environment where `npm run build` runs.
- Secret key:

```bash
npx wrangler secret put TURNSTILE_SECRET_KEY
```

Without a real site key the build uses the documented test key, which always passes and is only accepted by the matching test secret. Do not deploy with the test pair.

## 4. Set the Gemini secret and model

```bash
npx wrangler secret put GEMINI_API_KEY
```

`GEMINI_MODEL` is a plain var in `wrangler.jsonc` (`gemini-3.5-flash-lite`, see `docs/limits.md` for why). After the key exists, check the project's actual free-tier limits at https://aistudio.google.com/rate-limit and record them in `docs/limits.md`.

## 5. Deploy

```bash
npm run deploy
```

This validates the rubric, builds, and runs `wrangler deploy`. The first deploy prints the Worker's `workers.dev` address, for example `https://agentready.<account>.workers.dev`. Open it and run a scan.

If the deploy is rejected because the rate limiting binding is not available on the plan, remove the `ratelimits` block from `wrangler.jsonc` and deploy again. The code treats a missing binding as no limit.

## 6. Check it works

- Run a scan of a public site. The report should open at `/r/<id>` and a second scan of the same address should return at once with the stored report.
- `npx wrangler tail` streams the Worker's logs while you test.
- `npx wrangler kv key list --binding REPORTS --remote` lists stored reports.
- The dashboard shows requests, CPU time and errors under Workers and Pages. CPU time per request should sit well under 10 ms; if it does not, see the CPU note in `docs/limits.md`.

## 7. Custom domain

`agentready.theoverstorygroup.com` requires `theoverstorygroup.com` to be a zone in the same Cloudflare account, with no existing DNS record for the `agentready` name. Then either:

- uncomment the `routes` entry in `wrangler.jsonc` and run `npm run deploy` again, or
- in the dashboard open the Worker, then Settings, then Domains and Routes, and add the custom domain.

Cloudflare creates the DNS record and the certificate. Add the hostname to the Turnstile widget if it is not there already.

## Local development

- `.dev.vars` (git-ignored, see `.dev.vars.example`) holds `GEMINI_API_KEY` and `TURNSTILE_SECRET_KEY` for local runs. Set `LLM_PROVIDER=mock` to run without a key.
- `.env` (git-ignored, see `.env.example`) holds the public site key. The default test key is fine locally.
- `npm run dev` runs the site in workerd with a local KV namespace. `npm run preview` serves the production build the same way.

## Updating the rubric

Edit the markdown under `rubric/`, run `npm run validate` (or `npm run build`, which runs it), then deploy. Stored reports carry the hash of the rubric they were scored against; a repeat scan after a rubric change runs again instead of serving the stored report.

## Rolling back

```bash
npx wrangler deployments list
npx wrangler rollback
```
