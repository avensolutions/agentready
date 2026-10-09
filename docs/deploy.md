# Deployment

Follow [Deploy to Cloudflare Workers in the README](../README.md#deploy-to-cloudflare-workers) for account setup, KV, Turnstile, secrets and the `agentready.theoverstorygroup.com` Custom Domain. Run the commands below from the repository root.

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

## Rolling back

```bash
npx wrangler deployments list
npx wrangler rollback
```
