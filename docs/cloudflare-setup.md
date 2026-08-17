# Cloudflare setup runbook

Everything here needs your Cloudflare account, so it can't be automated from a coding
session.

Roughly 15 minutes. **Do step 4 before step 3.** `CF_ACCESS_AUD` does not exist until the
Access application is created, so creating the application first means one pass through
the variables page instead of two. The steps are numbered in dependency order for a reader
starting from nothing; the order to *click* them is 1, 2, 4, 3, 6.

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
| Build command | `npm run build` |
| Deploy command | `npx wrangler deploy` |

The Worker's name in the dashboard must match the `name` field in `wrangler.jsonc` or the
build fails. Both are `camper-report`, so this is already satisfied — just don't rename one
without the other.

Workers Builds also runs on pushes to **any other branch**, with a separate non-production
deploy command that defaults to `npx wrangler versions upload`. That publishes a version
rather than promoting it. With `preview_urls: false` in `wrangler.jsonc` those versions get
no public hostname, which is the whole reason that setting is there — if you ever turn
preview URLs back on, every branch you push becomes an ungated copy of `/shortlist`.

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
| `CF_ACCESS_TEAM_DOMAIN` | Plaintext | Your Zero Trust team domain, e.g. `something.cloudflareaccess.com` |
| `CF_ACCESS_AUD` | Plaintext | The Audience (AUD) tag from the step-4 application |
| `ANTHROPIC_API_KEY` | Secret | Your key from the Anthropic Console |

The first two are what the auth guard needs; set both or every request 500s with
"Access verification is not configured". `ANTHROPIC_API_KEY` is only read by `/api/parse`
(turning typed prose into criteria) and can be deferred — without it the rest of the tool
works and only prose entry returns a "parsing service is not configured" error.

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

Identity provider: **One-time PIN**. It is built into Cloudflare and needs no OAuth setup —
Access emails a sign-in code to the address being authenticated, and it will only send to
one the policy above allows. That keeps the access rule identical to a Google login while
skipping the Google Cloud OAuth client entirely.

Google can be added later as a second provider without recreating the application. Whatever
you use, keep **two** providers enabled once you have them: a single provider having an
outage locks both of you out of your own tool.

The identity provider does not change what the Worker checks. Access issues the same JWT
shape either way, `functions/_lib/auth.js` reads the `email` claim from it, and
`ALLOWED_EMAILS` in that file re-checks the address against the same two-entry list. The
Access policy and the code allowlist have to agree — changing one without the other locks
someone out or, worse, only looks like it let them in.

## 5. Where the AUD tag comes from

Access application → **Overview** → **Audience (AUD) tag**. That value goes into
`CF_ACCESS_AUD` in step 3. It is a long hex string, specific to that one application, and
it changes if you delete and recreate the application — a recreated app with the old tag
still in the Worker gives a 401 after a *successful* sign-in, which is the most confusing
failure in this whole setup.

Variables take effect on the next deployment, so **redeploy after saving them**
(Deployments → latest → Retry, or `npm run deploy` again).

## 6. Verify — don't skip this

From a signed-out browser or a private window:

1. `https://camper-report.brandon-eaa.workers.dev/` → the report loads, **no login prompt**. If you get a login here, the
   Access application's paths are wrong; fix before continuing.
2. `https://camper-report.brandon-eaa.workers.dev/api/prefs` → Access sign-in page.
3. Sign in as `bfaloona@gmail.com` (One-time PIN mails you a code) → a JSON blob renders.
4. Try a third address → Access denies with its own block page, before the Worker ever
   runs. Do this one: it is the only check that proves the allowlist is actually applied
   rather than just written down.
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

Add the domain to `wrangler.jsonc` as well, not only in the dashboard. Wrangler treats the
config file as the source of truth for routing the same way it does for bindings, so a
route that exists only in the dashboard is liable to be dropped on the next deploy. That
failure is quiet: the Worker stays up on workers.dev and only the custom domain stops
answering.

## What's still unproven until you run this

Local development uses a loopback-gated bypass, so every endpoint has been exercised
without Access. What that cannot test is whether a real Cloudflare Access token's claims
match what `functions/_lib/auth.js` expects — specifically the `aud` and `email` claims and
the JWKS endpoint at `https://<team-domain>/cdn-cgi/access/certs`. Step 6.3 is the first
moment that's proven. If it fails, the JWT verification logic is the place to look, and the
unit tests in `functions/_lib/auth.test.mjs` show the exact claim shape it expects.

The other unproven path is `/api/parse` — no live call has been made against the Anthropic
API from this Worker, because no key was available during development.
