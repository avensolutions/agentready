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

## Deploy to Cloudflare Workers

These steps publish to `https://agentready.theoverstorygroup.com`. Run commands from the repository root. Wrangler is already a dev dependency; `npm ci` installs the version in the lockfile.

Before starting, `theoverstorygroup.com` must be an active Cloudflare zone in the same account as the Worker. Check that the `agentready` hostname is available. An existing CNAME must be removed before attaching a Custom Domain; check what it serves before replacing it. Cloudflare manages DNS and HTTPS for the Custom Domain, so no manual CNAME to `workers.dev` is needed. See [Cloudflare Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/).

### 1. Install and log in

Use the Node.js version described under "Run locally" above.

```sh
npm ci
npx wrangler login
npx wrangler whoami
```

Confirm the account owns `theoverstorygroup.com`. If you have multiple accounts, add its ID as a top-level `"account_id": "YOUR_ACCOUNT_ID"` in `wrangler.jsonc` before continuing.

### 2. Create report storage

Create the production KV namespace once:

```sh
npx wrangler kv namespace create REPORTS
```

Replace `REPLACE_WITH_KV_NAMESPACE_ID` in `wrangler.jsonc` with the returned `id`, keeping `"binding": "REPORTS"`. Keep the existing `SCAN_LIMITER` rate limiting binding. If it is rejected during deployment, resolve that error before releasing the scan endpoint.

### 3. Configure the subdomain

Merge these top-level properties into `wrangler.jsonc`, replacing the commented-out `routes` example at the bottom. Add a comma after the existing `ratelimits` array. Keep the other settings and bindings.

```json
{
  "workers_dev": false,
  "preview_urls": false,
  "routes": [
    {
      "pattern": "agentready.theoverstorygroup.com",
      "custom_domain": true
    }
  ]
}
```

Use the hostname exactly as shown, without `https://` or `/*`. This configuration serves the app on the custom domain and disables the additional `workers.dev` and version preview URLs. Commit the namespace ID and domain configuration; neither is a secret.

### 4. Prepare production keys

In the Cloudflare dashboard, open **Turnstile -> Add widget**. Name it `agentready`, add `agentready.theoverstorygroup.com` as a hostname and choose **Managed**. Save the site key and secret key. See [Turnstile widget setup](https://developers.cloudflare.com/turnstile/get-started/widget-management/dashboard/).

Create or edit the git-ignored `.env` file:

```dotenv
PUBLIC_TURNSTILE_SITE_KEY=YOUR_PRODUCTION_SITE_KEY
```

The site key is public and baked into the landing page, so set it before building and rebuild whenever it changes. Use the matching production secret in step 5. The example files contain test keys for local use only.

Get a Gemini API key from [Google AI Studio](https://aistudio.google.com/apikey). `GEMINI_MODEL` is set in `wrangler.jsonc`; check that model's available quota in [AI Studio](https://aistudio.google.com/rate-limit) and record it in [docs/limits.md](docs/limits.md). Leave `LLM_PROVIDER` unset in production so the app uses Gemini. `.dev.vars` is for local use and is not uploaded by deployment.

Configure [Gemini limit alerts](#gemini-limit-alerts) before releasing if you want admin email notifications.

### 5. Check, set secrets and release

Run each command after the previous one succeeds:

```sh
npm test
npm run build
npx wrangler deploy --dry-run
```

The dry run checks the deployment bundle without uploading it. It does not verify account permissions, DNS or production credentials. Always build after changing `.env` or `wrangler.jsonc`; Astro generates the deployment configuration during the build.

Upload the secrets, pasting each value at Wrangler's prompt:

```sh
npx wrangler secret put GEMINI_API_KEY
npx wrangler secret put TURNSTILE_SECRET_KEY
```

On the first release, Wrangler may ask to create the `agentready` Worker so it can store the secrets. Answer yes. These commands update Cloudflare immediately; on an existing Worker they deploy a new version with the changed secret. See [Cloudflare secrets](https://developers.cloudflare.com/workers/configuration/secrets/).

Deploy the build you just checked:

```sh
npx wrangler deploy
```

Cloudflare attaches the Custom Domain and provisions its DNS record and certificate. Once HTTPS is ready, open `https://agentready.theoverstorygroup.com`, run a scan and reopen the resulting `/r/<id>` link to check report storage.

For subsequent releases, run `npm test` followed by `npm run deploy`. The deploy script validates the rubric, builds and runs Wrangler. Existing secrets are retained; only repeat `secret put` when changing a key. The build environment still needs `PUBLIC_TURNSTILE_SITE_KEY`.

See [docs/deploy.md](docs/deploy.md) for verification, troubleshooting and rollback, and [Astro's Wrangler guide](https://docs.astro.build/en/guides/deploy/cloudflare/#how-to-deploy-with-wrangler) for the underlying deployment flow.

## Gemini limit alerts

The first Gemini rate-limit or daily-quota rejection triggers an admin email, including when a later retry succeeds. This detects an actual limit being hit, not a forecast or percentage of remaining quota. Daily quota errors stop the scan immediately. Temporary limits use the existing bounded retries; a provider delay longer than the retry window stops the scan instead of retrying early.

Users see a message explaining whether to wait a few minutes or wait for the daily allowance to reset. Failed scans do not save a report. Alert delivery runs in the background and cannot replace the user message.

Email uses the [Cloudflare Email Service REST API](https://developers.cloudflare.com/email-service/api/send-emails/rest-api/). Sending to a verified destination address is free on all plans, including accounts using only Email Routing. Arbitrary recipients require a paid plan; this setup uses one verified admin address. See [pricing](https://developers.cloudflare.com/email-service/platform/pricing/).

1. In **Compute -> Email Service -> Email Routing -> Destination Addresses**, add the admin's email and complete its verification email.
2. Onboard a sender domain or subdomain in Cloudflare Email Service. For an account using only Email Routing, use its configured domain. Use a dedicated mail subdomain if your main domain already receives mail through another provider; Email Routing changes MX records for the configured domain. Follow Cloudflare's [domain](https://developers.cloudflare.com/email-service/configuration/domains/) and [subdomain](https://developers.cloudflare.com/email-service/configuration/subdomains/) setup instructions.
3. Create a Cloudflare API token with **Email Sending: Edit**, scoped to this account.
4. Add these properties inside the existing `vars` object in `wrangler.jsonc`, using your account ID, configured sender and verified recipient:

   ```json
   {
     "ALERT_EMAIL_ACCOUNT_ID": "YOUR_CLOUDFLARE_ACCOUNT_ID",
     "ALERT_EMAIL_FROM": "agentready@alerts.theoverstorygroup.com",
     "ALERT_EMAIL_TO": "YOUR_VERIFIED_ADMIN_EMAIL"
   }
   ```

5. Build, store the token as a secret, then deploy:

   ```sh
   npm run build
   npx wrangler secret put ALERT_EMAIL_API_TOKEN
   npx wrangler deploy
   ```

Alerts include the model, UTC timestamp, quota identifiers and a link to AI Studio. They exclude scanned URLs, site evidence, API keys and raw provider errors. Repeats are suppressed for one hour per model and limit type using `alert:` keys in the existing `REPORTS` namespace. KV is eventually consistent, so simultaneous failures in different locations can produce duplicate emails. No new binding or dependency is required.

Without all four settings, email is disabled and a limit event logs `llm-alert` with status `unconfigured`. Delivery failures are logged without secrets and may be retried on a later limit event, after a one-minute cooldown within that Worker instance. See [alert verification and troubleshooting](docs/deploy.md#gemini-alerts).
