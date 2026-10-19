# Deployment

Follow [Deploy to Cloudflare Workers in the README](../README.md#deploy-to-cloudflare-workers) for account setup, KV, Turnstile, secrets and the `agentready.theoverstorygroup.com` Custom Domain. Run the commands below from the repository root.

## Values to generate

Everything below is specific to the Cloudflare account or the Google project and is not in the repository. Generate the values in this order, then follow the README steps and [Branch previews](#branch-previews) to put each one where it belongs.

1. The production KV namespace id in `kv_namespaces` in `wrangler.jsonc`: already set, from `npx wrangler kv namespace create REPORTS`. Only run that command again if the namespace has to be recreated, then replace the `id`.
2. `<PREVIEW_KV_NAMESPACE_ID>` in `previews.kv_namespaces` in `wrangler.jsonc`: the `id` returned by `npx wrangler kv namespace create REPORTS_PREVIEW`.
3. `<CLOUDFLARE_ACCOUNT_ID>`, only when the login has more than one account: the account id listed by `npx wrangler whoami`. Paste it into the commented-out `account_id` line in `wrangler.jsonc` and uncomment it.
4. `GEMINI_API_KEY`: from [Google AI Studio](https://aistudio.google.com/apikey). Never goes in the file. Store it with `npx wrangler secret put GEMINI_API_KEY` for production and `npx wrangler preview base-config secret put GEMINI_API_KEY` for previews.
5. `TURNSTILE_SECRET_KEY` and `PUBLIC_TURNSTILE_SITE_KEY`: from a Turnstile widget in the Cloudflare dashboard (**Turnstile -> Add widget**) with the hostnames `agentready.theoverstorygroup.com` and the account's `workers.dev` subdomain, or the [documented test keys](limits.md#turnstile) for previews. Store the secret with `npx wrangler secret put TURNSTILE_SECRET_KEY` for production and `npx wrangler preview base-config secret put TURNSTILE_SECRET_KEY` for previews. The site key is public and is baked in at build time: set it as the `PUBLIC_TURNSTILE_SITE_KEY` build variable in Workers Builds and in `.env` locally.
6. The Workers Builds connection: open the `agentready` Worker in the dashboard, then **Settings -> Builds -> Connect**. Production branch `main`, build command `npm run build`, deploy command `npx wrangler deploy`, preview command left at the default.
7. `ALERT_EMAIL_API_TOKEN`, only if Gemini limit alerts are wanted: a Cloudflare API token with Email Sending: Edit, scoped to the account, stored with `npx wrangler secret put ALERT_EMAIL_API_TOKEN`. The three `ALERT_EMAIL_*` vars are already in `wrangler.jsonc`; see [Gemini limit alerts in the README](../README.md#gemini-limit-alerts).

## Check it works

- Run a scan of a public site. The report should open at `/r/<id>`, and a second scan of the same address should run in full again and replace the stored report (every scan is live).
- `npx wrangler tail` streams the Worker's logs while you test.
- `npx wrangler kv key list --binding REPORTS --remote` lists stored reports and any `alert:` cooldown markers.
- The dashboard shows requests, CPU time and errors under Workers and Pages. Check scan and report requests against the free-plan limits in [limits.md](limits.md).

## Troubleshooting

- Domain attachment fails: confirm the zone is active in the selected account and check for a conflicting DNS record or existing hostname assignment. Keep the domain in `wrangler.jsonc` so later deployments preserve it.
- Turnstile fails: check the widget hostname, use its matching production site and secret keys, then rebuild and redeploy after changing the site key.
- Scans report that the service is not configured: use `npx wrangler secret list` to check that both `GEMINI_API_KEY` and `TURNSTILE_SECRET_KEY` exist. This lists names, not values.
- A rate limiting binding error blocks deployment: resolve it before release. Removing `SCAN_LIMITER` would leave scans without the required per-IP rate limit.

## Gemini alerts

Configure the sender, verified recipient, account ID and token using [the README](../README.md#gemini-limit-alerts). The recipient can be an external mailbox. Only sends to verified destinations use the free path.

- `npm test` simulates quota exhaustion, temporary limits, successful retries, duplicate suppression and email failures. It sends no real email and makes no real Gemini calls.
- Before launch, use the [Cloudflare REST API example](https://developers.cloudflare.com/email-service/api/send-emails/rest-api/#send-an-email) with your configured sender and recipient to check delivery without consuming Gemini quota. Keep the API token out of committed files and shell history.
- `npx wrangler tail` shows `llm-alert` entries after a Gemini limit occurs. `accepted` means Cloudflare accepted or queued the email, not that it reached the inbox. Check Email Service delivery logs and the recipient's spam folder if needed.
- `unconfigured` means a required alert setting is missing or invalid. `failed` includes a stage: `email` for sending, `dedup-read` or `dedup-write` for the KV cooldown marker. The scan's user message is still returned. Failed sends do not create a success marker.
- `npx wrangler kv key list --binding REPORTS --prefix 'alert:' --remote` lists active cooldown markers. They expire after one hour. If a marker read fails, the email is skipped to avoid an uncontrolled burst; if a marker write fails after sending, only the current Worker instance retains the cooldown.

Alerts are triggered by scan traffic when Gemini rejects a request. There is no quota polling, advance percentage warning or durable delivery queue. A generic 429 without daily-quota details is treated as a temporary limit. Daily quotas reset at midnight Pacific time, not Australian midnight. Account-specific quotas remain visible in [AI Studio](https://aistudio.google.com/rate-limit).

## Local development

- `.dev.vars` (git-ignored, see `.dev.vars.example`) holds `GEMINI_API_KEY` and `TURNSTILE_SECRET_KEY` for local runs. Set `LLM_PROVIDER=mock` to run without a key.
- `.env` (git-ignored, see `.env.example`) holds the public site key. The default test key is fine locally.
- `npm run dev` runs the site in workerd with a local KV namespace. `npm run preview` serves the production build the same way.

## Updating the rubric

Edit the markdown under `rubric/`, run `npm run validate` (or `npm run build`, which runs it), then deploy. Stored reports carry the hash of the rubric they were scored against, shown on the report page, so a report can be read against the rubric that produced it.

## Branch previews

Cloudflare's equivalent of a Netlify deploy preview is a Workers Preview, built by Workers Builds. Once the Worker is connected to the GitHub repository, a push to `main` builds and deploys production, and a push to any other branch runs `npx wrangler preview`, which serves that branch at `<branch>-agentready.<subdomain>.workers.dev` and posts the link as a comment on the pull request. Both are on the free plan: 3,000 build minutes a month and up to 100 Previews per Worker (see [limits.md](limits.md)). Previews need Wrangler 4.135 or later, which `package.json` already pins above.

A Preview does not inherit production settings. It takes its vars and bindings from the `previews` block in `wrangler.jsonc` and its secrets from the Previews base configuration, so set these up once before connecting the repository.

1. Create a KV namespace for preview reports and put its id in `previews.kv_namespaces` in `wrangler.jsonc`, replacing `<PREVIEW_KV_NAMESPACE_ID>`. Preview scans then never write to the production namespace, and their reports expire after a day.

   ```sh
   npx wrangler kv namespace create REPORTS_PREVIEW
   ```

2. Store the two secrets in the Previews base configuration. Every new Preview receives them; a change applies to Previews created afterwards, so re-run for an open branch with `npx wrangler preview secret put <NAME> --name <branch>` if needed. Previews share the production Gemini key, so preview scans spend the same free daily quota.

   ```sh
   npx wrangler preview base-config secret put GEMINI_API_KEY
   npx wrangler preview base-config secret put TURNSTILE_SECRET_KEY
   ```

3. Turnstile only answers for hostnames on the widget. Either add the account's `workers.dev` subdomain to the production widget, or create a second widget for previews and use its secret in step 2 and its site key in step 4. The documented test keys also work and are the simplest choice while previews are only used by the team.

4. In the dashboard open the `agentready` Worker, then **Settings -> Builds -> Connect**, pick the repository, set the production branch to `main`, the build command to `npm run build`, the deploy command to `npx wrangler deploy` and leave the preview command at its default `npx wrangler preview`. Add `PUBLIC_TURNSTILE_SITE_KEY` as a build variable; the landing page bakes it in at build time. The Worker name in the dashboard must match `name` in `wrangler.jsonc` or the build fails.

5. Push a branch and open a pull request. The Preview URL appears under **Previews** on the Worker and in the pull request comment. The first build on an existing branch may need a push to trigger.

Things to know:

- Preview URLs are public by default. Put Cloudflare Access in front of them if that matters.
- A Preview has no rate limiting binding. The scan endpoint runs without one (nothing is limited) and Turnstile remains the gate.
- `preview_urls` must stay `true` in `wrangler.jsonc`; `workers_dev: false` keeps production off `workers.dev` without affecting Previews. Routes and the custom domain apply to production only.
- Previews are cleaned up automatically from the least recently deployed once the limit is reached. To remove one by hand: `npx wrangler preview delete --name <branch>`.

## Rolling back

```bash
npx wrangler deployments list
npx wrangler rollback
```
