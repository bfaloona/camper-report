# Cloudflare setup runbook

Everything here needs your Cloudflare account, so it can't be automated from a coding
session. It's plan Task 6, extracted so you don't have to read the plan to do it.

Roughly 15 minutes. Do the steps in order — `CF_ACCESS_AUD` in step 3 doesn't exist until
step 4 creates the Access application, so step 3 gets revisited at the end.

**What this achieves:** the public report stays on GitHub Pages, unauthenticated, exactly
as it is now. A Cloudflare Worker serves a second copy of the same report *plus* the
`/api/*` endpoints and the `/shortlist` tool, with those paths — and only those paths —
behind Google sign-in restricted to two email addresses.

**This deploys to a Worker, not to Pages.** The `camper-report` Worker already exists in
your account. The repo carries `wrangler.jsonc`, which names that Worker, so a deploy
targets it rather than creating anything new.

---

## 0. Push first

Everything below assumes `main` on GitHub already has `functions/`, `wrangler.jsonc`, and
`scripts/build-assets.mjs`. Push your local commits now:

```bash
git push
```

If step 2 connects the repo before this, the first build runs against a `main` with no
`wrangler.jsonc` and fails.

## 1. KV namespace ✅ done 2026-08-16

Dashboard → **Storage & Databases → KV → Create instance**.

- Name: `camper-report-prefs`
- Namespace ID: `4ca243938a5d4211b27d133aff97981a`

Nothing left to do here. The ID is already written into `wrangler.jsonc`, which is what
binds it — you do **not** add a KV binding in the dashboard (see the warning in step 3).

## 2. Deploy the Worker ✅ first deploy done 2026-08-16

Live at **`https://camper-report.brandon-eaa.workers.dev`**. That's the hostname step 4
needs. Verified after deploy: `/`, `/vehicles.json`, `/shortlist/`, and both shortlist JS
files serve; `/api/*` returns the expected "not configured" 500 until step 5; and
`package.json`, `.dev.vars`, `wrangler.jsonc`, `CLAUDE.md`, `functions/*.js`, and the test
files all 404.

Assets can take a minute to propagate after a deploy — a 404 on a file you know you
uploaded is worth one retry before you start debugging it.

Preview URLs are disabled in `wrangler.jsonc`. Leave them off: they would put `/shortlist`
and `/api/*` on a second hostname that the step-4 Access application does not name, and so
does not gate.

Redeploying, either way below, is safe to repeat.

### 2a. Git integration (recommended — deploys on every push)

Dashboard → **Workers & Pages** → select **camper-report** → **Settings → Builds →
Connect**, and authorize the Cloudflare GitHub App for `bfaloona/camper-report`.

| Setting | Value |
| --- | --- |
| Production branch | `main` |
| Build command | `npm ci && npm run build` |
| Deploy command | `npx wrangler deploy` |

The Worker's name in the dashboard must match the `name` field in `wrangler.jsonc` or the
build fails. Both are `camper-report`, so this is already satisfied — just don't rename one
without the other.

### 2b. Deploy from your laptop

```bash
npx wrangler login
npm run deploy
```

`npm run deploy` stages the assets, compiles `functions/` into a Worker script, and
publishes. Use this for a one-off; it means every future change needs you to run it again.

The workers.dev route is already enabled. If you ever need to re-check the hostname, it is
under **Settings → Domains & Routes**.


## 3. Variables and secrets

Worker → **Settings → Variables and Secrets**:

| Name | Type | Value |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | Secret | Your key from the Anthropic Console |
| `CF_ACCESS_TEAM_DOMAIN` | Plaintext | Your Zero Trust team domain, e.g. `something.cloudflareaccess.com` |
| `CF_ACCESS_AUD` | Plaintext | Filled in at step 5 — it doesn't exist yet |

> **Do not add bindings in the dashboard.** `wrangler.jsonc` is the source of truth for
> bindings, and a deploy replaces the Worker's entire binding set from that file — a KV
> binding added here disappears on the next push. The two plaintext vars above survive only
> because `wrangler.jsonc` sets `keep_vars: true`; without it a deploy would delete them
> and every request would 500. Secrets are never touched by a deploy either way.

> **Never set `DEV_BYPASS_EMAIL` here.** It's a local-only development escape hatch. The
> code only honors it when all three of these hold: `DEV_BYPASS_EMAIL` is set,
> `CF_ACCESS_AUD` is absent, and the request's hostname is a loopback address
> (`localhost`/`127.0.0.1`/`::1`). A deployed Worker always has `CF_ACCESS_AUD` set and
> never serves on a loopback hostname, so a leak into the dashboard can't grant access —
> but there's no reason to test that.

## 4. Access application

Zero Trust → **Access controls → Applications → Add an application → Self-hosted**.

| Field | Value |
| --- | --- |
| Application name | `Camper Shortlist` |
| Public hostname | `camper-report.brandon-eaa.workers.dev` |
| Paths | `/shortlist*` **and** `/api/*` |

**Do not gate `/`.** Gating the root puts the public report behind a login and breaks the
thing you already have working.

Policy:

| Field | Value |
| --- | --- |
| Name | `Owners` |
| Action | `Allow` |
| Rule | **Emails** → `bfaloona@gmail.com`, `kristenwalshseattle@gmail.com` |

Identity provider: **Google**. Add **One-time PIN** as a second provider — if Google auth
has an outage and it's your only provider, both of you are locked out of your own tool.

## 5. Finish the `CF_ACCESS_AUD` variable

Open the Access application you just made → **Overview** → copy the **Audience (AUD) tag**.

Go back to the Worker → Settings → Variables and Secrets, set `CF_ACCESS_AUD` to that
value, and **redeploy** (Deployments → latest → Retry, or `npm run deploy` again).

## 6. Verify — don't skip this

From a signed-out browser or a private window:

1. `https://camper-report.brandon-eaa.workers.dev/` → the report loads, **no login prompt**. If you get a login here, the
   Access application's paths are wrong; fix before continuing.
2. `https://camper-report.brandon-eaa.workers.dev/api/prefs` → redirected to Google sign-in.
3. Sign in as `bfaloona@gmail.com` → a JSON blob renders.
4. Sign in as some third Google account → Access denies with its own block page.
5. Your existing GitHub Pages URL still serves the report unchanged.

Command-line equivalents for 1 and 2:

```bash
curl -si https://camper-report.brandon-eaa.workers.dev/vehicles.json | head -1   # expect 200
curl -si https://camper-report.brandon-eaa.workers.dev/api/prefs     | head -1   # expect a 302 to the Access login
```

Responses you might hit, and what each means:

| Response | Cause |
| --- | --- |
| `{"error":"Access verification is not configured"}` (500) | `CF_ACCESS_AUD` or `CF_ACCESS_TEAM_DOMAIN` didn't reach the deployed Worker — recheck step 3, redeploy. If they were set and then vanished, `keep_vars` is missing from `wrangler.jsonc` |
| `{"error":"The parsing service is not configured."}` (500) | `ANTHROPIC_API_KEY` isn't set. Only affects `/api/parse`; preferences still work |
| `{"error":"Not authenticated"}` (401) **after a successful Google sign-in** | Almost always a mistyped `CF_ACCESS_TEAM_DOMAIN` or `CF_ACCESS_AUD` — the sign-in succeeded but the Worker can't verify the token it got. The body is deliberately generic; run `npx wrangler tail camper-report` and look for an `auth:` line (e.g. `auth: aud_mismatch`, `auth: jwks_fetch_failed`) to tell the two apart |
| 404 on a page that used to work | The file isn't in the allowlist in `scripts/build-assets.mjs`. Only files named there are uploaded |

**Right now, until you finish step 4, the `/shortlist` page is publicly reachable.** No
data leaks —
`/api/prefs` fails closed with a 500 while `CF_ACCESS_AUD` is unset, so the page loads but
can't read or write anything. If that window bothers you, create the Access application
before the first deploy.

---

## If you add a custom domain later

The Access application above covers **one hostname**. Attaching a custom domain to the
Worker does **not** extend that protection to it — you must create a second Access
application for the new hostname, or the tool becomes reachable there with no
authentication at all while the workers.dev hostname still looks correctly gated.

## What's still unproven until you run this

Local development uses a loopback-gated bypass, so every endpoint has been exercised
without Access. What that cannot test is whether a real Cloudflare Access token's claims
match what `functions/_lib/auth.js` expects — specifically the `aud` and `email` claims and
the JWKS endpoint at `https://<team-domain>/cdn-cgi/access/certs`. Step 6.3 is the first
moment that's proven. If it fails, the JWT verification logic is the place to look, and the
unit tests in `functions/_lib/auth.test.mjs` show the exact claim shape it expects.

The other unproven path is `/api/parse` — no live call has been made against the Anthropic
API from this Worker, because no key was available during development.
