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


## 3. Variables and secrets ✅ Access vars done 2026-08-16

`CF_ACCESS_TEAM_DOMAIN` and `CF_ACCESS_AUD` live in `wrangler.jsonc` under `vars`, not in
the dashboard, and are already set. Neither is a secret: request any gated path
unauthenticated and Cloudflare's 302 to the login page carries the team domain in the
hostname and the AUD tag in the `kid` query parameter, so a plain `curl` reveals both. They
say *which* Access application guards this Worker; they grant nothing.

Still outstanding, and the only one that is genuinely secret:

```bash
npx wrangler secret put ANTHROPIC_API_KEY
```

That prompts for the value and never writes it to disk. It is read only by `/api/parse`
(turning typed prose into criteria) and can be deferred — without it the rest of the tool
works and only prose entry returns a "parsing service is not configured" error. Secrets are
never touched by a deploy.

> **Do not add bindings or Access variables in the dashboard.** `wrangler.jsonc` is the
> source of truth, and a deploy replaces the Worker's entire binding set from that file — a
> KV binding added by hand disappears on the next push. `keep_vars: true` is still set so
> that any *other* dashboard-managed variable survives, but nothing this project needs
> depends on that.

> **Never set `DEV_BYPASS_EMAIL` here.** It's a local-only development escape hatch. The
> code only honors it when all three of these hold: `DEV_BYPASS_EMAIL` is set,
> `CF_ACCESS_AUD` is absent, and the request's hostname is a loopback address
> (`localhost`/`127.0.0.1`/`::1`). A deployed Worker always has `CF_ACCESS_AUD` set and
> never serves on a loopback hostname, so a leak into the dashboard can't grant access —
> but there's no reason to test that.

## 4. Access application ✅ done 2026-08-16

Created and verified. Application `Camper Shortlist`, uid `39924a1a-b9f6-49cb-9c3f-ada9a748ef2c`,
on `camper-report.brandon-eaa.workers.dev`, with one Allow policy for the two owner
addresses and One-time PIN as the sign-in method.

**Created through the API, not the dashboard.** The dashboard form refuses to save a public
destination — see the clientless-isolation error below — so the application was created with
`POST /accounts/{account}/access/apps`, which simply omits the offending field. That needs a
token with **Access: Apps and Policies → Edit**. Note that `access/organizations` requires a
*different* permission, so a token scoped only to Apps and Policies can create the
application but cannot read the team domain back; take the team domain from the login
redirect instead (below).

Destinations, all four of them:

```
camper-report.brandon-eaa.workers.dev/shortlist
camper-report.brandon-eaa.workers.dev/shortlist/
camper-report.brandon-eaa.workers.dev/shortlist/*
camper-report.brandon-eaa.workers.dev/api/*
```

**`/shortlist/` is listed separately on purpose, and leaving it out is a real hole.** A
wildcard does not cover its parent, and `/shortlist/*` turns out not to match the bare
trailing slash either — which is the actual page URL. With only `/shortlist` and
`/shortlist/*` configured, `/shortlist/` returned 200 to an unauthenticated request. It was
caught by testing every path individually after the app was created; the app looked
correctly configured until then. An app is capped at 5 destinations, so there is exactly one
slot spare.

**Do not gate `/`.** Gating the root puts the public report behind a login and breaks the
thing you already have working.

Add the destination as a **public hostname**. On the **Additional settings** tab, leave
**Allow clientless access** off — it is only valid for private destinations reached through
a tunnel, and saving with it on fails with:

```
access.api.error.invalid_request: use_clientless_isolation_app_launcher_url
can only be enabled for apps with private destinations
```

If you see that, the toggle is on, or the destination went in as private rather than
public. A private destination would not reach the Worker even if the form saved.

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

## 5. Where the AUD tag comes from ✅ done 2026-08-16

Access application → **Overview** → **Audience (AUD) tag**. That value goes into
`CF_ACCESS_AUD` in step 3. It is a long hex string, specific to that one application, and
it changes if you delete and recreate the application — a recreated app with the old tag
still in the Worker gives a 401 after a *successful* sign-in, which is the most confusing
failure in this whole setup.

Variables take effect on the next deployment, so **redeploy after saving them**
(Deployments → latest → Retry, or `npm run deploy` again).

## 6. Verify

Already checked from the command line, on version `de9307ec`:

| Path | Result |
| --- | --- |
| `/shortlist`, `/shortlist/`, `/shortlist/index.html`, `/shortlist/scoring.js`, `/shortlist/prefs.js` | 302 to the Access login |
| `/api/prefs`, `/api/parse` | 302 to the Access login |
| `/`, `/vehicles.json`, `/camper-vehicle-comparison` | 200, no login |
| `https://bfaloona.cloudflareaccess.com/cdn-cgi/access/certs` | 200, two RSA keys, both `alg: RS256` |

That last row matters: `functions/_lib/auth.js` pins the algorithm to RS256 and fetches
exactly that JWKS endpoint, so the keys it needs are confirmed present and the right type.

**What no command-line check can prove** is the part that needs a real browser session:
whether a genuine Access token's `aud` and `email` claims match what the guard expects. Do
these from a signed-out browser or a private window:

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
