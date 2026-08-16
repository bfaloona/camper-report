# Cloudflare setup runbook

Everything here needs your Cloudflare account, so it can't be automated from a coding
session. It's plan Task 6, extracted so you don't have to read the plan to do it.

Roughly 15 minutes. Do the steps in order — `CF_ACCESS_AUD` in step 3 doesn't exist until
step 4 creates the Access application, so step 3 gets revisited at the end.

**What this achieves:** the public report stays on GitHub Pages, unauthenticated, exactly
as it is now. Cloudflare serves a second copy of the same repo *plus* the `/api/*`
endpoints and (later) the `/shortlist` tool, with those paths — and only those paths —
behind Google sign-in restricted to two email addresses.

---

## 0. Push first

Everything below assumes `main` on GitHub already has the `functions/` directory. Push
your local commits now:

```bash
git push
```

Then confirm on GitHub that `bfaloona/camper-report` at `main` shows a `functions/`
directory. If step 2 connects Pages before this, the first build deploys a `main` with
no `functions/` and there is nothing to gate.

## 1. KV namespace ✅ done 2026-08-16

Dashboard → **Storage & Databases → KV → Create instance**.

- Name: `camper-report-prefs`
- Namespace ID: `4ca243938a5d4211b27d133aff97981a`

You bind it by name in step 3, so the ID is only needed if the dashboard asks you to
disambiguate.

## 2. Pages project

Dashboard → **Workers & Pages → Create application → Pages tab → Import an existing Git
repository** → select `bfaloona/camper-report` → **Begin setup**.

> This step is dashboard-only and cannot be scripted. Connecting a repo runs a GitHub OAuth
> handshake that has no API or CLI equivalent, and per Cloudflare's docs you **cannot add Git
> integration to a Pages project after it exists** — so creating one with `wrangler pages
> project create` first would be a dead end requiring a delete and redo, not a head start.

| Setting | Value |
| --- | --- |
| Production branch | `main` |
| Build command | `npm ci` |
| Build output directory | `/` |

`npm ci` installs `@anthropic-ai/sdk` from the committed lockfile so the Functions
bundler can resolve it; skipping the build command risks a broken deploy if Pages
doesn't install dependencies on its own. There is no build step for the report itself
— `npm ci` only exists to make the dependency available to `functions/`.

Note the assigned `*.pages.dev` hostname — you need it in step 4.

## 3. Bindings and variables

Project → **Settings → Bindings → Add → KV namespace**:

| Variable name | Namespace |
| --- | --- |
| `PREFS` | `camper-report-prefs` |

Add it for **both** Production and Preview.

Project → **Settings → Variables and Secrets**, for both environments:

| Name | Type | Value |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | Secret | Your key from the Anthropic Console |
| `CF_ACCESS_TEAM_DOMAIN` | Plaintext | Your Zero Trust team domain, e.g. `something.cloudflareaccess.com` |
| `CF_ACCESS_AUD` | Plaintext | Filled in at step 5 — it doesn't exist yet |

> **Never set `DEV_BYPASS_EMAIL` here.** It's a local-only development escape hatch. The
> code only honors it when all three of these hold: `DEV_BYPASS_EMAIL` is set,
> `CF_ACCESS_AUD` is absent, and the request's hostname is a loopback address
> (`localhost`/`127.0.0.1`/`::1`). A deployed environment always has `CF_ACCESS_AUD` set
> and never serves on a loopback hostname, so a leak into the dashboard can't grant
> access — but there's no reason to test that.

## 4. Access application

Zero Trust → **Access controls → Applications → Add an application → Self-hosted**.

| Field | Value |
| --- | --- |
| Application name | `Camper Shortlist` |
| Public hostname | your `*.pages.dev` hostname from step 2 |
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

Go back to Pages → Settings → Variables and Secrets, set `CF_ACCESS_AUD` to that value for
both environments, and **redeploy** (Deployments → latest → Retry deployment). Variables are
read at request time but the deployment needs to pick up the new binding set.

## 6. Verify — don't skip this

From a signed-out browser or a private window:

1. `https://<host>/` → the report loads, **no login prompt**. If you get a login here, the
   Access application's paths are wrong; fix before continuing.
2. `https://<host>/api/prefs` → redirected to Google sign-in.
3. Sign in as `bfaloona@gmail.com` → a JSON blob renders.
4. Sign in as some third Google account → Access denies with its own block page.
5. Your existing GitHub Pages URL still serves the report unchanged.

Command-line equivalents for 1 and 2:

```bash
curl -si https://<host>/vehicles.json | head -1   # expect 200
curl -si https://<host>/api/prefs     | head -1   # expect a 302 to the Access login
```

Responses you might hit, and what each means:

| Response | Cause |
| --- | --- |
| `{"error":"Access verification is not configured"}` (500) | `CF_ACCESS_AUD` or `CF_ACCESS_TEAM_DOMAIN` didn't reach the deployed environment — recheck step 3, redeploy |
| `{"error":"The parsing service is not configured."}` (500) | `ANTHROPIC_API_KEY` isn't set. Only affects `/api/parse`; preferences still work |
| `{"error":"Not authenticated"}` (401) **after a successful Google sign-in** | Almost always a mistyped `CF_ACCESS_TEAM_DOMAIN` or `CF_ACCESS_AUD` — the sign-in succeeded but the Function can't verify the token it got. The body is deliberately generic; run `npx wrangler pages deployment tail` and look for an `auth:` line (e.g. `auth: aud_mismatch`, `auth: jwks_fetch_failed`) to tell the two apart. |

---

## If you add a custom domain later

The Access application above covers **one hostname**. Attaching a custom domain to the Pages
project does **not** extend that protection to it — you must create a second Access
application for the new hostname, or the tool becomes reachable there with no
authentication at all while `*.pages.dev` still looks correctly gated.

## What's still unproven until you run this

Local development uses a loopback-gated bypass, so every endpoint has been exercised
without Access. What that cannot test is whether a real Cloudflare Access token's claims
match what `functions/_lib/auth.js` expects — specifically the `aud` and `email` claims and
the JWKS endpoint at `https://<team-domain>/cdn-cgi/access/certs`. Step 6.3 is the first
moment that's proven. If it fails, the JWT verification logic is the place to look, and the
unit tests in `functions/_lib/auth.test.mjs` show the exact claim shape it expects.
