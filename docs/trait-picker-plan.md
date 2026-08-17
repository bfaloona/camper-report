# Trait picker: implementation plan

**Review marker: reviewed and approved by Brandon on 2026-08-17.**
Decisions Q1–Q5 and review additions R1–R2 are recorded in
`docs/trait-picker-classification.md` (trait vocabulary, formulas, flags
F1–F6) and folded into the steps below. Pushbacks F1–F3 were accepted.
Implementation may proceed.

A merged, normalized picker on the Shortlist page: every trait settable to
YES (must-have) / IGNORE (nothing) / NO (deal-breaker), re-ranking live.
Selections compile to existing-schema criteria at rank time and are never
stored as criteria; the stored form is a small `traits` map in the shared
prefs blob.

## Status checklist

- [x] Step 1 — derived fields in scoring.js + parse.js (code) — also added the four
      researched fields to `FIELDS`/`ENUM_FIELDS`, which this plan under-specified:
      the picker's Group C rows compile rules against them, so the scorer must
      resolve them.
- [x] Step 2 — trait vocabulary module + compiler (code) — 27 rows (the AC-power
      trait split into any-wattage and high-watt rows; classification doc updated).
- [x] Step 3 — persist `traits` in the prefs blob (code)
- [x] Step 4 — picker UI in shortlist/index.html (code)
- [x] Step 5 — editorial supporting text under traits (code, required per R1)
- [x] Step 6 — researched-field data pass on vehicles.json (data) — 25/25 records;
      two honest nulls of interest: Pacifica gas spare (sources conflict) is the
      only null value; Metris clearance noted lower-confidence (3.8 vs 5.2–5.4
      published for other variants; same `low` class either way).
- [x] Step 7 — data-shape guard + add-vehicle skill update (code + docs)
- [x] Step 8 — verification sweep — `npm test` 148 pass, sync `--check` clean,
      browser-verified on `npm run dev` (YES/NO gating, null-never-excludes,
      persistence reload, shared-blob save, evidence disclosures; screenshots in
      `dist/verify-*.png`, git-ignored).

Deviation from the ship-order note below: the Group C picker rows were NOT
hidden pre-data — Step 6 landed in the same working tree as Steps 1–5, so the
no-data window never ships. The `requires_data` flag was therefore not built.

Steps 1→2→3→4→5 are sequential. Step 6 is independent of 2–5 and can run in
parallel (decisions Q2/Q3/Q4 are resolved). Ship order note: the Group C picker rows (spare tire, AC power, still
in production, clearance) should not be enabled in the UI until Step 6 lands,
or every vehicle shows a "?" unknown badge on them; Group A+B rows have data
today.

Commit style: conventional commits, small commits per step, directly on `main`.
`npm test` before every commit touching `functions/`, `shortlist/`, or
`scripts/`; `python3 scripts/sync_vehicles.py --check` before every commit
touching `vehicles.json` or `index.html`.

---

## Step 1 — derived fields (code)

Add the seven new derived enum fields from classification Group B to `FIELDS` in
`shortlist/scoring.js`, as pure null-safe getters with the formula in a
comment (Approach A: the formula is the documentation a reader argues with):

- `overnight_climate` ← `powertrain` (phev/ev → `engine-off`, hybrid →
  `engine-cycling`, gas → `idle-only`)
- `sliding_doors` ← `class` (Minivan / Compact minivan / Compact van → `yes`)
- `stealth_profile` ← `class` (those three + Hatchback → `high`, SUV/Wagon → `medium`)
- `camper_popularity_tier` ← `camper_popularity.rating` verbatim (High/Medium/Low)
- `sleeps_six_feet` ← `cargo_length_behind_front_seats_in.value` (≥75 `yes`,
  70–74.9 `tight`, <70 `no`, null → null)
- `tow_class` ← `tow_rating.max` (0 `none`, <2000 `light`, <3500 `moderate`,
  else `substantial`; null → null)
- `clearance_class` ← `ground_clearance_in.value` (≥8.5 `high`, 7.0–8.4
  `moderate`, <7.0 `low`, null → null). Reads the Step 6 researched field;
  returns null for every vehicle until that data lands, which gates as
  `unknown` and excludes nothing — safe to ship first.

Mirror all seven into `ENUM_FIELDS` in `functions/api/parse.js` with the same
value sets (`FIELD_IDS` is derived from it; the existing
`scoring.test.mjs` "`FIELD_IDS ⊆ FIELDS`" test enforces the sync). Extend the
`SYSTEM` prompt in `parse.js` with a short paragraph naming the new fields and
their values, so the prose parser can actually emit them — a field the prompt
never mentions is inert, not broken. Careful: the prompt says the equipment
list is "EXACTLY these ten"; scope that claim so it stays true.

Tests (extend `shortlist/scoring.test.mjs`): each formula against fixture
vehicles covering every enum value and the null branches; `tow_class` boundary
values (0, 1999, 2000, 3499, 3500); `clearance_class` with the field absent
entirely (pre-Step-6 records).

Thresholds are per Q4 in the classification doc — confirm before this step.

## Step 2 — trait vocabulary module + compiler (code)

New file `shortlist/traits.js` (pure, no DOM — same testability contract as
`scoring.js`):

- `TRAITS`: the picker rows from classification Groups A–C. Each entry:
  `{ id, label, group, field, yes_values, blurb }` where `blurb` is the
  one-line formula/basis text shown in the UI. Group C entries carry
  `requires_data: true` so the UI can hide them until Step 6 (see ship-order
  note).
- `compileTraits(traitsMap)` → array of criteria in the existing schema, no
  new kinds or tiers:
  - `'yes'` → `{ id: 'trait_<id>', label, tier: 'must-have', kind: 'hard',
    rule: { field, op: 'in', value: yes_values }, weight: 1, rank: 0,
    weight_locked: true, source_text: 'trait picker' }`
  - `'no'` → same with `tier: 'deal-breaker'`
  - anything else → nothing.
  Gates ignore weight/rank, so the placeholder values are inert; the stable
  `trait_<id>` ids and human labels are what the violation/unknown badges
  display.
- `sanitizeTraits(raw)` → `{}` unless a plain object; drops keys not in
  `TRAITS` and values other than `'yes'`/`'no'`. This is the untrusted-on-read
  guard for the stored blob.

Tests (new `shortlist/traits.test.mjs`):
- compile shapes for yes/no/ignore; stable ids; deal-breaker tier on NO.
- sanitize: null, arrays, unknown ids, garbage values, prototype-less input.
- vocabulary sync: every `TRAITS[i].field` exists in `FIELDS` with
  `type === 'enum'`, and every `yes_values` entry ∈ `ENUM_FIELDS[field]` from
  `parse.js` — the trait-picker analogue of the `FIELD_IDS ⊆ FIELDS` test,
  closing the same silent-never-scores hole.
- an end-to-end check: `rankVehicles(vehicles, compileTraits({awd:'yes'}), …)`
  excludes a FWD fixture and leaves a null-field fixture unexcluded.

Add `shortlist/traits.js` to the `ASSETS` allowlist in
`scripts/build-assets.mjs` — a file not named there is never published, and the
404 only appears in production.

## Step 3 — persist `traits` in the prefs blob (code)

`functions/api/prefs.js` currently picks exactly `{pins, criteria, notes}` on
PUT, so a `traits` key would be silently dropped:

- `EMPTY` gains `traits: {}`.
- PUT: accept `body.prefs.traits` when it's a plain non-array object, else
  `{}` (coerce like `notes`, don't 400 — older clients won't send it). Include
  it in the persisted `next` and in the size measurement.
- `usable()` unchanged: `traits` stays optional so every pre-existing blob
  remains readable. Readers default a missing/garbage value via
  `sanitizeTraits` — that is the whole migration; no stored criteria are
  touched because compiled trait criteria are never stored.
- GET needs no change (serves the stored blob).

`shortlist/prefs.js` needs no change (`savePrefs` sends the whole prefs
object).

Tests (extend `functions/api/prefs.test.mjs`): PUT round-trips `traits`; PUT
without `traits` stores `{}`; PUT with `traits: []` / `"x"` coerces to `{}`;
stored blob lacking `traits` still GETs as usable (no corruption warning).

## Step 4 — picker UI in shortlist/index.html (code)

All of this lives in the page's own markup/CSS/module script, **outside** the
synced `/*STYLE-*/` and `/*RENDER-*/` blocks — those are copies owned by
`index.html` and `--shared` would overwrite anything added inside them.

- New collapsible "Traits" panel alongside Criteria/Notes (reuse the existing
  `panel-toggle` pattern and its count label: "(3 set)").
- One row per `TRAITS` entry, grouped by `group`; each row: label, `blurb`
  as secondary text, and a three-state segmented control YES / — / NO
  (radio-group semantics, `aria-pressed`/`role="radiogroup"`; IGNORE is the
  default middle state). Rows whose `TRAITS` entry declares NO meaningless
  (A2, B2, B7) render without a NO button.
- Per R2: the 13 Group A equipment rows live behind their own collapsed
  "Equipment" subsection; Group B and C rows stay expanded by default.
- Wiring in the module script:
  - `boot()`: `prefs.traits = sanitizeTraits(prefs.traits)`.
  - On toggle: mutate `prefs.traits` (delete key on IGNORE so the stored map
    only holds active picks), `scheduleSave()`, `render()`.
  - `renderResults()`: build `effective = prefs.criteria.concat(
    compileTraits(prefs.traits))` once and use it for **both**
    `rankVehicles(...)` and the enforcement messaging — the "N enforced
    must-haves" count, and the gate counts, currently read `prefs.criteria`
    only, so trait gates would otherwise filter invisibly. Compiled trait
    criteria are never inert, never appear in the criteria editor, and are
    not saved: `traits` is the stored truth, criteria are its compilation.
  - Violation/unknown badges need no change — they render from
    `rankVehicles` output, which now includes trait labels.
- No new page globals; the `state` object is not touched (the shims warning in
  CLAUDE.md doesn't bite here because the panel is module-local).

Verification: `npm test`, then `npm run dev` (rebuilds into `dist/client/` —
editing the HTML does nothing without it) and a browser pass with a screenshot
artifact: pick YES on "AWD or 4WD" → FWD vehicles drop into ruled-out with the
trait named in the ✕ badge; NO on the same trait inverts it; a Group C trait
pre-data shows "?" on all vehicles (then hide those rows per the ship-order
note); reload → selections persisted; second browser session sees them
(shared blob).

## Step 5 — editorial supporting text under traits (code, REQUIRED per R1)

The brief's bucket table shows editorial bullets "as supporting text under a
related trait", and Brandon's review made this first-class: without it the
picker reads as a spec filter, not the merged pros-and-cons list asked for.
Shape:

- Generate a static `shortlist/trait-evidence.js` from Deliverable 1's rows:
  `{ trait_id: [ { vehicle_id, text, polarity } ] }`, covering the E and
  residue-bearing bullets that name a trait. Generated once by a small script
  (checked in under `scripts/`), regenerated only when bullets change.
- UI: each trait row gets a disclosure ("evidence") expanding to the related
  bullets grouped by vehicle.
- Add the new file to the `build-assets.mjs` allowlist.

Sequenced after Step 4; ships in v1.

## Step 6 — researched-field data pass (DATA)

Decisions Q2 (AC-power basis: available-on-generation), Q3 (DC fast charging
in, premium fuel out), Q4 (thresholds as proposed), Q5 (trim pass-through) are
resolved. Null where honestly unanswerable — the sitting-height precedent is
the standard; never invent a source.

For each of the 25 records in `vehicles.json`, add (per classification
Group C):

- `ground_clearance_in: { value, source }` — manufacturer spec for the listed trim
- `spare_tire: { value: 'full-size'|'compact'|'none', source }`
- `onboard_ac_power: { value: 'none'|'low_watt'|'high_watt', basis, source }`
  — `basis` records the Q2 divergence: available on this generation from the
  factory, any trim or option (not the equipment block's listed-trim rule)
- `still_in_production: { value: true|false, source }`
- `dc_fast_charging: { value: true|false, note?, source }` — gas/hybrid records
  are an honest `false` (no charge port) with a note instead of a source

`null` value when honestly unanswerable, per the sitting-height precedent.
Every source URL also lands in that record's `sources`. Bump each touched
record's `last_verified` and the top-level `updated`.

Then the sync procedure (data changes to existing records need `--rebuild`,
not the append-only default):

```
python3 scripts/sync_vehicles.py --rebuild
python3 scripts/sync_vehicles.py --check
```

**No `sync_vehicles.py` code change** under the recommended Q5 answer:
`trim_vehicle` passes unknown keys through, so the new fields reach the
embedded DATA blocks automatically (the `equipment` block already ships this
way, sources and all). If Brandon instead wants them stripped, this step grows:
strip rules in `trim_vehicle`, plus updates to the script docstring and
CLAUDE.md's embedded-differences list.

The Shortlist needs nothing: it fetches `/vehicles.json` whole.

Finally, enable the Group C picker rows hidden in Step 4.

## Step 7 — data-shape guard + add-vehicle skill (code + docs)

- Test (extend `shortlist/scoring.test.mjs` or a small `scripts/` data test
  run by `npm test`): every vehicle record carries the Step 6 keys with a
  valid value or null — so vehicle 26 can't silently ship without them, the
  exact failure mode the picker would hide behind "unknown".
- Update `.claude/skills/add-vehicle/SKILL.md`'s field checklist with the new
  fields and their conventions (including the Q2 basis note), or future
  records will be researched without them.
- One-line addition to CLAUDE.md's schema section naming the new fields.

## Step 8 — verification sweep

- `npm test` (full suite: auth, prefs, parse, scoring, traits, pins).
- `python3 scripts/sync_vehicles.py --check` (embedded data, byte-identical
  HTML pair, shared blocks).
- `npm run dev` browser pass per Step 4's script, including one full
  save/reload/second-session cycle.
- Review pass: done via an advisor (stronger-model) review over the full
  session, per CLAUDE.md's allowed substitutes — `/simplify` itself was NOT
  run and is deferred to Brandon (running it against the uncommitted tree
  would blur the eventual per-step commits; suggest running it post-commit).

---

## What deliberately does not change

- No new criterion kinds, tiers, or operators; no `manual` resurrection.
- `evaluateGate` / `rankVehicles` / null-never-excludes: untouched.
- EV MPGe handling in `mpg_city`/`mpg_hwy`: untouched.
- Score normalization over survivors: untouched (trait gates change who
  survives, which is the intended lever).
- The report pages' rendering: untouched (they gain inert embedded fields
  only, per Q5).
- `camper_pros`/`camper_cons` text: untouched — bullets remain evidence.
