# Camper Vehicle Comparison

A single-page report comparing vehicles for camper / car-camping conversions. No
build step, no framework, no dependencies — just data plus one self-contained HTML page.

## Files

| File | Role |
| --- | --- |
| `vehicles.json` | **Source of truth.** One record per vehicle-generation, deeply researched with sources. |
| `index.html` | The report. Embeds a render-trimmed copy of the data and renders it with vanilla JS. |
| `camper-vehicle-comparison.html` | **Byte-for-byte identical to `index.html`.** Keep them in sync. |
| `scripts/sync_vehicles.py` | Propagates `vehicles.json` into the embedded data in both HTML files, and syncs `index.html`'s presentation into `shortlist/index.html`. |
| `.claude/skills/add-vehicle/` | Skill: how to research and add a new vehicle record. |
| `shortlist/` | The Shortlist tool: a preference-driven ranking view over the same dataset. See below. |
| `functions/` | Source for the Shortlist tool's `/api/*` endpoints and Access auth guard, in Pages Functions layout. Compiled to a Worker at build time. See below. |
| `wrangler.jsonc` | Worker config: name, assets directory, KV binding, `keep_vars`. Source of truth for bindings. |
| `scripts/build-assets.mjs` | Stages the served files into `dist/client/`. An **allowlist** — a file not named there is never published. |
| `_config.yml` | The same restriction for GitHub Pages, which serves the repo root: an **exclude list** keeping `shortlist/`, `functions/` and the tooling off the public site. |
| `docs/cloudflare-setup.md` | One-time Cloudflare dashboard runbook for the Shortlist deployment. |

There is no bundler or generator: `index.html` ships the data inline. The two HTML
files must stay identical — every change to one must be mirrored in the other (the
sync script does this for the data block).

`npm run build` is only for the Cloudflare deployment. It stages assets into `dist/client/`
and compiles `functions/` into `dist/worker/index.js` via `wrangler pages functions build`
— the directory layout is still Pages Functions, but the artifact is a Worker. `dist/` is
git-ignored; GitHub Pages serves the repo root and never sees it.

## How the data is embedded

Each HTML file carries the dataset inline between markers:

```js
const DATA = /*DATA-START*/{ "updated": "...", "vehicles": [ ... ] }/*DATA-END*/;
```

The embedded copy is a **render-only subset** of `vehicles.json` — research metadata
the page never displays is stripped to keep the HTML small. The differences are:

- top-level `$schema_note` is omitted;
- each vehicle drops `sources` and `notes`;
- each `conversion_products` entry keeps only `name` + `url` (drops `type`);
- each `photos` slot keeps only `url` + `note` (drops `source_page` + `license`);
- `vehicles.json` is pretty-printed at indent=2; the embedded block at indent=1.

**Never hand-edit the embedded `DATA` block.** Edit `vehicles.json`, then run:

```bash
python3 scripts/sync_vehicles.py          # append vehicles missing from the HTML
python3 scripts/sync_vehicles.py --rebuild # regenerate every entry (after editing existing ones)
python3 scripts/sync_vehicles.py --check   # verify in sync (no writes); exits non-zero if not
```

The default mode is append-only, so adding a vehicle produces a minimal diff and
leaves existing embedded entries untouched. Use `--rebuild` when you have changed a
field on an *existing* vehicle and need that change to reach the page.

`index.html` also owns three marked blocks — `/*STYLE-*/` (its CSS), `/*RENDER-*/`
(its card/table render functions) and `/*DETAIL-*/` (the per-vehicle detail overlay:
its markup, its renderer and its close wiring). The Shortlist page
(`shortlist/index.html`) has no way to import them as ES modules without breaking
`file://` use, so it receives copies instead:

```bash
python3 scripts/sync_vehicles.py --shared        # copy the shared blocks into shortlist/index.html
python3 scripts/sync_vehicles.py --check-shared  # verify those blocks are in sync
```

`--check` runs `--check-shared` too, so one command still verifies everything.

## The vehicle record schema

Every record in `vehicles.json` carries the same fields (all 25 current records are
complete — match that). Measurements are in inches; money in USD. Key conventions:

- `id`: kebab-case `make-model-generation`, e.g. `hyundai-tucson-hybrid-nx4`. Unique.
- `class`: one of `SUV`, `Minivan`, `Compact minivan`, `Compact van`, `Wagon`, `Hatchback`.
- `powertrain`: one of `gas`, `hybrid`, `phev`, `ev`. PHEV and EV records add `mpge` +
  `ev_range_mi` to `mpg`. For `ev` records, `mpg.city`/`mpg.hwy` hold the EPA **MPGe**
  city/highway figures and `mpg.note` must say so.
- `drivetrain`: the *listed trim's* configuration — `AWD`, `4WD`, `FWD`, or `RWD`. The
  page's drivetrain filter buckets these two ways: `AWD`/`4WD` vs `FWD`/`RWD`.
- `tow_rating`: `{ max, tongue, note, source }`. `max` = max towing capacity in lbs
  (`0` = not rated for US towing); `tongue` = published max tongue weight in lbs or `null`
  when the manufacturer doesn't publish one. Shown as a sortable column.
- `listed_year`: `min(latest model year available, 2024)`, except models not sold in the
  US in/before 2024, which use their first US model year. One generation per record.
  Exception: `chevrolet-bolt-ev-gen1` uses `2022`, not the rule's `2023` — that model year
  was requested specifically, and 2022/2023 are mechanically identical (see `trim_rationale`).
- `kbb_value_usd`: `{ low, high, assumption, source }`. KBB pages often 403 on direct
  fetch — cite search-surfaced figures and say so in `assumption`.
- `cargo_length_behind_front_seats_in`: `{ value, method, source }`. This is almost
  always community/reviewer-measured, **not** an official spec — say so in `method`.
- `camper_popularity.rating`: `High` / `Medium` / `Low`, backed by real `evidence`.
- `photos`: `exterior` / `dashboard` / `cargo`, each `null` or
  `{ url, source_page, license, note? }`. Prefer Wikimedia Commons (public-domain / CC),
  using the direct `upload.wikimedia.org` URL. Note when a shown trim/powertrain differs.
- `reliability`: `{ score (RepairPal /5), scale, jd_power?, known_issues, source }`.
- Researched camper facts, each `{ value, source, ... }` with `null` when honestly
  unanswerable: `ground_clearance_in` (inches, manufacturer spec),
  `spare_tire` (`full-size`/`compact`/`none`), `still_in_production` (bool),
  `dc_fast_charging` (bool; gas/hybrid are an honest `false`, note in place of a
  source), and `onboard_ac_power` (`none`/`low_watt`/`high_watt`) — whose `basis`
  is **available on this generation from the factory, any trim or option**, a
  deliberate, documented divergence from `equipment`'s standard-on-listed-trim
  rule (decision Q2, 2026-08-17). The Shortlist trait picker gates on these.
- `camper_pros` / `camper_cons`: bullet strings written for the camping use case.
- `sources`: every URL used. `last_verified`: ISO date of the research pass.

To add a vehicle, use the **add-vehicle** skill (`.claude/skills/add-vehicle/SKILL.md`),
which carries the full field checklist and the exact edit-and-sync procedure.

## The Shortlist tool (`shortlist/`)

A preference-driven ranking view over the same dataset, deployed only to the Cloudflare
Worker (never GitHub Pages) and gated by Cloudflare Access to two accounts. Both accounts
read and write one shared preferences blob in Workers KV (`prefs:v1`), so there is no
per-user state — one person's saved criteria and pins are the other's too.

| File | Role |
| --- | --- |
| `shortlist/index.html` | The page. Its `/*STYLE-*/`, `/*RENDER-*/` and `/*DETAIL-*/` blocks are **copies** — edit `index.html` and re-run `--shared`. |
| `shortlist/scoring.js` | Pure scoring: field vocabulary (`FIELDS`), hard gates, weighted ranking. Unit-tested. |
| `shortlist/prefs.js` | Client for `/api/prefs` and `/api/parse`, including the etag conflict guard. |
| `shortlist/traits.js` | Trait-picker vocabulary (`TRAITS`) + compiler: selections (`prefs.traits`) compile to ordinary gate criteria at rank time, never stored as criteria. Unit-tested. |
| `shortlist/trait-evidence.js` | **Generated** by `scripts/gen_trait_evidence.py` from `docs/trait-picker-classification.md` — the pros/cons bullets shown as evidence under each trait. Rerun the script after bullet or classification changes; don't hand-edit. |
| `functions/api/prefs.js` | GET/PUT the shared blob in KV (`pins`, `criteria`, `notes`). |
| `functions/api/parse.js` | Prose → criteria via `claude-opus-5`, validated against the field vocabulary (`FIELD_IDS`). |
| `functions/_lib/auth.js` | Verifies the Cloudflare Access JWT signature and checks the email allowlist. |

Things that will bite you if you don't know them:

- **The two field vocabularies must stay in sync.** `functions/api/parse.js` exports
  `FIELD_IDS` (fields the parser may emit); `shortlist/scoring.js` exports `FIELDS`
  (fields the scorer can resolve). If they drift, a criterion can name a field the
  scorer can't read, and it **silently never scores** — no error, just a preference that
  quietly does nothing. `shortlist/scoring.test.mjs` ("every field the parser can emit
  is one the scorer can read") enforces `FIELD_IDS ⊆ FIELDS`. Adding a scoreable
  attribute means adding it to `NUMERIC_FIELDS`/`ENUM_FIELDS` in `parse.js` (`FIELD_IDS`
  is derived from those) **and** to `FIELDS` in `scoring.js`.
- **EV fuel economy is not MPG.** For `powertrain: "ev"` records, `mpg.city`/`mpg.hwy`
  hold EPA MPGe, not MPG. `FIELDS.mpg_city`/`mpg_hwy` deliberately return `null` for EVs
  so an MPG criterion treats them as no data instead of ranking an EV first on
  "efficiency" against gas vehicles. Don't "fix" that null.
- **A criterion with no data is dropped from that vehicle's scale, not scored zero.**
  `rankVehicles` builds the 0..100 denominator per vehicle from the criteria it could
  actually evaluate, so missing data neither lowers nor raises a score; the criteria
  left out are returned in `exempt` and the page marks the score with a `*`. The
  exception is a null the schema documents as a real absence rather than a research
  gap — an EV has no MPG, a gas car has no EV range. Those fields carry an `naWhen`
  predicate in `FIELDS` (read it with `fieldNA`), score as the worst case with their
  weight still in the denominator, and never earn the asterisk. Gating is unaffected:
  `evaluateGate` still returns `'unknown'` for every null, n/a included, so a
  must-have never excludes on missing data. `unknowns` on a ranked row now means
  *gate* criteria that couldn't be checked; scoring gaps live in `exempt`.
- **Scores are normalized over the surviving (non-excluded) vehicle set**, not a fixed
  scale — the top of a filtered list reads close to 100 regardless of the filter, and a
  score is not comparable between sessions with different criteria. Deliberate.
- **The `/*STYLE-*/`/`/*RENDER-*/`/`/*DETAIL-*/` blocks in `shortlist/index.html` are
  copies of `index.html`'s, not a shared module.** They're copied instead of imported because the
  report must keep working when opened directly over `file://`, where the browser
  blocks ES module imports — the Shortlist page doesn't have that constraint (see next
  point), but sharing the presentation this way meant not rewriting it twice.
- **The synced render block expects host-page globals it doesn't declare.** It reads
  `state.pins`/`state.selected`/`state.sortKey`/`state.sortDir` and calls a global
  `render()`; it also calls `loadPins()` at load time, which lives outside the copied
  markers in `index.html`. Any new page consuming these blocks needs to supply those
  shims. `window.state = {...}` does **not** work — a classic `<script>`'s `let state`
  shadows an identically-named `window` property — so mutate the existing `state`
  object's fields in place instead of replacing it.
- **The synced detail block injects its own markup and takes a vehicle record, not an
  id.** `showDetail(v)` is handed the record so the block never has to know where the
  host page keeps its data (inline `DATA` in the report, a fetched array on the
  Shortlist page); the overlay and lightbox `<div>`s are appended to `<body>` at load
  from inside the block, because the `/*NAME-*/` sync only carries script text. The
  template may only read fields the *trimmed* embedded copy keeps: the Shortlist
  passes the full record, so a field stripped from the embedded data would render
  there and break in the report. Wiring
  a row click to it is the host page's job — the report's `#tbody` handler also owns
  compare-checkbox behaviour the Shortlist deliberately doesn't have.
- **A want with no usable rule becomes a note, not a criterion.** `/api/parse` returns
  `{ criteria, notes }`; `splitParse` routes anything `validRule` rejects into `notes`,
  including entries the model confidently labelled `hard`. There is deliberately no
  `manual` kind any more: an inert criterion carried a tier, weight and rank that did
  nothing, and a manual "must-have" reported itself as satisfied while filtering nothing.
  The dataset holds no comfort/equipment data at all, so wants like heated seats or a
  sunroof can only ever be notes. Criteria stored before this change are migrated into
  `notes` on page load.
- **Stored criteria are untrusted on read.** `PUT /api/prefs` validates only that
  `prefs.criteria` and `prefs.pins` are arrays, not the shape of each criterion, by
  design — `/api/parse`'s `validateCriteria` owns that schema. Anything that reads the
  blob back must tolerate malformed entries rather than assume they're well-formed.
- **Local development:** `npm run dev`, with `DEV_BYPASS_EMAIL` set in `.dev.vars`
  (git-ignored). The bypass only activates when `DEV_BYPASS_EMAIL` is set, `CF_ACCESS_AUD`
  is absent, and the request host is loopback. That middle condition is why the `dev`
  script passes `--var CF_ACCESS_AUD:` — `wrangler.jsonc` sets that variable for the
  deployed Worker, and `wrangler dev` would otherwise apply it locally too and lock you
  out of your own dev server with a 401. The override is dev-only; `wrangler deploy`
  never sees it. Unlike the report, **the Shortlist page
  cannot be opened over `file://`** — it calls `/api/prefs`, `/api/parse`, and
  `/vehicles.json` as same-origin relative paths with no CORS handling, because in
  production it's always same-origin behind Access.
- **`wrangler dev` serves from `dist/client/`, not the repo root.** Editing an HTML file
  does nothing until you rebuild, which is why `npm run dev` runs the build first. A bare
  `npx wrangler dev` will happily serve a stale copy.
- **Deployment** is two targets from one repo: the public report stays on GitHub Pages,
  unauthenticated; the same repo plus `/api/*` and `/shortlist` also deploys to the
  `camper-report` **Worker** behind Cloudflare Access, restricted to two email addresses.
  See `docs/cloudflare-setup.md` for the one-time dashboard setup — not duplicated here.

## House rules

- `vehicles.json` is authoritative; the HTML data block is derived. Edit the JSON, sync the HTML.
- Keep `index.html` and `camper-vehicle-comparison.html` identical.
- Bump the top-level `updated` and each record's `last_verified` when you change data.
- Every factual field should be defensible from a URL in that record's `sources`.
- Verify locally by running `python3 scripts/sync_vehicles.py --check` (also enforces
  that `index.html` and `camper-vehicle-comparison.html` are byte-for-byte identical,
  and runs `--check-shared`) and opening `index.html` in a browser (it is fully static
  — no server needed).
- Run `npm test` before committing any change under `functions/`, `shortlist/`, or
  `scripts/` — it runs the whole `node --test` suite (auth, prefs, parse, scoring, pins).
- Pinned vehicles (`localStorage` key `camper-report:pins`, defaults in the `/*PURE-START*/`
  block) are always rendered regardless of filters; sorting is unaffected. The pure helpers
  in that block are unit-tested by `node --test scripts/pins.test.mjs` — keep them free of
  DOM access.
