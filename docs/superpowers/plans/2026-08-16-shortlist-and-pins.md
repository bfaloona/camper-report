# Shortlist Tool + Pinned Vehicles — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a preference-driven "Shortlist" decision tool (Google sign-in for two people, shared editable criteria, vehicles ranked by those criteria) and add vehicle pinning to the existing report.

**Architecture:** The public report (`index.html`, `camper-vehicle-comparison.html`) stays exactly what it is today: static, dependency-free, openable over `file://`, served from GitHub Pages. The Shortlist tool ships as a **separate page** deployed on **Cloudflare Pages** from the same repo, gated by **Cloudflare Access** (Google IdP, two-email allowlist). Shared preferences live in **Workers KV**, reached through two **Pages Functions**; a third function proxies prose→criteria parsing to the Claude API so no API key ever reaches the browser. Vehicle data is not duplicated — the Shortlist page fetches `/vehicles.json` at runtime. The report's card/table markup and CSS are copied into the Shortlist page by an extension of the existing `sync_vehicles.py` machinery, so `index.html` stays the single source of truth for presentation.

**Tech Stack:** Vanilla JS (ES modules on the Shortlist page only), Cloudflare Pages + Pages Functions + Workers KV + Cloudflare Access, `@anthropic-ai/sdk` (Functions bundle only), Python 3 for the sync/check scripts, `node --test` for unit tests.

**Spec:** This plan is its own spec — it was written from the request captured in `## Source request` below, plus the decisions recorded in `## Decisions already made`.

---

## Source request

- New tool: decision support (named **Shortlist** here)
  - Google auth, only `bfaloona@gmail.com` and `kristenwalshseattle@gmail.com`; both see the same settings, data, config
  - Preferences: must-have / nice-to-have / dislike / deal-breaker
    - Free prose input normalized to hard criteria, or fuzzy guidance where a hard rule isn't possible (`length < 195 in` = hard; "maximum basic safety features" = fuzzy)
    - Editable and rankable
  - Reuse the card/table view, sorted by preferences
- Existing card/table view: pin a vehicle so it is always included regardless of filter; sort is always honored
  - Two pinned by default: 2012 Mazda 5, 2022 Chevy Bolt EV (Bolt must be added to the dataset)

## Decisions already made

| ID | Decision | Rationale |
| --- | --- | --- |
| D1 | Cloudflare Pages + Access + Workers KV | Access does Google sign-in and the email allowlist with zero auth code; KV holds one shared JSON blob. No client SDK in the report. |
| D2 | Report stays public and unauthenticated; only the tool is gated | Preserves the static/`file://`/GitHub-Pages report and the two-files-identical rule. |
| D3 | Prose parsing goes through an LLM behind the backend proxy | Better parsing of messy prose than a regex parser. Never embed an API key in a public page. |
| D4 | Names: page = "Shortlist"; tiers = must-have / nice-to-have / dislike / deal-breaker | Plain English; unambiguous about which tiers exclude. |
| D5 | "2012 Mazda 5" maps to the existing `mazda5-gen3` record (`listed_year` 2015, generation 2012–2015) | No separate 2012 record exists and the generation is the unit of the dataset. |
| D9 | The Bolt record's id is `chevrolet-bolt-ev-gen1` (corrected during execution from `gen2`) | The 2017–2023 Bolt EV is the first generation; 2022 is a mid-cycle refresh and the second generation is the 2027 car. `gen2` contradicted the repo's own `make-model-generation` id convention. |
| D10 | Compare mode shows **checked ∪ pinned**, and ignores the class/power/drive filters | Brandon, during Phase 1. Supersedes the original "compare mode outranks pins" rule. A filter silently removing a vehicle you explicitly ticked is the surprising outcome. |
| D11 | Pinned rows and cards get their own background (`--pin-wash`, defined in both color schemes) plus a `--pop-med` left edge | Brandon, during Phase 1. A badge alone wasn't distinctive enough to scan. |
| D12 | The Powertrain filter carries a synthetic `Electrified` option matching `ev`/`phev`/`hybrid` | Brandon, during Phase 1. The per-powertrain options are generated from the data; this one is hand-added and its matching logic lives in the pure, unit-tested block. |
| D6 | Report-page pins are local (defaults + `localStorage`); Shortlist pins are shared via KV | The public report has no authenticated backend to read from. Two stores, deliberately. |
| D7 | Missing data never silently excludes a vehicle from a hard gate | A `null` field marks the vehicle `unknown` for that criterion and surfaces a badge, rather than dropping it. |
| D8 | The Shortlist page fetches `/vehicles.json`; it does not embed a copy | One dataset, no third sync target. |

## Global constraints

- `vehicles.json` is authoritative. The embedded HTML `DATA` block is derived — never hand-edit it.
- `index.html` and `camper-vehicle-comparison.html` must stay **byte-for-byte identical**. Every JS/CSS/markup change to one must be mirrored to the other.
- Measurements in inches, money in USD. Bump the top-level `updated` and each touched record's `last_verified` when data changes.
- Every factual field must be defensible from a URL in that record's `sources`.
- Verification for any data change: `python3 scripts/sync_vehicles.py --check` exits 0, and `index.html` opens correctly from the filesystem with no server.
- The report must keep working with `file://` — no ES modules, no `fetch()`, no external scripts in `index.html`.
- The Claude API model is `claude-opus-5`. Never put an API key in client-side code.
- Node scripts and tests are ESM (`.mjs`); no test framework beyond `node --test`.

## Prerequisite (do this before Phase 2)

**Resolved (Q1): there is no Cloudflare domain, so Access gates the project's `*.pages.dev` hostname.** That is the configuration Task 6 assumes.

Standing caveat: if a custom domain is attached to the Pages project later, it needs **its own Access application**. Without one, the tool becomes reachable through the custom domain with no authentication at all, while the `pages.dev` hostname still looks correctly gated. Re-read Task 6 Step 4 before adding any domain.

---

## File structure

| File | New? | Responsibility |
| --- | --- | --- |
| `vehicles.json` | modify | Add the `chevrolet-bolt-ev-gen1` record. |
| `index.html` | modify | Pin state, pin toggles, pin-aware `visibleRows()`, pin badge CSS, sync markers around style/render blocks. |
| `camper-vehicle-comparison.html` | modify | Byte-identical mirror of `index.html`. |
| `CLAUDE.md` | modify | Document the `ev` powertrain, the pin feature, the new scripts, and the Shortlist tool. |
| `scripts/sync_vehicles.py` | modify | Add `--shared` / `--check-shared` to copy the marked style + render blocks from `index.html` into `shortlist/index.html`. |
| `scripts/pins.test.mjs` | new | Extracts the pure-helper block from `index.html` and unit-tests it. |
| `shortlist/index.html` | new | The tool page: prose input, criteria editor, ranked card/table view. |
| `shortlist/scoring.js` | new | Pure module: field vocabulary, hard-gate evaluation, weighted scoring, explanations. |
| `shortlist/scoring.test.mjs` | new | `node --test` suite for `scoring.js`. |
| `shortlist/prefs.js` | new | Client wrapper over `/api/prefs` (load, save, optimistic-concurrency retry). |
| `functions/_lib/auth.js` | new | Extracts and validates the Access-authenticated email; enforces the allowlist. |
| `functions/_lib/auth.test.mjs` | new | `node --test` suite for the auth guard. |
| `functions/api/prefs.js` | new | `GET`/`PUT` the shared preferences blob in KV. |
| `functions/api/parse.js` | new | `POST` prose → structured criteria via the Claude API. |
| `functions/api/parse.test.mjs` | new | `node --test` suite for the criteria schema validator. |
| `package.json` | new | Declares `@anthropic-ai/sdk` for the Functions bundle. Does not affect the static report. |
| `.gitignore` | new | `node_modules/`, `.wrangler/`. |

---

## Data model

### Shared preferences blob (KV key `prefs:v1`)

```json
{
  "version": 1,
  "updated_at": "2026-08-16T18:04:00Z",
  "updated_by": "bfaloona@gmail.com",
  "pins": ["mazda5-gen3", "chevrolet-bolt-ev-gen1"],
  "criteria": [
    {
      "id": "c_1755367440000_a1b2",
      "label": "Under 195 inches long",
      "tier": "deal-breaker",
      "rank": 1,
      "weight": 5,
      "weight_locked": false,
      "kind": "hard",
      "rule": { "field": "length_in", "op": "<", "value": 195 },
      "source_text": "must be shorter than 195 inches"
    },
    {
      "id": "c_1755367440001_c3d4",
      "label": "As many standard safety features as possible",
      "tier": "must-have",
      "rank": 2,
      "weight": 4,
      "weight_locked": false,
      "kind": "fuzzy",
      "rule": { "field": "safety_feature_count", "direction": "higher" },
      "source_text": "maximum basic safety features"
    },
    {
      "id": "c_1755367440002_e5f6",
      "label": "Prefer something that doesn't look like a work van",
      "tier": "dislike",
      "rank": 5,
      "weight": 2,
      "weight_locked": true,
      "kind": "manual",
      "rule": null,
      "source_text": "nothing that screams contractor van"
    }
  ]
}
```

### Tier semantics

| Tier | `kind: "hard"` | `kind: "fuzzy"` | `kind: "manual"` |
| --- | --- | --- | --- |
| `deal-breaker` | Excludes on violation | Scores at weight × −1 | No effect on score; shown as a reminder |
| `must-have` | Excludes on violation | Scores at weight | No effect on score; shown as a reminder |
| `nice-to-have` | Scores full weight when satisfied, 0 when not | Scores at weight | No effect on score |
| `dislike` | Scores −weight when satisfied, 0 when not | Scores at weight × −1 | No effect on score |

`kind: "manual"` means the parser could not express the criterion against the field vocabulary. It is kept, shown, and rankable, but it contributes nothing automatic — the user reads it and judges.

### Field vocabulary

The parser may only emit these field ids. Anything else is rejected by the validator and becomes `kind: "manual"`.

| Field id | Type | Source in `vehicles.json` |
| --- | --- | --- |
| `length_in` | number | `exterior_in.length` |
| `width_in` | number | `exterior_in.width` |
| `height_in` | number | `exterior_in.height` |
| `cargo_length_in` | number | `cargo_length_behind_front_seats_in.value` |
| `max_cargo_cf` | number | `max_cargo_cf.value` (null when absent) |
| `mpg_city` | number | `mpg.city` — **null when `powertrain === 'ev'`** (see below) |
| `mpg_hwy` | number | `mpg.hwy` — **null when `powertrain === 'ev'`** (see below) |
| `mpge_combined` | number | `mpg.mpge` (null when absent — gas and most hybrids) |
| `ev_range_mi` | number | `mpg.ev_range_mi` (null when absent) |
| `price_low` | number | `kbb_value_usd.low` |
| `price_high` | number | `kbb_value_usd.high` |
| `tow_max` | number | `tow_rating.max` |
| `reliability_score` | number | `reliability.score` |
| `safety_feature_count` | number | `safety.features.length` |
| `conversion_kit_count` | number | `conversion_products.length` |
| `camper_popularity` | ordinal | `camper_popularity.rating` → Low 1 / Medium 2 / High 3 |
| `listed_year` | number | `listed_year` |
| `vehicle_class` | enum | `class` |
| `powertrain` | enum | `powertrain` |
| `drivetrain_bucket` | enum | `AWD`/`4WD` → `awd`; `FWD`/`RWD` → `2wd` |

Operators: `<`, `<=`, `>`, `>=`, `==`, `!=`, `between` (numeric/ordinal); `in`, `not_in` (enum). Fuzzy rules take `{ field, direction: "higher" | "lower" }`.

> ### EV fuel economy must not be compared against MPG
>
> For a battery-electric record, `mpg.city` / `mpg.hwy` hold EPA **MPGe**, not MPG — the Bolt's are 131 and 109. A scorer that reads those fields numerically ranks it first on efficiency against every gas vehicle in the set, which is nonsense: MPGe measures energy equivalence, not fuel burned. This surfaced in Phase 1's final review and is the single highest-value thing carried forward from it.
>
> So `FIELDS.mpg_city` and `FIELDS.mpg_hwy` return `null` for `powertrain === 'ev'`. Under D7 that makes an EV **unknown** on any MPG criterion rather than falsely excellent — it stays visible with a "no data" badge and a human judges it. EV efficiency gets compared through `mpge_combined` or `ev_range_mi`, which only EVs and PHEVs carry.
>
> Task 8's test suite must cover this directly: an EV scored against a `mpg_city` fuzzy criterion lands in `unknowns`, not at the top of the ranking.

---

# Phase 1 — Pins and the Bolt EV (no backend)

Ships on its own. Nothing here depends on Cloudflare.

### Task 1: Add the 2022 Chevrolet Bolt EV

**Files:**
- Modify: `vehicles.json`
- Modify: `index.html` (DATA block, via script)
- Modify: `camper-vehicle-comparison.html` (DATA block, via script)
- Modify: `CLAUDE.md`

**Interfaces:**
- Produces: a record with `"id": "chevrolet-bolt-ev-gen1"` and `"powertrain": "ev"` — Task 2 pins it by that exact id.

- [ ] **Step 1: Run the add-vehicle skill for the Bolt**

Invoke the `add-vehicle` skill (`.claude/skills/add-vehicle/SKILL.md`) with: *2022 Chevrolet Bolt EV, second generation.* Follow its research checklist. Do **not** copy figures from this plan — every number must come from a URL you put in the record's `sources`.

Two deviations from the usual conventions, both intentional:

1. `listed_year` is **2022**, not the convention's `min(latest model year, 2024)`. The request named the 2022 model year explicitly. Note this in `trim_rationale`.
2. `powertrain` is `"ev"` — a new value. See Step 2.

Fields needing care for a battery-electric record:
- `mpg.city` / `mpg.hwy`: the EPA **MPGe** city/highway figures, with `mpg.note` stating that these are MPGe, not MPG.
- `mpg.mpge`: the EPA combined MPGe figure. `mpg.ev_range_mi`: EPA combined range.
- `tow_rating`: `{ "max": 0, "tongue": null, "note": "...", "source": "..." }` — the Bolt EV is not rated for towing in the US. Cite the owner's manual or GM's published guidance.
- `drivetrain`: `"FWD"`.
- `camper_popularity`: rate honestly from real evidence. A short-range FWD hatchback is a marginal camper platform; if the evidence says `Low`, record `Low`.

- [ ] **Step 2: Add `ev` to the powertrain enum in `CLAUDE.md`**

`index.html` already has an `ev` label (`PT_LABEL` at `index.html:2824`), so the render side needs no change. Only the schema doc is out of date.

In `CLAUDE.md`, change:

```
- `powertrain`: one of `gas`, `hybrid`, `phev`. (PHEV records add `mpge` + `ev_range_mi` to `mpg`.)
```

to:

```
- `powertrain`: one of `gas`, `hybrid`, `phev`, `ev`. PHEV and EV records add `mpge` +
  `ev_range_mi` to `mpg`. For `ev` records, `mpg.city`/`mpg.hwy` hold the EPA **MPGe**
  city/highway figures and `mpg.note` must say so.
```

- [ ] **Step 3: Sync the data into both HTML files**

```bash
python3 scripts/sync_vehicles.py
```

Append-only mode is correct here — one new vehicle, no edits to existing records.

- [ ] **Step 4: Verify the sync and the page**

```bash
python3 scripts/sync_vehicles.py --check
```

Expected: exit code 0, no output indicating drift.

```bash
diff index.html camper-vehicle-comparison.html
```

Expected: no output (files identical).

Open `index.html` in a browser. Expected: the count note reads `25 of 25 vehicles`; the Bolt card shows an `EV` badge; the Power filter dropdown now offers `EV`; selecting it shows exactly the Bolt.

- [ ] **Step 5: Commit**

```bash
git add vehicles.json index.html camper-vehicle-comparison.html CLAUDE.md
git commit -m "feat: add 2022 Chevrolet Bolt EV and the ev powertrain value"
```

---

### Task 2: Pin vehicles in the report

**Files:**
- Modify: `index.html`
- Modify: `camper-vehicle-comparison.html`
- Create: `scripts/pins.test.mjs`
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: `chevrolet-bolt-ev-gen1` from Task 1.
- Produces: a marked pure-helper block in `index.html` delimited by `/*PURE-START*/` and `/*PURE-END*/`, exporting `DEFAULT_PINS`, `loadPins`, `savePins`, `togglePin`, `visibleRows`. Task 8 mirrors `visibleRows`' union semantics on the Shortlist page.

**Behavior contract:**
- Pinned vehicles are always visible: the rendered set is `(filter matches) ∪ (pinned)`.
- Sort is unchanged — pins take their natural sorted position; they do **not** float to the top.
- Pins persist in `localStorage` under `camper-report:pins`, seeded from `DEFAULT_PINS` on first visit.
- Compare mode still wins: when comparing, only checked vehicles show, pinned or not.
- The count note distinguishes the two groups: `18 of 25 vehicles · 2 pinned`.

- [ ] **Step 1: Write the failing test**

Create `scripts/pins.test.mjs`. It extracts the pure-helper block from `index.html` and runs it in a VM with a stubbed `localStorage`, so the helpers are tested without a DOM or a browser.

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, '..', 'index.html'), 'utf8');

const block = html.match(/\/\*PURE-START\*\/([\s\S]*?)\/\*PURE-END\*\//);
assert.ok(block, 'index.html must contain a /*PURE-START*/ ... /*PURE-END*/ block');

function load(stored) {
  const store = new Map(stored ? [['camper-report:pins', JSON.stringify(stored)]] : []);
  const sandbox = {
    localStorage: {
      getItem: k => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, v),
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(block[1] + '\n;({DEFAULT_PINS, loadPins, savePins, togglePin, visibleRows})', sandbox);
  return vm.runInContext('({DEFAULT_PINS, loadPins, savePins, togglePin, visibleRows})', sandbox);
}

const V = [
  { id: 'a', class: 'SUV' },
  { id: 'b', class: 'Minivan' },
  { id: 'c', class: 'SUV' },
];
const suvOnly = v => v.class === 'SUV';

test('default pins seed on first load', () => {
  const m = load(null);
  assert.deepEqual(m.loadPins(), new Set(m.DEFAULT_PINS));
});

test('default pins include the Mazda5 and the Bolt', () => {
  const m = load(null);
  assert.ok(m.DEFAULT_PINS.includes('mazda5-gen3'));
  assert.ok(m.DEFAULT_PINS.includes('chevrolet-bolt-ev-gen1'));
});

test('stored pins override the defaults, including an empty set', () => {
  assert.deepEqual(load([]).loadPins(), new Set());
  assert.deepEqual(load(['b']).loadPins(), new Set(['b']));
});

test('togglePin adds and removes', () => {
  const m = load([]);
  assert.deepEqual(m.togglePin('a'), new Set(['a']));
  assert.deepEqual(m.togglePin('a'), new Set());
});

test('visibleRows is the union of filter matches and pins', () => {
  const m = load(['b']);
  const rows = m.visibleRows(V, suvOnly, new Set(['b']), false, new Set());
  assert.deepEqual(rows.map(v => v.id), ['a', 'b', 'c']);
});

test('visibleRows does not duplicate a pinned vehicle that also matches', () => {
  const m = load(['a']);
  const rows = m.visibleRows(V, suvOnly, new Set(['a']), false, new Set());
  assert.deepEqual(rows.map(v => v.id), ['a', 'c']);
});

test('visibleRows preserves source order so the caller can sort', () => {
  const m = load(['b']);
  const rows = m.visibleRows(V, () => false, new Set(['b']), false, new Set());
  assert.deepEqual(rows.map(v => v.id), ['b']);
});

test('compare mode ignores pins entirely', () => {
  const m = load(['a']);
  const rows = m.visibleRows(V, suvOnly, new Set(['a']), true, new Set(['b']));
  assert.deepEqual(rows.map(v => v.id), ['b']);
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
node --test scripts/pins.test.mjs
```

Expected: FAIL — `index.html must contain a /*PURE-START*/ ... /*PURE-END*/ block`.

- [ ] **Step 3: Add the pure helpers to `index.html`**

Insert immediately after the `DATA` block (`index.html:2820`) and **before** `const fmt =`. Placement matters: Task 9 wraps everything from `const fmt =` onward in a `/*RENDER-*/` block that gets copied into the Shortlist page, and these `localStorage` helpers have no business being copied there. They depend on nothing below them.

```js
/*PURE-START*/
// Pinned vehicles are always rendered, whatever the filters say. Extracted as
// pure functions so scripts/pins.test.mjs can exercise them without a browser.
const PIN_KEY = 'camper-report:pins';
const DEFAULT_PINS = ['mazda5-gen3', 'chevrolet-bolt-ev-gen1'];

function loadPins() {
  try {
    const raw = localStorage.getItem(PIN_KEY);
    if (raw === null) return new Set(DEFAULT_PINS);
    const parsed = JSON.parse(raw);
    return new Set(Array.isArray(parsed) ? parsed : DEFAULT_PINS);
  } catch (e) {
    return new Set(DEFAULT_PINS);
  }
}

function savePins(pins) {
  try { localStorage.setItem(PIN_KEY, JSON.stringify([...pins])); } catch (e) { /* private mode */ }
  return pins;
}

function togglePin(id, pins) {
  const next = new Set(pins || loadPins());
  if (next.has(id)) next.delete(id); else next.add(id);
  return savePins(next);
}

// Union of (filter matches) and (pinned), in source order. Sorting is the
// caller's job, so pins land in their natural sorted position rather than
// floating to the top.
function visibleRows(all, matches, pins, compareMode, selected) {
  if (compareMode) return all.filter(v => selected.has(v.id));
  return all.filter(v => pins.has(v.id) || matches(v));
}
/*PURE-END*/
```

Note the test calls `togglePin(id)` with one argument; the default `pins || loadPins()` covers that.

- [ ] **Step 4: Run the test to verify it passes**

```bash
node --test scripts/pins.test.mjs
```

Expected: PASS, 8/8.

**Harness note:** the sandbox must be given the outer realm's `Set` constructor
(`vm.createContext({ localStorage: …, Set })`). A `Set` built inside a `node:vm` realm
fails `instanceof Set` outside it, so `assert.deepEqual` rejects it as not
reference-equal. Without the injection the suite fails against correct code.

- [ ] **Step 5: Wire pins into the render path**

Replace `state` and `filtered()` (`index.html:2872-2881`) with:

```js
let state = { fClass: '', fPower: '', fDrive: '', sortKey: 'vehicle', sortDir: 1, view: 'cards',
  selected: new Set(), compareMode: false, pins: loadPins() };

function matchesFilters(v) {
  return (!state.fClass || v.class === state.fClass)
    && (!state.fPower || v.powertrain === state.fPower)
    && (!state.fDrive || DT_BUCKET(v.drivetrain) === state.fDrive);
}
function filtered() {
  return visibleRows(DATA.vehicles, matchesFilters, state.pins, state.compareMode, state.selected);
}
```

In `render()` (`index.html:2980`), replace the count-note assignment with a version that names the pinned overage:

```js
  const rows = sorted(filtered());
  const pinnedShown = rows.filter(v => state.pins.has(v.id)).length;
  const pinNote = (!state.compareMode && pinnedShown) ? ' · ' + pinnedShown + ' pinned' : '';
  document.getElementById('count-note').textContent = state.compareMode
    ? 'Comparing ' + rows.length + ' vehicles'
    : rows.length + ' of ' + DATA.vehicles.length + ' vehicles' + pinNote;
```

- [ ] **Step 6: Add the pin control to cards and table rows**

In `renderCards()` (`index.html:2903`), add a pin button to the badges row, immediately after the opening `<div class="badges">`:

```js
        <button class="pin-btn${state.pins.has(v.id) ? ' pinned' : ''}" data-pin="${v.id}"
          title="${state.pins.has(v.id) ? 'Unpin — allow filters to hide this vehicle' : 'Pin — always show this vehicle'}"
          aria-pressed="${state.pins.has(v.id)}">${state.pins.has(v.id) ? '📌 Pinned' : 'Pin'}</button>
```

In `renderTable()` (`index.html:2957`), extend the select cell to carry the same control:

```js
      <td class="sel-cell"><input type="checkbox" data-sel="${v.id}" ${state.selected.has(v.id) ? 'checked' : ''} title="Select to compare"><button class="pin-btn sm${state.pins.has(v.id) ? ' pinned' : ''}" data-pin="${v.id}" title="${state.pins.has(v.id) ? 'Unpin' : 'Pin'}" aria-pressed="${state.pins.has(v.id)}">📌</button></td>
```

Add the click handler alongside the existing delegated handlers (near `index.html:3089`), before the row-click-to-detail handler so a pin click never opens the detail overlay:

```js
document.addEventListener('click', e => {
  const btn = e.target.closest('[data-pin]');
  if (!btn) return;
  e.stopPropagation();
  state.pins = togglePin(btn.dataset.pin, state.pins);
  render();
});
```

- [ ] **Step 7: Add the pin styles**

Add to the `<style>` block, immediately after the existing `.badge` rules. This is a badge-shaped control, not a new visual language: match the badge sizing (11px, `2px 8px`, `999px` radius) and use **only the theme's existing custom properties**. The page defines a full light/dark token set at `:root` and flips it under `@media (prefers-color-scheme: dark)` — any hardcoded hex here renders as a light-mode control on a dark page.

```css
  .pin-btn { font: inherit; font-size: 11px; line-height: 1; padding: 2px 8px; border-radius: 999px;
    border: 1px solid var(--border); background: var(--surface); color: var(--ink-2);
    font-weight: 500; cursor: pointer; }
  .pin-btn:hover { border-color: var(--ink-3); color: var(--ink-1); }
  .pin-btn.pinned { border-color: var(--pop-med); background: var(--wash); color: var(--pop-med);
    font-weight: 600; }
  .pin-btn.sm { padding: 2px 5px; margin-left: 4px; }
  .pin-btn:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
```

`--pop-med` is the amber the page already uses for the medium camper-popularity rating and is defined in both schemes, so the pinned state reads as "flagged" without inventing a color. Verify the result in both light and dark before committing.

- [ ] **Step 8: Mirror every change into the second HTML file**

The sync script only handles the `DATA` block, so this step is manual and is the easiest thing in the project to forget.

```bash
cp index.html camper-vehicle-comparison.html
diff index.html camper-vehicle-comparison.html
```

Expected: no output.

- [ ] **Step 9: Verify in the browser**

Open `index.html`. Check each of these:

1. The Mazda5 and Bolt cards show `📌 Pinned`; every other card shows `Pin`.
2. Set Class to a class neither pinned vehicle belongs to. Both pinned vehicles remain visible; the count note reads `N of 25 vehicles · 2 pinned`.
3. Sort by Length descending. The pinned vehicles sit at their correct length positions, not at the top.
4. Unpin the Bolt, reload the page. It stays unpinned.
5. Clear `localStorage` for the page and reload. Both defaults return.
6. Switch to the table view and pin a third vehicle from a row. The row does not open the detail overlay.
7. Enter compare mode with two vehicles selected. Only those two show, regardless of pins.

Capture a screenshot of step 2 (a filter active with both pins visible) as the artifact for this task.

- [ ] **Step 10: Document the feature**

In `CLAUDE.md`, add to the **House rules** section:

```
- Pinned vehicles (`localStorage` key `camper-report:pins`, defaults in the `/*PURE-START*/`
  block) are always rendered regardless of filters; sorting is unaffected. The pure helpers
  in that block are unit-tested by `node --test scripts/pins.test.mjs` — keep them free of
  DOM access.
```

- [ ] **Step 11: Commit**

```bash
git add index.html camper-vehicle-comparison.html scripts/pins.test.mjs CLAUDE.md
git commit -m "feat: pin vehicles so filters never hide them"
```

---

# Phase 2 — Cloudflare foundation

Auth, shared storage, and the parse proxy. No UI yet — every task here is verifiable with `curl`.

### Task 3: Repo scaffolding for Pages Functions

**Files:**
- Create: `package.json`
- Create: `.gitignore`

**Interfaces:**
- Produces: `@anthropic-ai/sdk` available to everything under `functions/`.

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "camper-report",
  "private": true,
  "type": "module",
  "description": "Dependencies for the Cloudflare Pages Functions only. The static report has none.",
  "dependencies": {
    "@anthropic-ai/sdk": "^0.70.0"
  },
  "scripts": {
    "test": "node --test \"**/*.test.mjs\""
  }
}
```

Pin whatever version `npm install @anthropic-ai/sdk` actually resolves — do not leave the caret range above unverified. (Resolved to `0.70.1` when this was executed.)

The `test` script uses Node's own glob (hence the quotes — the shell must not expand it), so new `*.test.mjs` files are picked up automatically as later tasks add them. Listing files explicitly makes `npm test` fail until every listed file exists; passing bare directories does not work in Node 22 — both were tried.

- [ ] **Step 2: Create `.gitignore`**

```
node_modules/
.wrangler/
.dev.vars
```

- [ ] **Step 3: Install and verify**

```bash
npm install
node -e "import('@anthropic-ai/sdk').then(m => console.log(typeof m.default))"
```

Expected: `function`.

- [ ] **Step 4: Confirm the static report is untouched**

```bash
python3 scripts/sync_vehicles.py --check
node --test scripts/pins.test.mjs
```

Expected: both pass. `index.html` still opens over `file://` with no network.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json .gitignore
git commit -m "chore: add Functions-only dependency on the Anthropic SDK"
```

---

### Task 4: The Access auth guard

**Files:**
- Create: `functions/_lib/auth.js`
- Create: `functions/_lib/auth.test.mjs`

**Interfaces:**
- Produces: `ALLOWED_EMAILS`, `tokenFromRequest(request)`, `verifiedEmail(request, env, deps)`, `requireUser(request, env, deps)`, `_resetJwksCache()` — consumed by `functions/api/prefs.js` and `functions/api/parse.js`.

**Why a guard, and why it verifies the signature:** Cloudflare Access is the gate. This module is the second lock, and it only counts as one if it verifies. Decoding the JWT payload without checking its signature — or trusting `Cf-Access-Authenticated-User-Email` — protects against nothing: any request that reaches the Function without passing Access can forge both, which is exactly the mis-scoped-policy case a second lock is for. That matters more here than on a typical read endpoint because `/api/parse` spends Anthropic credits; an unverified guard leaves an open LLM proxy behind a policy typo.

So: fetch the team's JWKS, verify RS256 over the signing input, check `aud` and `exp`, then apply the email allowlist. `Cf-Access-Authenticated-User-Email` is not used at all.

**Local development:** `wrangler pages dev` does not run Access, so it cannot mint a valid token. The guard honors `DEV_BYPASS_EMAIL` only when **all three** hold: the variable is set, `CF_ACCESS_AUD` is unset, **and the request hostname is a loopback address**.

The loopback condition is load-bearing and was added during execution. Cloudflare Pages sets environment variables per environment, so `CF_ACCESS_AUD is unset` alone is not a reliable signal for "this is a developer's laptop": a preview deployment with `DEV_BYPASS_EMAIL` left set, no `CF_ACCESS_AUD` configured for that environment, and a preview hostname not covered by an Access policy would grant full unauthenticated access. Two misconfigurations, both plausible, on an endpoint that spends API credits. A hostname check cannot be set from a dashboard, so it closes that path.

- [ ] **Step 1: Write the failing test**

Create `functions/_lib/auth.test.mjs`:

```js
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { ALLOWED_EMAILS, verifiedEmail, requireUser, _resetJwksCache } from './auth.js';

const enc = new TextEncoder();
const b64urlJson = obj => Buffer.from(JSON.stringify(obj)).toString('base64url');
const b64url = bytes => Buffer.from(bytes).toString('base64url');

const ENV = { CF_ACCESS_TEAM_DOMAIN: 'test.cloudflareaccess.com', CF_ACCESS_AUD: 'aud-tag' };
const req = headers => new Request('https://example.com/api/prefs', { headers });

let privateKey, jwk;

async function keys() {
  const pair = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true, ['sign', 'verify']);
  privateKey = pair.privateKey;
  jwk = { ...(await crypto.subtle.exportKey('jwk', pair.publicKey)), kid: 'test-kid' };
}

async function signed(payload, kid = 'test-kid') {
  const head = b64urlJson({ alg: 'RS256', kid, typ: 'JWT' });
  const body = b64urlJson(payload);
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', privateKey, enc.encode(`${head}.${body}`));
  return `${head}.${body}.${b64url(new Uint8Array(sig))}`;
}

const jwksDeps = () => ({ fetch: async () => ({ ok: true, json: async () => ({ keys: [jwk] }) }) });
const valid = (email = 'bfaloona@gmail.com') =>
  ({ email, aud: ['aud-tag'], exp: Math.floor(Date.now() / 1000) + 600 });

beforeEach(async () => { _resetJwksCache(); await keys(); });

test('the allowlist is exactly the two accounts', () => {
  assert.deepEqual([...ALLOWED_EMAILS].sort(), ['bfaloona@gmail.com', 'kristenwalshseattle@gmail.com']);
});

test('accepts a correctly signed token from the assertion header', async () => {
  const r = req({ 'cf-access-jwt-assertion': await signed(valid()) });
  assert.equal(await verifiedEmail(r, ENV, jwksDeps()), 'bfaloona@gmail.com');
});

test('accepts a correctly signed token from the CF_Authorization cookie', async () => {
  const r = req({ cookie: `CF_Authorization=${await signed(valid('kristenwalshseattle@gmail.com'))}` });
  assert.equal(await verifiedEmail(r, ENV, jwksDeps()), 'kristenwalshseattle@gmail.com');
});

test('normalizes case and whitespace on the email claim', async () => {
  const r = req({ 'cf-access-jwt-assertion': await signed(valid('  BFaloona@Gmail.com ')) });
  assert.equal(await verifiedEmail(r, ENV, jwksDeps()), 'bfaloona@gmail.com');
});

test('rejects a token whose payload was swapped after signing', async () => {
  const token = await signed(valid());
  const [head, , sig] = token.split('.');
  const forged = `${head}.${b64urlJson(valid('attacker@example.com'))}.${sig}`;
  assert.equal(await verifiedEmail(req({ 'cf-access-jwt-assertion': forged }), ENV, jwksDeps()), null);
});

test('rejects a token signed by a different key', async () => {
  const token = await signed(valid());
  await keys(); // the JWKS now serves a key that did not sign this token
  assert.equal(await verifiedEmail(req({ 'cf-access-jwt-assertion': token }), ENV, jwksDeps()), null);
});

test('rejects a token for a different audience', async () => {
  const r = req({ 'cf-access-jwt-assertion': await signed({ ...valid(), aud: ['other-app'] }) });
  assert.equal(await verifiedEmail(r, ENV, jwksDeps()), null);
});

test('rejects an expired token', async () => {
  const r = req({ 'cf-access-jwt-assertion': await signed({ ...valid(), exp: Math.floor(Date.now() / 1000) - 1 }) });
  assert.equal(await verifiedEmail(r, ENV, jwksDeps()), null);
});

test('rejects an alg:none token', async () => {
  const head = b64urlJson({ alg: 'none', kid: 'test-kid' });
  const r = req({ 'cf-access-jwt-assertion': `${head}.${b64urlJson(valid())}.` });
  assert.equal(await verifiedEmail(r, ENV, jwksDeps()), null);
});

test('returns null on a malformed token rather than throwing', async () => {
  assert.equal(await verifiedEmail(req({ 'cf-access-jwt-assertion': 'not.a.jwt' }), ENV, jwksDeps()), null);
  assert.equal(await verifiedEmail(req({ 'cf-access-jwt-assertion': 'garbage' }), ENV, jwksDeps()), null);
});

test('returns null when no token is present', async () => {
  assert.equal(await verifiedEmail(req({}), ENV, jwksDeps()), null);
});

test('returns null when the JWKS cannot be fetched', async () => {
  const r = req({ 'cf-access-jwt-assertion': await signed(valid()) });
  const failing = { fetch: async () => { throw new Error('network'); } };
  assert.equal(await verifiedEmail(r, ENV, failing), null);
});

test('caches the JWKS across calls', async () => {
  let calls = 0;
  const counting = { fetch: async () => { calls++; return { ok: true, json: async () => ({ keys: [jwk] }) }; } };
  const r = req({ 'cf-access-jwt-assertion': await signed(valid()) });
  await verifiedEmail(r, ENV, counting);
  await verifiedEmail(r, ENV, counting);
  assert.equal(calls, 1);
});

test('requireUser returns the email for an allowed account', async () => {
  const r = req({ 'cf-access-jwt-assertion': await signed(valid()) });
  assert.deepEqual(await requireUser(r, ENV, jwksDeps()), { email: 'bfaloona@gmail.com', response: null });
});

test('requireUser returns 403 for a verified but unlisted account', async () => {
  const r = req({ 'cf-access-jwt-assertion': await signed(valid('someone-else@gmail.com')) });
  const { email, response } = await requireUser(r, ENV, jwksDeps());
  assert.equal(email, null);
  assert.equal(response.status, 403);
});

test('requireUser returns 401 when no token is present', async () => {
  const { response } = await requireUser(req({}), ENV, jwksDeps());
  assert.equal(response.status, 401);
});

test('requireUser returns 500 when Access verification is unconfigured', async () => {
  const { response } = await requireUser(req({}), {}, jwksDeps());
  assert.equal(response.status, 500);
});

test('the dev bypass works only when CF_ACCESS_AUD is unset', async () => {
  const devEnv = { DEV_BYPASS_EMAIL: 'bfaloona@gmail.com' };
  assert.equal((await requireUser(req({}), devEnv, jwksDeps())).email, 'bfaloona@gmail.com');

  const prodEnv = { ...ENV, DEV_BYPASS_EMAIL: 'bfaloona@gmail.com' };
  const { email, response } = await requireUser(req({}), prodEnv, jwksDeps());
  assert.equal(email, null);
  assert.equal(response.status, 401);
});

test('the dev bypass honors an x-dev-email override so 403s can be exercised', async () => {
  const devEnv = { DEV_BYPASS_EMAIL: 'bfaloona@gmail.com' };
  const { response } = await requireUser(req({ 'x-dev-email': 'nobody@example.com' }), devEnv, jwksDeps());
  assert.equal(response.status, 403);
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
node --test functions/_lib/auth.test.mjs
```

Expected: FAIL — `Cannot find module .../functions/_lib/auth.js`.

- [ ] **Step 3: Write `functions/_lib/auth.js`**

```js
// Cloudflare Access is the gate. This is the second lock, and it only counts as
// one because it verifies the JWT signature: an unverified base64 decode — or
// trusting Cf-Access-Authenticated-User-Email — is forgeable by anything that
// reaches this Function without passing Access, which is the exact failure this
// is here to catch. /api/parse spends money, so that matters.
export const ALLOWED_EMAILS = new Set([
  'bfaloona@gmail.com',
  'kristenwalshseattle@gmail.com',
]);

const JWKS_TTL_MS = 60 * 60 * 1000;
let jwksCache = { url: null, keys: null, fetchedAt: 0 };

export function _resetJwksCache() {
  jwksCache = { url: null, keys: null, fetchedAt: 0 };
}

function b64urlToBytes(s) {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const b64urlToJson = s => JSON.parse(new TextDecoder().decode(b64urlToBytes(s)));

function cookie(request, name) {
  const header = request.headers.get('cookie');
  if (!header) return null;
  for (const pair of header.split(';')) {
    const idx = pair.indexOf('=');
    if (idx === -1) continue;
    if (pair.slice(0, idx).trim() === name) return pair.slice(idx + 1).trim();
  }
  return null;
}

export function tokenFromRequest(request) {
  return request.headers.get('cf-access-jwt-assertion')
    || cookie(request, 'CF_Authorization')
    || null;
}

async function jwks(teamDomain, fetchImpl) {
  const url = `https://${teamDomain}/cdn-cgi/access/certs`;
  if (jwksCache.keys && jwksCache.url === url && Date.now() - jwksCache.fetchedAt < JWKS_TTL_MS) {
    return jwksCache.keys;
  }
  const res = await fetchImpl(url);
  if (!res.ok) throw new Error(`JWKS fetch failed (${res.status})`);
  const body = await res.json();
  jwksCache = { url, keys: body.keys || [], fetchedAt: Date.now() };
  return jwksCache.keys;
}

export async function verifiedEmail(request, env, deps = {}) {
  const fetchImpl = deps.fetch || globalThis.fetch;
  const nowSeconds = deps.now ? deps.now() : Math.floor(Date.now() / 1000);

  const token = tokenFromRequest(request);
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  let header, payload;
  try {
    header = b64urlToJson(parts[0]);
    payload = b64urlToJson(parts[1]);
  } catch (e) {
    return null;
  }

  if (header.alg !== 'RS256') return null;
  const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!aud.includes(env.CF_ACCESS_AUD)) return null;
  if (typeof payload.exp !== 'number' || payload.exp <= nowSeconds) return null;
  if (typeof payload.email !== 'string') return null;

  let keys;
  try {
    keys = await jwks(env.CF_ACCESS_TEAM_DOMAIN, fetchImpl);
  } catch (e) {
    return null;
  }

  const data = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
  let signature;
  try {
    signature = b64urlToBytes(parts[2]);
  } catch (e) {
    return null;
  }

  const candidates = keys.filter(k => !header.kid || !k.kid || k.kid === header.kid);
  for (const k of candidates) {
    const { use, key_ops, ...jwkKey } = k;
    try {
      const key = await crypto.subtle.importKey(
        'jwk', { ...jwkKey, alg: 'RS256', ext: true },
        { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
      if (await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, signature, data)) {
        return payload.email.trim().toLowerCase();
      }
    } catch (e) {
      // Unusable key — try the next one.
    }
  }
  return null;
}

function deny(status, message) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

export async function requireUser(request, env, deps) {
  // Local only: wrangler pages dev can't mint an Access token. Gated on
  // CF_ACCESS_AUD being absent, which never happens in a deployed environment,
  // so this stays inert in production even if the variable is set there.
  if (env.DEV_BYPASS_EMAIL && !env.CF_ACCESS_AUD) {
    const email = (request.headers.get('x-dev-email') || env.DEV_BYPASS_EMAIL).trim().toLowerCase();
    if (!ALLOWED_EMAILS.has(email)) return { email: null, response: deny(403, 'Not authorized') };
    return { email, response: null };
  }

  if (!env.CF_ACCESS_TEAM_DOMAIN || !env.CF_ACCESS_AUD) {
    return { email: null, response: deny(500, 'Access verification is not configured') };
  }

  const email = await verifiedEmail(request, env, deps);
  if (!email) return { email: null, response: deny(401, 'Not authenticated') };
  if (!ALLOWED_EMAILS.has(email)) return { email: null, response: deny(403, 'Not authorized') };
  return { email, response: null };
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
node --test functions/_lib/auth.test.mjs
```

Expected: PASS, 19/19. The two that matter most are *rejects a token whose payload was swapped after signing* and *rejects a token signed by a different key* — those are the ones an unverified decode would fail.

- [ ] **Step 5: Commit**

```bash
git add functions/_lib/auth.js functions/_lib/auth.test.mjs
git commit -m "feat: verify the Cloudflare Access JWT and enforce the email allowlist"
```

---

### Task 5: The shared preferences endpoint

**Files:**
- Create: `functions/api/prefs.js`

**Interfaces:**
- Consumes: `requireUser` from `functions/_lib/auth.js`.
- Produces: `GET /api/prefs` → `{ prefs, etag }`; `PUT /api/prefs` with body `{ prefs, etag }` → `{ prefs, etag }` or `409`.

**Concurrency — read this before trusting the etag.** Two people editing one blob needs a guard, or one silently clobbers the other. `GET` returns an etag (a hash of the stored JSON); `PUT` echoes it back and is rejected with `409` if the stored value has moved on. The client re-reads and retries.

What that actually buys, stated honestly: Workers KV has **no compare-and-swap**, so `PUT` is read-compare-write with no atomicity between the read and the write.

- **Protects against sequential staleness** — the common case. Kristen saves; Brandon's tab still holds the old etag; his next save is rejected with `409` instead of wiping her changes.
- **Does not protect against overlapping writes.** If both `PUT`s read the store before either writes, both see the same etag, both pass the check, and the second write wins silently with no `409`.

For two people who mostly edit at different times this is an acceptable residual risk, and it is the reason to keep the blob small and the saves debounced. Durable Objects are the fix if it ever bites — they provide the atomicity KV lacks. Do not describe the etag as preventing concurrent overwrites; it narrows the window, it does not close it.

- [ ] **Step 1: Write `functions/api/prefs.js`**

```js
import { requireUser } from '../_lib/auth.js';

const KEY = 'prefs:v1';

const EMPTY = {
  version: 1,
  updated_at: null,
  updated_by: null,
  pins: ['mazda5-gen3', 'chevrolet-bolt-ev-gen1'],
  criteria: [],
};

async function etagOf(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].slice(0, 8).map(b => b.toString(16).padStart(2, '0')).join('');
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

export async function onRequestGet({ request, env }) {
  const { response } = await requireUser(request, env);
  if (response) return response;

  const stored = await env.PREFS.get(KEY);
  const text = stored ?? JSON.stringify(EMPTY);
  return json({ prefs: JSON.parse(text), etag: await etagOf(text) });
}

export async function onRequestPut({ request, env }) {
  const { email, response } = await requireUser(request, env);
  if (response) return response;

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json({ error: 'Body must be JSON' }, 400);
  }
  if (!body || typeof body.prefs !== 'object' || body.prefs === null) {
    return json({ error: 'Body must be { prefs, etag }' }, 400);
  }
  if (!Array.isArray(body.prefs.criteria) || !Array.isArray(body.prefs.pins)) {
    return json({ error: 'prefs.criteria and prefs.pins must be arrays' }, 400);
  }

  const stored = await env.PREFS.get(KEY);
  const currentEtag = await etagOf(stored ?? JSON.stringify(EMPTY));
  if (body.etag !== currentEtag) {
    return json({ error: 'Preferences changed since you loaded them', etag: currentEtag }, 409);
  }

  const next = {
    ...body.prefs,
    version: 1,
    updated_at: new Date().toISOString(),
    updated_by: email,
  };
  const text = JSON.stringify(next);
  await env.PREFS.put(KEY, text);
  return json({ prefs: next, etag: await etagOf(text) });
}
```

- [ ] **Step 2: Verify locally with Wrangler**

Create `.dev.vars` (already gitignored) — this is what activates the local bypass:

```
DEV_BYPASS_EMAIL=bfaloona@gmail.com
```

```bash
npx wrangler pages dev . --kv PREFS
```

In a second terminal:

```bash
curl -s http://localhost:8788/api/prefs
```

Expected: `{"prefs":{"version":1,...,"criteria":[]},"etag":"..."}`.

```bash
curl -si -H 'x-dev-email: nobody@example.com' http://localhost:8788/api/prefs | head -1
```

Expected: `HTTP/1.1 403 Forbidden`.

Now prove the bypass is inert once Access is configured. Add **both** `CF_ACCESS_AUD=anything` and `CF_ACCESS_TEAM_DOMAIN=example.cloudflareaccess.com` to `.dev.vars`, restart, and repeat the first curl. Expected: HTTP 401 — the bypass no longer applies and there is no valid token to fall back on. Remove both lines before continuing.

Setting `CF_ACCESS_AUD` alone gives HTTP 500 (`Access verification is not configured`) instead, because `requireUser` requires both variables before it will attempt verification. Either way the bypass is unreachable, which is the property being tested; 401 is just the cleaner demonstration.

- [ ] **Step 3: Verify the round trip and the conflict guard**

```bash
ETAG=$(curl -s http://localhost:8788/api/prefs \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["etag"])')

curl -s -X PUT -H 'content-type: application/json' \
  -d "{\"etag\":\"$ETAG\",\"prefs\":{\"version\":1,\"pins\":[\"mazda5-gen3\"],\"criteria\":[]}}" \
  http://localhost:8788/api/prefs
```

Expected: HTTP 200, the returned `prefs.updated_by` is `bfaloona@gmail.com` and `pins` is `["mazda5-gen3"]`.

Re-send the same command with the now-stale `$ETAG`. Expected: HTTP 409 and a fresh `etag` in the body.

**Known limitation to note in the code comment:** the etag check is read-compare-write with no compare-and-swap, so two overlapping `PUT`s that both read before either writes will both pass the check and the later write wins silently. Cross-region eventual consistency widens the window but is not the cause — the same race exists within one location. Acceptable for a two-person tool; Durable Objects are the fix if it ever bites. Word the comment so it names check-then-act as the cause, not just eventual consistency.

- [ ] **Step 4: Commit**

```bash
git add functions/api/prefs.js
git commit -m "feat: add the shared preferences endpoint backed by Workers KV"
```

---

### Task 6: Deploy and gate

**Files:** none — this is Cloudflare dashboard configuration. Record what you did in `CLAUDE.md` at Step 6.

- [ ] **Step 1: Create the KV namespace**

Cloudflare dashboard → **Storage & Databases → KV → Create instance**. Name it `camper-report-prefs`. Copy the namespace ID.

- [ ] **Step 2: Create the Pages project**

Dashboard → **Workers & Pages → Create → Pages → Connect to Git**, pointing at `bfaloona/camper-report`, production branch `main`. Build command: none. Build output directory: `/`. Pages will run `npm install` because a `package.json` exists, and bundle `functions/` automatically.

- [ ] **Step 3: Bind KV and the API key**

Project → **Settings → Bindings → Add → KV namespace**: variable name `PREFS`, namespace `camper-report-prefs`. Add for both Production and Preview.

Project → **Settings → Variables and Secrets**, for both environments:

| Name | Type | Value |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | Secret | The key from the Anthropic Console |
| `CF_ACCESS_TEAM_DOMAIN` | Plaintext | Your Zero Trust team domain, e.g. `brandon.cloudflareaccess.com` |
| `CF_ACCESS_AUD` | Plaintext | The Access application's **Audience (AUD) tag**, copied from the app's Overview after Step 4 |

`CF_ACCESS_AUD` doesn't exist until the Access application does, so set it after Step 4 and redeploy. Do **not** set `DEV_BYPASS_EMAIL` here — it belongs only in local `.dev.vars`.

- [ ] **Step 4: Create the Access application**

Zero Trust → **Access controls → Applications → Add an application → Self-hosted**.

- Application name: `Camper Shortlist`
- Public hostname: the project's `pages.dev` hostname (Q1: there is no custom domain). **If a custom domain is added to this project later, create a second Access application for it** — otherwise the tool is reachable unauthenticated through that domain.
- Paths: `/shortlist*` and `/api/*` — **do not gate `/`**, or the public report stops being public
- Policy: name `Owners`, action `Allow`, rule `Emails` → `bfaloona@gmail.com`, `kristenwalshseattle@gmail.com`
- Identity provider: Google. Add One-time PIN as a second provider so a Google outage doesn't lock you both out.

- [ ] **Step 5: Verify the gate**

From a signed-out browser or a private window:

1. Visit `https://<host>/` → the report loads with no login prompt.
2. Visit `https://<host>/api/prefs` → redirected to the Google sign-in page.
3. Sign in as `bfaloona@gmail.com` → the JSON blob renders.
4. Sign in as a third Google account → Access denies with its own block page.
5. Confirm the GitHub Pages URL still serves the report unchanged.

```bash
curl -si https://<host>/vehicles.json | head -1
curl -si https://<host>/api/prefs | head -1
```

Expected: `200` for the first, a `302` to the Access login for the second. Capture both as the artifact for this task.

- [ ] **Step 6: Document the deployment**

Add a **Deployment** section to `CLAUDE.md`:

```markdown
## Deployment

Two deploy targets, on purpose:

| Target | Serves | Auth |
| --- | --- | --- |
| GitHub Pages | The public report (`index.html`) | None |
| Cloudflare Pages | The same repo *plus* `/shortlist` and `/api/*` | Cloudflare Access on `/shortlist*` and `/api/*` only |

Cloudflare bindings: KV namespace `camper-report-prefs` bound as `PREFS`; secret
`ANTHROPIC_API_KEY`. The Access policy allows exactly two emails. `/` is deliberately
ungated — gating it would break the public report.
```

- [ ] **Step 7: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: record the Cloudflare Pages and Access deployment"
```

---

### Task 7: The prose→criteria parse endpoint

**Files:**
- Create: `functions/api/parse.js`
- Create: `functions/api/parse.test.mjs`

**Interfaces:**
- Consumes: `requireUser`; `env.ANTHROPIC_API_KEY`.
- Produces: `POST /api/parse` with body `{ text }` → `{ criteria: [...] }`, each entry matching the criterion shape in the Data model. Also exports `validateCriteria(raw)` for the unit test.

**Design:** the model is constrained by a JSON schema through `output_config.format`, then the result is validated server-side against the field vocabulary. A criterion naming an unknown field, or one the model could not express as a rule, comes back as `kind: "manual"` rather than being dropped — the user still sees their intent, they just judge it themselves.

- [ ] **Step 1: Write the failing test**

Create `functions/api/parse.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateCriteria, FIELD_IDS } from './parse.js';

test('the field vocabulary includes the documented fields', () => {
  for (const f of ['length_in', 'safety_feature_count', 'powertrain', 'drivetrain_bucket']) {
    assert.ok(FIELD_IDS.includes(f), `${f} missing from FIELD_IDS`);
  }
});

test('keeps a well-formed hard numeric criterion', () => {
  const [c] = validateCriteria([{
    label: 'Under 195 inches long', tier: 'deal-breaker', kind: 'hard',
    rule: { field: 'length_in', op: '<', value: 195 }, source_text: 'shorter than 195 in',
  }]);
  assert.equal(c.kind, 'hard');
  assert.deepEqual(c.rule, { field: 'length_in', op: '<', value: 195 });
  assert.match(c.id, /^c_/);
});

test('keeps a well-formed fuzzy criterion', () => {
  const [c] = validateCriteria([{
    label: 'Max safety features', tier: 'must-have', kind: 'fuzzy',
    rule: { field: 'safety_feature_count', direction: 'higher' }, source_text: 'max safety',
  }]);
  assert.equal(c.kind, 'fuzzy');
  assert.equal(c.rule.direction, 'higher');
});

test('demotes an unknown field to manual instead of dropping it', () => {
  const [c] = validateCriteria([{
    label: 'Good stereo', tier: 'nice-to-have', kind: 'hard',
    rule: { field: 'stereo_quality', op: '>', value: 3 }, source_text: 'good stereo',
  }]);
  assert.equal(c.kind, 'manual');
  assert.equal(c.rule, null);
  assert.equal(c.label, 'Good stereo');
});

test('demotes an unknown operator to manual', () => {
  const [c] = validateCriteria([{
    label: 'Length', tier: 'must-have', kind: 'hard',
    rule: { field: 'length_in', op: 'approximately', value: 195 }, source_text: 'about 195',
  }]);
  assert.equal(c.kind, 'manual');
});

test('demotes a non-numeric value on a numeric field', () => {
  const [c] = validateCriteria([{
    label: 'Length', tier: 'must-have', kind: 'hard',
    rule: { field: 'length_in', op: '<', value: 'short' }, source_text: 'short',
  }]);
  assert.equal(c.kind, 'manual');
});

test('accepts enum membership rules', () => {
  const [c] = validateCriteria([{
    label: 'AWD only', tier: 'must-have', kind: 'hard',
    rule: { field: 'drivetrain_bucket', op: 'in', value: ['awd'] }, source_text: 'awd',
  }]);
  assert.equal(c.kind, 'hard');
});

test('rejects an unknown tier', () => {
  assert.deepEqual(validateCriteria([{ label: 'x', tier: 'wishlist', kind: 'manual', rule: null }]), []);
});

test('drops entries with no usable label', () => {
  assert.deepEqual(validateCriteria([{ label: '   ', tier: 'must-have', kind: 'manual', rule: null }]), []);
});

test('assigns sequential ranks and derived weights', () => {
  const out = validateCriteria([
    { label: 'A', tier: 'must-have', kind: 'manual', rule: null },
    { label: 'B', tier: 'nice-to-have', kind: 'manual', rule: null },
  ]);
  assert.deepEqual(out.map(c => c.rank), [1, 2]);
  assert.deepEqual(out.map(c => c.weight), [5, 4]);
  assert.deepEqual(out.map(c => c.weight_locked), [false, false]);
});

test('returns an empty array for a non-array input', () => {
  assert.deepEqual(validateCriteria(null), []);
  assert.deepEqual(validateCriteria({ criteria: [] }), []);
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
node --test functions/api/parse.test.mjs
```

Expected: FAIL — `Cannot find module .../functions/api/parse.js`.

- [ ] **Step 3: Write `functions/api/parse.js`**

```js
import Anthropic from '@anthropic-ai/sdk';
import { requireUser } from '../_lib/auth.js';

const NUMERIC_FIELDS = [
  'length_in', 'width_in', 'height_in', 'cargo_length_in', 'max_cargo_cf',
  'mpg_city', 'mpg_hwy', 'ev_range_mi', 'price_low', 'price_high', 'tow_max',
  'reliability_score', 'safety_feature_count', 'conversion_kit_count',
  'camper_popularity', 'listed_year',
];
const ENUM_FIELDS = {
  vehicle_class: ['SUV', 'Minivan', 'Compact minivan', 'Compact van', 'Wagon', 'Hatchback'],
  powertrain: ['gas', 'hybrid', 'phev', 'ev'],
  drivetrain_bucket: ['awd', '2wd'],
};

export const FIELD_IDS = [...NUMERIC_FIELDS, ...Object.keys(ENUM_FIELDS)];

const TIERS = ['must-have', 'nice-to-have', 'dislike', 'deal-breaker'];
const NUMERIC_OPS = ['<', '<=', '>', '>=', '==', '!=', 'between'];
const ENUM_OPS = ['in', 'not_in'];

// Rank 1 is the most important; weight falls off to a floor of 1.
const weightForRank = rank => Math.max(1, 6 - rank);

let seq = 0;
const newId = () => `c_${Date.now()}_${(seq++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

function validRule(rule) {
  if (!rule || typeof rule !== 'object' || typeof rule.field !== 'string') return null;
  const numeric = NUMERIC_FIELDS.includes(rule.field);
  const isEnum = Object.prototype.hasOwnProperty.call(ENUM_FIELDS, rule.field);
  if (!numeric && !isEnum) return null;

  if (typeof rule.direction === 'string') {
    if (!numeric || !['higher', 'lower'].includes(rule.direction)) return null;
    return { field: rule.field, direction: rule.direction };
  }

  if (numeric) {
    if (!NUMERIC_OPS.includes(rule.op)) return null;
    if (rule.op === 'between') {
      if (!Array.isArray(rule.value) || rule.value.length !== 2) return null;
      if (!rule.value.every(n => typeof n === 'number' && Number.isFinite(n))) return null;
      return { field: rule.field, op: 'between', value: [...rule.value].sort((a, b) => a - b) };
    }
    if (typeof rule.value !== 'number' || !Number.isFinite(rule.value)) return null;
    return { field: rule.field, op: rule.op, value: rule.value };
  }

  if (!ENUM_OPS.includes(rule.op)) return null;
  const allowed = ENUM_FIELDS[rule.field];
  const values = Array.isArray(rule.value) ? rule.value : [rule.value];
  if (!values.length || !values.every(v => allowed.includes(v))) return null;
  return { field: rule.field, op: rule.op, value: values };
}

// Anything the model produced that we cannot express against the field
// vocabulary survives as kind:"manual" — the user's intent is preserved and
// shown, it just doesn't drive the score automatically.
export function validateCriteria(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const label = typeof entry.label === 'string' ? entry.label.trim() : '';
    if (!label) continue;
    if (!TIERS.includes(entry.tier)) continue;

    const rule = entry.kind === 'manual' ? null : validRule(entry.rule);
    const kind = rule === null ? 'manual' : (rule.direction ? 'fuzzy' : 'hard');
    const rank = out.length + 1;

    out.push({
      id: newId(),
      label,
      tier: entry.tier,
      rank,
      weight: weightForRank(rank),
      weight_locked: false,
      kind,
      rule,
      source_text: typeof entry.source_text === 'string' ? entry.source_text : label,
    });
  }
  return out;
}

const SCHEMA = {
  type: 'object',
  properties: {
    criteria: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          label: { type: 'string' },
          tier: { type: 'string', enum: TIERS },
          kind: { type: 'string', enum: ['hard', 'fuzzy', 'manual'] },
          source_text: { type: 'string' },
          rule: {
            anyOf: [
              { type: 'null' },
              {
                type: 'object',
                properties: {
                  field: { type: 'string', enum: FIELD_IDS },
                  op: { type: 'string', enum: [...NUMERIC_OPS, ...ENUM_OPS] },
                  value: {},
                },
                required: ['field', 'op', 'value'],
                additionalProperties: false,
              },
              {
                type: 'object',
                properties: {
                  field: { type: 'string', enum: NUMERIC_FIELDS },
                  direction: { type: 'string', enum: ['higher', 'lower'] },
                },
                required: ['field', 'direction'],
                additionalProperties: false,
              },
            ],
          },
        },
        required: ['label', 'tier', 'kind', 'rule', 'source_text'],
        additionalProperties: false,
      },
    },
  },
  required: ['criteria'],
  additionalProperties: false,
};

const SYSTEM = `You turn a person's prose about the vehicle they want into structured criteria for a camper-conversion shortlist tool.

Split the prose into one criterion per distinct want. For each:

- "tier": "deal-breaker" if violating it rules a vehicle out entirely; "must-have" if it is required but a judgment call; "nice-to-have" if it is a preference; "dislike" if it is something to avoid.
- "kind": "hard" when the want maps to a threshold or set membership on one of the available fields; "fuzzy" when it maps to a direction on a numeric field but has no threshold ("as much cargo room as possible"); "manual" when no field expresses it.
- "rule": for "hard", {field, op, value}. For "fuzzy", {field, direction}. For "manual", null.
- "label": a short human-readable restatement, under 60 characters.
- "source_text": the fragment of the person's input this came from, verbatim.

Units are inches for dimensions, USD for prices, pounds for towing. camper_popularity is ordinal: 1 = Low, 2 = Medium, 3 = High. Prefer "manual" over forcing a want onto a field that does not really mean the same thing.`;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

export async function onRequestPost({ request, env }) {
  const { response } = await requireUser(request, env);
  if (response) return response;

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json({ error: 'Body must be JSON' }, 400);
  }
  const text = typeof body?.text === 'string' ? body.text.trim() : '';
  if (!text) return json({ error: 'Body must be { text }' }, 400);
  if (text.length > 4000) return json({ error: 'Text is too long (4000 character limit)' }, 400);

  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

  let message;
  try {
    message = await client.messages.create({
      model: 'claude-opus-5',
      // Thinking is on by default on Opus 5 and shares this budget with the
      // JSON output, so this is deliberately roomy for a short extraction task.
      max_tokens: 16000,
      output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
      system: SYSTEM,
      messages: [{ role: 'user', content: text }],
    });
  } catch (e) {
    return json({ error: 'Could not reach the parsing service. Add criteria by hand and try again later.' }, 502);
  }

  if (message.stop_reason === 'refusal') {
    return json({ error: 'The parsing service declined that input.' }, 422);
  }
  if (message.stop_reason === 'max_tokens') {
    return json({ error: 'That was too much to parse at once. Try a shorter description.' }, 422);
  }

  const block = message.content.find(b => b.type === 'text');
  if (!block) return json({ error: 'Empty response from the parsing service' }, 502);

  let parsed;
  try {
    parsed = JSON.parse(block.text);
  } catch (e) {
    return json({ error: 'Unparseable response from the parsing service' }, 502);
  }

  return json({ criteria: validateCriteria(parsed.criteria) });
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
node --test functions/api/parse.test.mjs
```

Expected: PASS, 11/11.

- [ ] **Step 5: Verify against the real API**

Add the key to `.dev.vars` alongside `DEV_BYPASS_EMAIL`:

```
ANTHROPIC_API_KEY=sk-ant-...
```

```bash
npx wrangler pages dev . --kv PREFS
```

```bash
curl -s -X POST \
  -H 'content-type: application/json' \
  -d '{"text":"It has to be under 195 inches long and I want maximum standard safety features. AWD would be nice. Nothing that looks like a contractor van."}' \
  http://localhost:8788/api/parse | python3 -m json.tool
```

Expected: four criteria — a `hard` `length_in < 195` at `deal-breaker` or `must-have`, a `fuzzy` `safety_feature_count` `higher`, a `hard` `drivetrain_bucket in ["awd"]` at `nice-to-have`, and a `manual` entry for the contractor-van line. Exact tiers are the model's judgment; what matters is that every criterion is represented and no field outside the vocabulary appears.

**If the request 400s on the schema:** `value: {}` (any type) is the one part of `SCHEMA` the structured-outputs compiler may reject, since it accepts only a documented subset of JSON Schema. Replace it with an explicit union and re-run:

```js
value: { anyOf: [{ type: 'number' }, { type: 'array', items: { type: 'number' } }, { type: 'array', items: { type: 'string' } }] },
```

`validateCriteria` already handles all three shapes, so no other change is needed.

Save the output as the artifact for this task.

- [ ] **Step 6: Commit**

```bash
git add functions/api/parse.js functions/api/parse.test.mjs
git commit -m "feat: parse prose preferences into structured criteria via the Claude API"
```

---

# Phase 3 — The Shortlist page

### Task 8: The scoring module

**Files:**
- Create: `shortlist/scoring.js`
- Create: `shortlist/scoring.test.mjs`

**Interfaces:**
- Produces: `FIELDS`, `fieldValue(vehicle, fieldId)`, `evaluateGate(vehicle, criterion)`, `rankVehicles(vehicles, criteria, pins)` — consumed by `shortlist/index.html`.

`rankVehicles` returns, for each vehicle, in descending score order:

```js
{
  vehicle,                  // the original record
  score,                    // 0..100
  excluded,                 // true when a hard gate failed and it is not pinned
  pinned,                   // true when the id is in pins
  violations: [{ id, label }],
  unknowns:   [{ id, label }],
  contributions: [{ id, label, normalized, weighted }]
}
```

- [ ] **Step 1: Write the failing test**

Create `shortlist/scoring.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FIELDS, fieldValue, evaluateGate, rankVehicles } from './scoring.js';

const v = (id, over = {}) => ({
  id,
  make: 'Test', model: id, class: 'SUV', powertrain: 'gas', drivetrain: 'AWD', listed_year: 2024,
  exterior_in: { length: 190, width: 73, height: 67 },
  cargo_length_behind_front_seats_in: { value: 70 },
  max_cargo_cf: { value: 70 },
  mpg: { city: 25, hwy: 30 },
  kbb_value_usd: { low: 30000, high: 35000 },
  tow_rating: { max: 3500, tongue: 350 },
  reliability: { score: 4.0 },
  safety: { features: ['a', 'b', 'c'] },
  conversion_products: [{ name: 'x' }],
  camper_popularity: { rating: 'Medium' },
  ...over,
});

const hard = (field, op, value, tier = 'must-have') =>
  ({ id: 'h', label: 'gate', tier, kind: 'hard', rank: 1, weight: 5, rule: { field, op, value } });
const fuzzy = (field, direction, tier = 'nice-to-have', weight = 3) =>
  ({ id: 'f', label: 'pref', tier, kind: 'fuzzy', rank: 1, weight, rule: { field, direction } });

test('every documented field resolves', () => {
  const car = v('a');
  for (const id of Object.keys(FIELDS)) {
    assert.doesNotThrow(() => fieldValue(car, id), `${id} threw`);
  }
});

// The parser and the scorer keep two copies of the field vocabulary. If they
// drift, the parser emits criteria naming fields the scorer cannot read, and
// those criteria silently never score — no error, just a preference that
// quietly does nothing. This test is the only thing preventing that.
test('every field the parser can emit is one the scorer can read', async () => {
  const { FIELD_IDS } = await import('../functions/api/parse.js');
  const missing = FIELD_IDS.filter(id => !(id in FIELDS));
  assert.deepEqual(missing, [], `parse.js emits fields scoring.js cannot resolve: ${missing}`);
});

test('no scorer field resolves to a raw object', () => {
  // e.g. max_cargo_cf is `{value, config, source}` in vehicles.json — the
  // getter must reach `.value`, not hand the scorer a dict to compare with `<`.
  const car = v('a');
  for (const id of Object.keys(FIELDS)) {
    const out = fieldValue(car, id);
    assert.ok(out === null || typeof out === 'number' || typeof out === 'string',
      `${id} returned ${typeof out}`);
  }
});

test('drivetrain buckets AWD and 4WD together', () => {
  assert.equal(fieldValue(v('a', { drivetrain: '4WD' }), 'drivetrain_bucket'), 'awd');
  assert.equal(fieldValue(v('a', { drivetrain: 'FWD' }), 'drivetrain_bucket'), '2wd');
});

test('camper_popularity is ordinal', () => {
  assert.equal(fieldValue(v('a', { camper_popularity: { rating: 'High' } }), 'camper_popularity'), 3);
});

test('a missing optional field reads as null', () => {
  assert.equal(fieldValue(v('a', { max_cargo_cf: null }), 'max_cargo_cf'), null);
});

test('gate passes and fails on numeric comparison', () => {
  assert.equal(evaluateGate(v('a'), hard('length_in', '<', 195)), 'pass');
  assert.equal(evaluateGate(v('a'), hard('length_in', '<', 180)), 'fail');
});

test('between is inclusive', () => {
  assert.equal(evaluateGate(v('a'), hard('length_in', 'between', [190, 200])), 'pass');
  assert.equal(evaluateGate(v('a'), hard('length_in', 'between', [191, 200])), 'fail');
});

test('enum in and not_in', () => {
  assert.equal(evaluateGate(v('a'), hard('drivetrain_bucket', 'in', ['awd'])), 'pass');
  assert.equal(evaluateGate(v('a'), hard('drivetrain_bucket', 'not_in', ['awd'])), 'fail');
});

test('a missing value is unknown, never a failure', () => {
  assert.equal(evaluateGate(v('a', { max_cargo_cf: null }), hard('max_cargo_cf', '>', 60)), 'unknown');
});

test('a failed must-have excludes the vehicle', () => {
  const out = rankVehicles([v('a'), v('b', { exterior_in: { length: 210, width: 73, height: 67 } })],
    [hard('length_in', '<', 195)], new Set());
  assert.equal(out.find(r => r.vehicle.id === 'a').excluded, false);
  assert.equal(out.find(r => r.vehicle.id === 'b').excluded, true);
});

test('a failed deal-breaker excludes the vehicle', () => {
  const out = rankVehicles([v('b', { exterior_in: { length: 210, width: 73, height: 67 } })],
    [hard('length_in', '<', 195, 'deal-breaker')], new Set());
  assert.equal(out[0].excluded, true);
  assert.deepEqual(out[0].violations.map(x => x.id), ['h']);
});

test('a pinned vehicle survives a failed gate but keeps the violation', () => {
  const out = rankVehicles([v('b', { exterior_in: { length: 210, width: 73, height: 67 } })],
    [hard('length_in', '<', 195, 'deal-breaker')], new Set(['b']));
  assert.equal(out[0].excluded, false);
  assert.equal(out[0].pinned, true);
  assert.deepEqual(out[0].violations.map(x => x.id), ['h']);
});

test('an unknown value is reported but does not exclude', () => {
  const out = rankVehicles([v('a', { max_cargo_cf: null })], [hard('max_cargo_cf', '>', 60)], new Set());
  assert.equal(out[0].excluded, false);
  assert.deepEqual(out[0].unknowns.map(x => x.id), ['h']);
});

test('fuzzy higher ranks the larger value first', () => {
  const out = rankVehicles(
    [v('small', { max_cargo_cf: { value: 50 } }), v('big', { max_cargo_cf: { value: 100 } })],
    [fuzzy('max_cargo_cf', 'higher')], new Set());
  assert.deepEqual(out.map(r => r.vehicle.id), ['big', 'small']);
  assert.equal(out[0].score, 100);
  assert.equal(out[1].score, 0);
});

test('fuzzy lower inverts the ordering', () => {
  const out = rankVehicles(
    [v('cheap', { kbb_value_usd: { low: 10000, high: 12000 } }),
     v('dear', { kbb_value_usd: { low: 50000, high: 55000 } })],
    [fuzzy('price_low', 'lower')], new Set());
  assert.deepEqual(out.map(r => r.vehicle.id), ['cheap', 'dear']);
});

test('a dislike tier subtracts', () => {
  const out = rankVehicles(
    [v('short', { exterior_in: { length: 170, width: 73, height: 67 } }),
     v('long', { exterior_in: { length: 210, width: 73, height: 67 } })],
    [fuzzy('length_in', 'higher', 'dislike')], new Set());
  assert.deepEqual(out.map(r => r.vehicle.id), ['short', 'long']);
});

test('weights change the ordering', () => {
  const cheapRoomy = v('a', { kbb_value_usd: { low: 10000, high: 12000 }, max_cargo_cf: { value: 50 } });
  const dearRoomier = v('b', { kbb_value_usd: { low: 50000, high: 55000 }, max_cargo_cf: { value: 100 } });
  const priceHeavy = rankVehicles([cheapRoomy, dearRoomier],
    [{ ...fuzzy('price_low', 'lower'), id: 'p', weight: 5 },
     { ...fuzzy('max_cargo_cf', 'higher'), id: 'c', weight: 1 }], new Set());
  assert.equal(priceHeavy[0].vehicle.id, 'a');
  const cargoHeavy = rankVehicles([cheapRoomy, dearRoomier],
    [{ ...fuzzy('price_low', 'lower'), id: 'p', weight: 1 },
     { ...fuzzy('max_cargo_cf', 'higher'), id: 'c', weight: 5 }], new Set());
  assert.equal(cargoHeavy[0].vehicle.id, 'b');
});

test('manual criteria never affect the score', () => {
  const manual = { id: 'm', label: 'vibes', tier: 'nice-to-have', kind: 'manual', rank: 1, weight: 5, rule: null };
  const out = rankVehicles([v('a'), v('b')], [manual], new Set());
  assert.equal(out[0].score, out[1].score);
  assert.deepEqual(out[0].contributions, []);
});

test('no scoring criteria yields a flat score and preserves input order', () => {
  const out = rankVehicles([v('a'), v('b')], [], new Set());
  assert.deepEqual(out.map(r => r.vehicle.id), ['a', 'b']);
  assert.equal(out[0].score, 0);
});

test('identical values across the set do not divide by zero', () => {
  const out = rankVehicles([v('a'), v('b')], [fuzzy('max_cargo_cf', 'higher')], new Set());
  assert.ok(Number.isFinite(out[0].score));
  assert.equal(out[0].score, out[1].score);
});

test('excluded vehicles sort after included ones regardless of score', () => {
  const good = v('good', { max_cargo_cf: { value: 50 } });
  const bigButLong = v('long', { max_cargo_cf: { value: 100 }, exterior_in: { length: 210, width: 73, height: 67 } });
  const out = rankVehicles([good, bigButLong],
    [hard('length_in', '<', 195), fuzzy('max_cargo_cf', 'higher')], new Set());
  assert.deepEqual(out.map(r => r.vehicle.id), ['good', 'long']);
  assert.equal(out[1].excluded, true);
});

test('contributions explain the score', () => {
  const out = rankVehicles(
    [v('a', { max_cargo_cf: { value: 100 } }), v('b', { max_cargo_cf: { value: 50 } })],
    [fuzzy('max_cargo_cf', 'higher')], new Set());
  const c = out[0].contributions[0];
  assert.equal(c.id, 'f');
  assert.equal(c.normalized, 1);
  assert.equal(c.weighted, 3);
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
node --test shortlist/scoring.test.mjs
```

Expected: FAIL — `Cannot find module .../shortlist/scoring.js`.

- [ ] **Step 3: Write `shortlist/scoring.js`**

```js
// Pure scoring for the Shortlist tool. No DOM, no fetch — everything here is a
// function of (vehicles, criteria, pins), which is what makes it testable.

const POP_ORDER = { Low: 1, Medium: 2, High: 3 };
const num = x => (typeof x === 'number' && Number.isFinite(x) ? x : null);

export const FIELDS = {
  length_in:            { label: 'Length (in)',         type: 'number', get: v => num(v.exterior_in?.length) },
  width_in:             { label: 'Width (in)',          type: 'number', get: v => num(v.exterior_in?.width) },
  height_in:            { label: 'Height (in)',         type: 'number', get: v => num(v.exterior_in?.height) },
  cargo_length_in:      { label: 'Cargo length (in)',   type: 'number', get: v => num(v.cargo_length_behind_front_seats_in?.value) },
  max_cargo_cf:         { label: 'Max cargo (cu ft)',   type: 'number', get: v => num(v.max_cargo_cf?.value) },
  mpg_city:             { label: 'MPG city',            type: 'number', get: v => num(v.mpg?.city) },
  mpg_hwy:              { label: 'MPG highway',         type: 'number', get: v => num(v.mpg?.hwy) },
  ev_range_mi:          { label: 'EV range (mi)',       type: 'number', get: v => num(v.mpg?.ev_range_mi) },
  price_low:            { label: 'KBB low ($)',         type: 'number', get: v => num(v.kbb_value_usd?.low) },
  price_high:           { label: 'KBB high ($)',        type: 'number', get: v => num(v.kbb_value_usd?.high) },
  tow_max:              { label: 'Tow rating (lbs)',    type: 'number', get: v => num(v.tow_rating?.max) },
  reliability_score:    { label: 'Reliability (/5)',    type: 'number', get: v => num(v.reliability?.score) },
  safety_feature_count: { label: 'Safety features',     type: 'number', get: v => (Array.isArray(v.safety?.features) ? v.safety.features.length : null) },
  conversion_kit_count: { label: 'Conversion kits',     type: 'number', get: v => (Array.isArray(v.conversion_products) ? v.conversion_products.length : null) },
  camper_popularity:    { label: 'Camper popularity',   type: 'number', get: v => POP_ORDER[v.camper_popularity?.rating] ?? null },
  listed_year:          { label: 'Model year',          type: 'number', get: v => num(v.listed_year) },
  vehicle_class:        { label: 'Class',               type: 'enum',   get: v => v.class ?? null },
  powertrain:           { label: 'Powertrain',          type: 'enum',   get: v => v.powertrain ?? null },
  drivetrain_bucket:    { label: 'Drivetrain',          type: 'enum',   get: v => (v.drivetrain === 'AWD' || v.drivetrain === '4WD' ? 'awd' : v.drivetrain ? '2wd' : null) },
};

export function fieldValue(vehicle, fieldId) {
  const f = FIELDS[fieldId];
  return f ? f.get(vehicle) : null;
}

// 'pass' | 'fail' | 'unknown'. Missing data is never a failure — a vehicle we
// lack a measurement for should surface for a human to check, not vanish.
export function evaluateGate(vehicle, criterion) {
  const rule = criterion.rule;
  if (!rule || rule.direction) return 'pass';
  const value = fieldValue(vehicle, rule.field);
  if (value === null) return 'unknown';

  switch (rule.op) {
    case '<':  return value <  rule.value ? 'pass' : 'fail';
    case '<=': return value <= rule.value ? 'pass' : 'fail';
    case '>':  return value >  rule.value ? 'pass' : 'fail';
    case '>=': return value >= rule.value ? 'pass' : 'fail';
    case '==': return value === rule.value ? 'pass' : 'fail';
    case '!=': return value !== rule.value ? 'pass' : 'fail';
    case 'between': {
      const [lo, hi] = rule.value;
      return value >= lo && value <= hi ? 'pass' : 'fail';
    }
    case 'in':     return rule.value.includes(value) ? 'pass' : 'fail';
    case 'not_in': return rule.value.includes(value) ? 'fail' : 'pass';
    default: return 'unknown';
  }
}

const GATE_TIERS = new Set(['must-have', 'deal-breaker']);
const isGate    = c => c.kind === 'hard' && GATE_TIERS.has(c.tier);
const isScoring = c => (c.kind === 'fuzzy') || (c.kind === 'hard' && !GATE_TIERS.has(c.tier));

function rangesFor(vehicles, criteria) {
  const ranges = new Map();
  for (const c of criteria) {
    if (c.kind !== 'fuzzy') continue;
    let lo = Infinity, hi = -Infinity;
    for (const v of vehicles) {
      const x = fieldValue(v, c.rule.field);
      if (x === null) continue;
      if (x < lo) lo = x;
      if (x > hi) hi = x;
    }
    ranges.set(c.id, Number.isFinite(lo) ? { lo, hi } : null);
  }
  return ranges;
}

export function rankVehicles(vehicles, criteria, pins) {
  const gates = criteria.filter(isGate);
  const scorers = criteria.filter(isScoring);
  const ranges = rangesFor(vehicles, scorers);

  // The reachable range of `raw`, so the 0..100 mapping puts the worst possible
  // vehicle at 0 and the best at 100 whatever mix of tiers is in play.
  const weightOf = c => Math.abs(c.weight ?? 1);
  const posWeight = scorers.reduce((s, c) => s + (c.tier === 'dislike' ? 0 : weightOf(c)), 0);
  const negWeight = scorers.reduce((s, c) => s + (c.tier === 'dislike' ? weightOf(c) : 0), 0);
  const span = posWeight + negWeight;

  const rows = vehicles.map((vehicle, index) => {
    const violations = [];
    const unknowns = [];
    for (const c of gates) {
      const verdict = evaluateGate(vehicle, c);
      if (verdict === 'fail') violations.push({ id: c.id, label: c.label });
      else if (verdict === 'unknown') unknowns.push({ id: c.id, label: c.label });
    }

    const contributions = [];
    let raw = 0;
    for (const c of scorers) {
      const weight = weightOf(c);
      const sign = c.tier === 'dislike' ? -1 : 1;
      let normalized = null;

      if (c.kind === 'fuzzy') {
        const range = ranges.get(c.id);
        const x = fieldValue(vehicle, c.rule.field);
        if (range && x !== null) {
          const span = range.hi - range.lo;
          const t = span === 0 ? 1 : (x - range.lo) / span;
          normalized = c.rule.direction === 'lower' ? 1 - t : t;
        }
      } else {
        const verdict = evaluateGate(vehicle, c);
        if (verdict !== 'unknown') normalized = verdict === 'pass' ? 1 : 0;
        else unknowns.push({ id: c.id, label: c.label });
      }

      if (normalized === null) continue;
      const weighted = Math.round(sign * weight * normalized * 100) / 100;
      raw += weighted;
      contributions.push({ id: c.id, label: c.label, normalized, weighted });
    }

    // Map the signed total onto 0..100 so scores are comparable between runs.
    const score = span === 0 ? 0 : Math.round(((raw + negWeight) / span) * 1000) / 10;

    return {
      vehicle,
      score,
      pinned: pins.has(vehicle.id),
      excluded: violations.length > 0 && !pins.has(vehicle.id),
      violations,
      unknowns,
      contributions,
      _index: index,
    };
  });

  rows.sort((a, b) => {
    if (a.excluded !== b.excluded) return a.excluded ? 1 : -1;
    if (b.score !== a.score) return b.score - a.score;
    return a._index - b._index;
  });
  return rows.map(({ _index, ...row }) => row);
}
```

Note on the score mapping: `raw` ranges from `-negWeight` (every dislike fully triggered, nothing wanted satisfied) to `+posWeight` (the reverse), so the mapping puts the worst reachable vehicle at 0 and the best at 100 whatever mix of tiers is in play. A single positive criterion therefore gives the largest value 100 and the smallest 0, which is what the tests assert.

- [ ] **Step 4: Run the test to verify it passes**

```bash
node --test shortlist/scoring.test.mjs
```

Expected: PASS, 21/21.

- [ ] **Step 5: Commit**

```bash
git add shortlist/scoring.js shortlist/scoring.test.mjs
git commit -m "feat: add the preference scoring module for the Shortlist tool"
```

---

### Task 9: Share the report's presentation with the Shortlist page

**Files:**
- Modify: `index.html` (add sync markers only — no behavior change)
- Modify: `camper-vehicle-comparison.html` (mirror)
- Modify: `scripts/sync_vehicles.py`
- Modify: `CLAUDE.md`

**Interfaces:**
- Produces: `python3 scripts/sync_vehicles.py --shared` and `--check-shared`, copying two marked blocks from `index.html` into `shortlist/index.html`.

**Why not an ES module:** `index.html` must keep working over `file://`, where module imports are blocked by CORS. Copying marked blocks with the same script that already copies the data block keeps one source of truth without breaking local use, and it matches an idiom this repo already has.

- [ ] **Step 1: Add the sync markers to `index.html`**

Wrap the entire contents of the `<style>` element:

```html
<style>
/*STYLE-START*/
...existing CSS unchanged...
/*STYLE-END*/
</style>
```

Wrap the render functions — from the line above `const fmt =` through the closing brace of `renderTable` — in:

```js
/*RENDER-START*/
...existing fmt, POP_ORDER, PT_LABEL, DT_LABEL, DT_BUCKET, towText, COLUMNS,
   photoCell, renderCards, renderTable, esc — unchanged...
/*RENDER-END*/
```

Move `esc()` (`index.html:3019`) up into this block, since `renderCards` already calls it and the Shortlist page will need it too.

Make exactly one substantive edit inside the block: give each card a stable id so the Shortlist page can annotate it. In `renderCards`, change `<div class="card">` to:

```html
  <div class="card" data-id="${v.id}">
```

Table rows already carry `data-id`. Nothing else between the markers may change.

**Contract the synced block imposes on any host page:** `renderCards` and `renderTable` read the globals `state.pins`, `state.selected`, `state.sortKey`, `state.sortDir`, and `renderTable`'s header handlers call a global `render()`. Any page that includes this block must define both before calling either function. Task 10 does this explicitly.

- [ ] **Step 2: Verify the report still works**

```bash
python3 scripts/sync_vehicles.py --check
node --test scripts/pins.test.mjs
```

Expected: both pass. Open `index.html`: cards and table render exactly as before.

- [ ] **Step 3: Extend `scripts/sync_vehicles.py`**

Add to the script, following its existing structure and argument style:

```python
SHARED_BLOCKS = ("STYLE", "RENDER")
SHORTLIST = ROOT / "shortlist" / "index.html"


def _extract(text, name):
    """Return the body between /*NAME-START*/ and /*NAME-END*/."""
    start = text.index(f"/*{name}-START*/") + len(f"/*{name}-START*/")
    end = text.index(f"/*{name}-END*/")
    return text[start:end]


def _replace(text, name, body):
    start_tag, end_tag = f"/*{name}-START*/", f"/*{name}-END*/"
    start = text.index(start_tag) + len(start_tag)
    end = text.index(end_tag)
    return text[:start] + body + text[end:]


def sync_shared(check=False):
    """Copy the marked style and render blocks from index.html into the
    Shortlist page. index.html is the single source of truth for presentation;
    it can't export ES modules without breaking file:// use, so we copy."""
    source = (ROOT / "index.html").read_text()
    target = SHORTLIST.read_text()
    updated = target
    for name in SHARED_BLOCKS:
        updated = _replace(updated, name, _extract(source, name))
    if check:
        if updated != target:
            print("shortlist/index.html is out of sync with index.html "
                  "(run: python3 scripts/sync_vehicles.py --shared)")
            return 1
        return 0
    if updated != target:
        SHORTLIST.write_text(updated)
        print(f"Updated shared blocks in {SHORTLIST.relative_to(ROOT)}")
    return 0
```

Wire `--shared` and `--check-shared` into the existing argument handling, and make `--check` also run `sync_shared(check=True)` when `shortlist/index.html` exists, so one command still verifies everything.

- [ ] **Step 4: Verify the extraction against the source**

`shortlist/index.html` does not exist yet — Task 10 creates it, and Task 10's Step 3 is where the round-trip is exercised. Verify the extraction half here, standalone:

```bash
python3 - <<'PY'
from pathlib import Path
import sys
sys.path.insert(0, 'scripts')
from sync_vehicles import _extract
src = Path('index.html').read_text()
for name in ('STYLE', 'RENDER'):
    body = _extract(src, name)
    print(name, len(body), 'chars')
    assert body.strip(), f'{name} block is empty'
assert 'renderCards' in _extract(src, 'RENDER')
assert 'localStorage' not in _extract(src, 'RENDER'), 'pin helpers leaked into the RENDER block'
print('ok')
PY
```

Expected: two non-empty blocks and `ok`. The last assertion is the guard against Task 2's `/*PURE-*/` block drifting inside the render span.

- [ ] **Step 5: Mirror to the second HTML file and document**

```bash
cp index.html camper-vehicle-comparison.html
diff index.html camper-vehicle-comparison.html
```

In `CLAUDE.md`, under the sync-script documentation, add:

```bash
python3 scripts/sync_vehicles.py --shared        # copy style + render blocks into shortlist/index.html
python3 scripts/sync_vehicles.py --check-shared  # verify those blocks are in sync
```

with a line explaining that `index.html` owns the `/*STYLE-*/` and `/*RENDER-*/` blocks and the Shortlist page receives copies.

- [ ] **Step 6: Commit**

```bash
git add index.html camper-vehicle-comparison.html scripts/sync_vehicles.py CLAUDE.md
git commit -m "feat: sync the report's style and render blocks into the Shortlist page"
```

---

### Task 10: The Shortlist page

**Files:**
- Create: `shortlist/index.html`
- Create: `shortlist/prefs.js`

**Interfaces:**
- Consumes: `rankVehicles` from `./scoring.js`; `/api/prefs`; `/api/parse`; `/vehicles.json`.
- Produces: the deployed tool at `/shortlist/`.

**Three things Phase 2's final review established that this task must respect:**

1. **Stored criteria are untrusted input on read.** `/api/prefs` validates only that `criteria` is an array — it stores the items verbatim and does no per-item checking, deliberately, because `/api/parse` owns the criterion schema. So a criterion loaded from KV may be missing `rule.field`, or carry a rule shape written by an older version. Guard in `scoring.js` rather than assuming; `evaluateGate` already returns `'pass'` for a null rule, but `rankVehicles` must not throw on a malformed one.

2. **The client glue is a real shape change, not a pass-through.** `/api/parse` returns `{ criteria }`. `/api/prefs` PUT wants `{ prefs: { pins, criteria }, etag }`. The page must merge parsed criteria into the *existing* list, preserve `pins`, and carry the etag from the last GET. Sending parse's output straight to prefs loses every pin.

3. **There is no CORS handling on the Functions, by design** — the page is same-origin on Cloudflare Pages. Consequence: this page cannot be developed by opening it over `file://` against the deployed API the way the report can. Use `npx wrangler pages dev .` for all local work on it.

**Layout, top to bottom:**
1. Header: title, the signed-in email, and who last saved (`Last saved by kristenwalshseattle@gmail.com, 2h ago`).
2. Prose box: a textarea, a **Add criteria from this** button, and a note that parsed criteria are editable.
3. Criteria list: one row per criterion, ordered by rank. Each row shows the label, a tier select, the rule (or `manual`), a weight stepper 1–5, up/down rank buttons, and a delete button. An **Add criterion by hand** button appends an empty row.

   The weight stepper is not optional polish. Rank-derived weight is `max(1, 6 - rank)`, so ranks 5, 9 and 20 all land on weight 1 — past four criteria, ordering alone stops changing the score. Editing a weight sets `weight_locked` and pins it against re-derivation, which is what makes a longer list usable.
4. Results: the count line, the cards/table toggle, a `Show N ruled out` toggle, and the ranked list.

**Ruled-out handling (Q3):** vehicles a hard gate excludes are hidden by default. The count line names how many, and the toggle reveals them — dimmed, at the bottom, with their `fails:` badge. Pinned vehicles are never in this group: a pin overrides the gate, so they stay in the main list with the violation badge showing.

- [ ] **Step 1: Write `shortlist/prefs.js`**

```js
// Thin client over /api/prefs. The etag round-trip is what stops two people
// editing at once from silently overwriting each other.
let etag = null;

export async function loadPrefs() {
  const res = await fetch('/api/prefs', { credentials: 'same-origin' });
  if (!res.ok) throw new Error(`Could not load preferences (${res.status})`);
  const body = await res.json();
  etag = body.etag;
  return body.prefs;
}

export async function savePrefs(prefs) {
  const res = await fetch('/api/prefs', {
    method: 'PUT',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prefs, etag }),
  });
  if (res.status === 409) {
    const err = new Error('Someone else saved changes while you were editing. Reload to see them.');
    err.conflict = true;
    throw err;
  }
  if (!res.ok) throw new Error(`Could not save preferences (${res.status})`);
  const body = await res.json();
  etag = body.etag;
  return body.prefs;
}

export async function parseProse(text) {
  const res = await fetch('/api/parse', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Could not parse that text (${res.status})`);
  }
  return (await res.json()).criteria;
}
```

- [ ] **Step 2: Write `shortlist/index.html`**

Create the page with the two marker pairs so Task 9's sync can fill them. Between the markers, put a one-line placeholder comment only — the sync overwrites it.

```html
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Shortlist · Camper vehicle comparison</title>
<style>
/*STYLE-START*/
/* replaced by: python3 scripts/sync_vehicles.py --shared */
/*STYLE-END*/

/* Shortlist-only styles. Everything above comes from index.html — do not add
   report styles here, add them there and re-sync. */
.crit-row { display: grid; grid-template-columns: 1fr 130px 1fr 90px 70px 32px; gap: 8px;
  align-items: center; padding: 8px 0; border-bottom: 1px solid #eee; }
.crit-row .rule { font-family: ui-monospace, Menlo, monospace; font-size: 12px; color: #555; }
.crit-row.manual .rule { font-style: italic; color: #888; }
.excluded { opacity: .45; }
/* The synced renderTable emits compare checkboxes; this page has no compare
   mode, so hide them rather than ship a control that does nothing. */
#table-view input[data-sel] { display: none; }
.score-chip { font-weight: 600; padding: 2px 8px; border-radius: 999px; background: #eef4ec; color: #2c5c34; }
.violation { background: #fdecea; color: #8a1c12; border-radius: 999px; padding: 2px 8px; font-size: 12px; }
.unknown-flag { background: #fff6e0; color: #7a5a10; border-radius: 999px; padding: 2px 8px; font-size: 12px; }
.why { font-size: 12px; color: #555; }
.saving { font-size: 12px; color: #777; }
</style>
</head>
<body>
<header>
  <h1>Shortlist</h1>
  <p id="who" class="saving"></p>
</header>

<main>
  <section id="prose-section">
    <h2>Describe what you want</h2>
    <textarea id="prose" rows="4" maxlength="4000"
      placeholder="Under 195 inches long. Maximum standard safety features. AWD would be nice. Nothing that looks like a contractor van."></textarea>
    <button id="btn-parse">Add criteria from this</button>
    <span id="parse-status" class="saving"></span>
    <p class="why">Everything it produces is editable below — fix anything it gets wrong.</p>
  </section>

  <section id="criteria-section">
    <h2>Criteria</h2>
    <div id="criteria"></div>
    <button id="btn-add">Add criterion by hand</button>
    <span id="save-status" class="saving"></span>
  </section>

  <section id="results-section">
    <h2>Ranked</h2>
    <p id="count-note"></p>
    <button id="btn-cards" class="active">Cards</button>
    <button id="btn-table">Table</button>
    <button id="btn-ruled-out" aria-pressed="false" hidden></button>
    <div id="cards"></div>
    <div id="table-view" style="display:none">
      <table><thead><tr id="thead-row"></tr></thead><tbody id="tbody"></tbody></table>
    </div>
  </section>
</main>

<script>
/*RENDER-START*/
/* replaced by: python3 scripts/sync_vehicles.py --shared */
/*RENDER-END*/
</script>

<script type="module">
import { rankVehicles, FIELDS } from './scoring.js';
import { loadPrefs, savePrefs, parseProse } from './prefs.js';

let prefs = null;
let vehicles = [];
let ranked = [];
let view = 'cards';
let showRuledOut = false;

// The synced render block reads a global `state` and calls a global `render()`.
// Satisfy that contract before anything renders. Filters and compare mode don't
// exist here, so those fields stay empty — ordering comes from rankVehicles.
window.state = { pins: new Set(), selected: new Set(), sortKey: 'vehicle', sortDir: 1 };
window.render = render;

async function boot() {
  const [prefsResult, dataResult] = await Promise.all([
    loadPrefs(),
    fetch('/vehicles.json').then(r => r.json()),
  ]);
  prefs = prefsResult;
  vehicles = dataResult.vehicles;
  document.getElementById('who').textContent = prefs.updated_by
    ? `Last saved by ${prefs.updated_by} on ${new Date(prefs.updated_at).toLocaleString()}`
    : 'No preferences saved yet.';
  render();
}

let saveTimer = null;
function scheduleSave() {
  clearTimeout(saveTimer);
  const status = document.getElementById('save-status');
  status.textContent = 'Saving…';
  saveTimer = setTimeout(async () => {
    try {
      prefs = await savePrefs(prefs);
      status.textContent = 'Saved';
    } catch (err) {
      status.textContent = err.message;
    }
  }, 600);
}

function reRank(criteria) {
  // Ranks are always 1..N contiguous; weights follow rank unless the user
  // pinned a weight by editing it directly.
  criteria.sort((a, b) => a.rank - b.rank);
  criteria.forEach((c, i) => {
    c.rank = i + 1;
    if (!c.weight_locked) c.weight = Math.max(1, 6 - c.rank);
  });
}

function ruleText(c) {
  if (c.kind === 'manual') return 'judge by hand';
  const f = FIELDS[c.rule.field]?.label ?? c.rule.field;
  if (c.rule.direction) return `${f}: ${c.rule.direction === 'higher' ? 'more is better' : 'less is better'}`;
  const value = Array.isArray(c.rule.value) ? c.rule.value.join('–') : c.rule.value;
  return `${f} ${c.rule.op} ${value}`;
}

function renderCriteria() {
  const host = document.getElementById('criteria');
  host.innerHTML = prefs.criteria.map(c => `
    <div class="crit-row ${c.kind}" data-id="${c.id}">
      <input class="c-label" value="${esc(c.label)}" aria-label="Criterion name">
      <select class="c-tier" aria-label="Tier">
        ${['must-have', 'nice-to-have', 'dislike', 'deal-breaker']
          .map(t => `<option value="${t}"${t === c.tier ? ' selected' : ''}>${t}</option>`).join('')}
      </select>
      <span class="rule" title="${esc(c.source_text)}">${esc(ruleText(c))}</span>
      <input class="c-weight" type="number" min="1" max="5" value="${c.weight}" aria-label="Weight">
      <span><button class="c-up" aria-label="Move up">▲</button><button class="c-down" aria-label="Move down">▼</button></span>
      <button class="c-del" aria-label="Delete criterion">✕</button>
    </div>`).join('');
}

function renderResults() {
  state.pins = new Set(prefs.pins);
  ranked = rankVehicles(vehicles, prefs.criteria, state.pins);
  const included = ranked.filter(r => !r.excluded);
  const ruledOut = ranked.length - included.length;

  document.getElementById('count-note').textContent =
    `${included.length} of ${vehicles.length} vehicles meet your must-haves` +
    (ruledOut ? ` · ${ruledOut} ruled out` : '');

  // Ruled-out vehicles are hidden by default; the toggle appends them, dimmed,
  // after the ones that qualify. rankVehicles already sorts excluded last.
  const toggle = document.getElementById('btn-ruled-out');
  toggle.hidden = ruledOut === 0;
  toggle.textContent = showRuledOut ? `Hide ${ruledOut} ruled out` : `Show ${ruledOut} ruled out`;
  toggle.setAttribute('aria-pressed', String(showRuledOut));

  const visible = showRuledOut ? ranked : included;
  const cards = document.getElementById('cards');
  const table = document.getElementById('table-view');
  const rows = visible.map(r => r.vehicle);
  if (view === 'cards') {
    document.getElementById('tbody').innerHTML = '';
    renderCards(rows);
  } else {
    cards.innerHTML = '';
    renderTable(rows);
    // Ranked order is the order here — header-click sorting would silently
    // fight rankVehicles, so switch it off on this page.
    document.querySelectorAll('#thead-row th').forEach(th => { th.onclick = null; th.style.cursor = 'default'; });
  }

  // Annotate the synced markup with what the report doesn't know about:
  // score, exclusions, and the reason for each.
  const host = view === 'cards' ? cards : table;
  for (const r of visible) {
    const el = host.querySelector(`[data-id="${CSS.escape(r.vehicle.id)}"]`);
    if (!el) continue;
    if (r.excluded) el.classList.add('excluded');
    const slot = el.querySelector('.badges') || el.querySelector('td');
    if (!slot) continue;
    const why = r.contributions
      .filter(c => c.weighted !== 0)
      .sort((a, b) => Math.abs(b.weighted) - Math.abs(a.weighted))
      .slice(0, 3)
      .map(c => `${c.label} ${c.weighted > 0 ? '+' : ''}${c.weighted}`)
      .join(' · ');
    slot.insertAdjacentHTML('afterbegin',
      `<span class="score-chip" title="${esc(why || 'No scoring criteria yet')}">${r.score}</span>` +
      r.violations.map(v => `<span class="violation">fails: ${esc(v.label)}</span>`).join('') +
      r.unknowns.map(u => `<span class="unknown-flag">no data: ${esc(u.label)}</span>`).join(''));
  }
}

function render() {
  renderCriteria();
  renderResults();
  document.getElementById('cards').style.display = view === 'cards' ? '' : 'none';
  document.getElementById('table-view').style.display = view === 'table' ? '' : 'none';
}

document.getElementById('btn-parse').onclick = async () => {
  const status = document.getElementById('parse-status');
  const text = document.getElementById('prose').value.trim();
  if (!text) return;
  status.textContent = 'Reading…';
  try {
    const added = await parseProse(text);
    prefs.criteria = prefs.criteria.concat(added);
    reRank(prefs.criteria);
    status.textContent = `Added ${added.length} criteria — edit anything below.`;
    document.getElementById('prose').value = '';
    scheduleSave();
    render();
  } catch (err) {
    status.textContent = err.message;
  }
};

document.getElementById('btn-add').onclick = () => {
  prefs.criteria.push({
    id: `c_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    label: 'New criterion', tier: 'nice-to-have', rank: prefs.criteria.length + 1,
    weight: 3, weight_locked: false, kind: 'manual', rule: null, source_text: '',
  });
  reRank(prefs.criteria);
  scheduleSave();
  render();
};

document.getElementById('criteria').addEventListener('input', e => {
  const row = e.target.closest('.crit-row');
  if (!row) return;
  const c = prefs.criteria.find(x => x.id === row.dataset.id);
  if (e.target.classList.contains('c-label')) c.label = e.target.value;
  if (e.target.classList.contains('c-tier')) c.tier = e.target.value;
  if (e.target.classList.contains('c-weight')) {
    c.weight = Math.min(5, Math.max(1, Number(e.target.value) || 1));
    c.weight_locked = true;
  }
  scheduleSave();
  renderResults();
});

document.getElementById('criteria').addEventListener('click', e => {
  const row = e.target.closest('.crit-row');
  if (!row) return;
  const list = prefs.criteria;
  const i = list.findIndex(x => x.id === row.dataset.id);
  if (e.target.classList.contains('c-up') && i > 0) {
    [list[i - 1].rank, list[i].rank] = [list[i].rank, list[i - 1].rank];
  } else if (e.target.classList.contains('c-down') && i < list.length - 1) {
    [list[i + 1].rank, list[i].rank] = [list[i].rank, list[i + 1].rank];
  } else if (e.target.classList.contains('c-del')) {
    list.splice(i, 1);
  } else return;
  reRank(list);
  scheduleSave();
  render();
});

document.getElementById('btn-cards').onclick = () => { view = 'cards'; render(); };
document.getElementById('btn-table').onclick = () => { view = 'table'; render(); };
document.getElementById('btn-ruled-out').onclick = () => { showRuledOut = !showRuledOut; renderResults(); };

// The synced render block emits data-pin buttons; the report's handler lives
// outside that block, so this page needs its own. Pins here are shared, not
// localStorage — that is the deliberate difference from the report.
document.addEventListener('click', e => {
  const btn = e.target.closest('[data-pin]');
  if (!btn) return;
  e.stopPropagation();
  const id = btn.dataset.pin;
  prefs.pins = prefs.pins.includes(id) ? prefs.pins.filter(x => x !== id) : prefs.pins.concat(id);
  scheduleSave();
  renderResults();
});

boot().catch(err => {
  document.getElementById('who').textContent = err.message;
});
</script>
</body>
</html>
```

- [ ] **Step 3: Fill the synced blocks**

```bash
python3 scripts/sync_vehicles.py --shared
python3 scripts/sync_vehicles.py --check-shared
```

Expected: the first fills both blocks and prints an update; the second exits 0 silently.

Then prove the check actually detects drift: change one CSS value inside the markers in `shortlist/index.html` and re-run `--check-shared`. Expected: exit code 1 and the out-of-sync message. Restore with `--shared`. A check that has never failed is not a verified check.

- [ ] **Step 4: Verify locally**

```bash
npx wrangler pages dev . --kv PREFS
```

Open `http://localhost:8788/shortlist/`. `wrangler pages dev` does not run Access, so the page loads unauthenticated locally — that is expected; Task 6's dashboard check is what proves the gate. Walk through:

1. The page loads, the criteria list is empty, and all 25 vehicles show with equal scores.
2. Paste: *"Under 195 inches long. Maximum standard safety features. AWD would be nice. Nothing that looks like a contractor van."* and click **Add criteria from this**. Four criteria appear.
3. Vehicles over 195 inches disappear from the list; the count line reads `N of 25 vehicles meet your must-haves · M ruled out` and a `Show M ruled out` button appears. Clicking it appends them, dimmed, with a `fails:` badge; clicking again hides them and the label flips back.
4. Change the length criterion's tier to `nice-to-have`. The exclusions disappear and the ordering changes.
5. Raise the safety criterion's weight to 5 and lower AWD to 1. The order changes accordingly, and hovering a score chip shows the top three contributions.
6. Move a criterion up with ▲. Its rank changes; weights of unlocked criteria re-derive.
7. Reload the page. Every criterion, tier, weight, and rank survives.
8. Open the page in a second browser profile, edit there, then save in the first. Expected: the conflict message, not a silent overwrite.
9. Switch to the table view. Rows are in the same ranked order and carry the same badges. Clicking a column header does nothing — ranked order is the order here.
10. With a length gate active, reveal the ruled-out group and pin one of them. It moves into the main list, keeps its `fails:` badge, and the ruled-out count drops by one. Reload — the pin persists (it is in KV, not `localStorage`).

Capture a screenshot of step 5 as the artifact.

- [ ] **Step 5: Verify against the deployed site**

Push, wait for the Pages deploy, then repeat steps 1–10 at `https://<host>/shortlist/`, plus:

11. Sign out and revisit `/shortlist/` — Access intercepts.
12. `https://<host>/` still loads with no login.

- [ ] **Step 6: Commit**

```bash
git add shortlist/index.html shortlist/prefs.js
git commit -m "feat: add the Shortlist page with editable, rankable preferences"
```

---

### Task 11: Document the tool

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Add a Shortlist section to `CLAUDE.md`**

```markdown
## The Shortlist tool (`shortlist/`)

A preference-driven ranking view over the same dataset, deployed only on Cloudflare
Pages and gated by Cloudflare Access to two accounts. Both accounts read and write one
shared preferences blob in Workers KV, so there is no per-user state.

| File | Role |
| --- | --- |
| `shortlist/index.html` | The page. Its `/*STYLE-*/` and `/*RENDER-*/` blocks are **copies** — edit `index.html` and re-run `--shared`. |
| `shortlist/scoring.js` | Pure scoring: field vocabulary, hard gates, weighted ranking. Unit-tested. |
| `shortlist/prefs.js` | Client for `/api/prefs` and `/api/parse`, including the etag conflict guard. |
| `functions/api/prefs.js` | GET/PUT the shared blob in KV (`prefs:v1`). |
| `functions/api/parse.js` | Prose → criteria via `claude-opus-5`, validated against the field vocabulary. |
| `functions/_lib/auth.js` | Email allowlist, read from the Access JWT. |

Rules:
- Adding a scoreable attribute means adding it to `FIELDS` in `scoring.js` **and** to
  `NUMERIC_FIELDS`/`ENUM_FIELDS` in `parse.js`. They must stay in step or the parser will
  emit fields the scorer cannot read.
- Missing data never excludes a vehicle — it surfaces as a `no data` badge.
- Pinned vehicles survive a failed gate and keep the violation badge.
- Run the whole suite with `npm test`.
```

- [ ] **Step 2: Run the full suite**

```bash
npm test
python3 scripts/sync_vehicles.py --check
python3 scripts/sync_vehicles.py --check-shared
diff index.html camper-vehicle-comparison.html
```

Expected: all tests pass, both checks exit 0, `diff` prints nothing.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: document the Shortlist tool and its sync rules"
```

---

## Phase 1 outcome (executed 2026-08-16)

Shipped on `main` in 5 commits: `8201351`, `4a11a36`, `0f02e51`, `2ebfeab`, `101f2c6`.
Unit tests went 0 → 14 (`node --test scripts/pins.test.mjs`).

Beyond the two planned tasks, Phase 1 absorbed three requirements from Brandon (D10–D12)
and six findings from the final whole-branch review. Two of the review findings fixed
latent bugs that predate this work:

- Seven `title="${…}"` sites interpolated record prose without `esc()`. Two records'
  measurement notes contain a literal `"` (`5'10"`, `6'3"`), which closed the attribute
  early and silently truncated the disclosure — including the part warning the figure is
  approximate. All seven now escape.
- `sync_vehicles.py --check` never compared the two HTML files to each other, so the
  byte-identity Global Constraint was enforced only by a human remembering to run `diff`.
  It now fails on divergence, and the check was proven by desyncing a file on purpose.

**Deferred, for whoever picks this up next:**

| Item | Why deferred |
| --- | --- |
| `reliability.score` on the Bolt is RepairPal's alt-fuel segment average | RepairPal publishes no Bolt figure; disclosed in `scale`; five existing records use the same proxy |
| Bolt cargo length is community-compiled (49–65 in spread in owner reports) | Primary source is fetch-blocked; disclosed in `method`; the schema says this field usually is |
| The MPG columns sort MPGe against MPG | The shallow version of the scoring issue above — worth fixing in the table only alongside the scorer |
| The "· N pinned" count note appears even when no filter is active | Cosmetic |

## Status checklist

- [x] Task 1 — Add the 2022 Chevrolet Bolt EV
- [x] Task 2 — Pin vehicles in the report
- [ ] Task 3 — Repo scaffolding for Pages Functions
- [ ] Task 4 — The Access auth guard
- [ ] Task 5 — The shared preferences endpoint
- [ ] Task 6 — Deploy and gate
- [ ] Task 7 — The prose→criteria parse endpoint
- [ ] Task 8 — The scoring module
- [ ] Task 9 — Share the report's presentation with the Shortlist page
- [ ] Task 10 — The Shortlist page
- [ ] Task 11 — Document the tool

## Review record

- [x] Self-review completed against the Source request and Decisions (writing-plans Step: Self-Review) — 2026-08-16. Three defects found and fixed in place: the 0..100 score mapping put the worst vehicle at 50 instead of 0 with all-positive criteria (contradicting Task 8's tests); the Shortlist page called the synced render functions without defining the `state`/`render` globals they depend on; and the score-annotation selector relied on `.card:nth-child()` because cards had no `data-id`.
- [x] Adversarial review (advisor) — 2026-08-16. Three further defects fixed: the auth guard decoded the JWT without verifying its signature while claiming to fail closed (now verifies RS256 against the team JWKS, checks `aud` and `exp`, and has a production-inert local bypass); Task 2's `/*PURE-*/` block was positioned inside Task 9's `/*RENDER-*/` span, which would have synced `localStorage` helpers into the Shortlist page; and Task 9's verification step depended on a file Task 10 creates, breaking strict task-order execution. Also folded in: a larger `max_tokens` with explicit `max_tokens` stop handling, a documented schema fallback, the KV eventual-consistency limitation, and hiding the dead compare checkboxes.

## Questions answered (2026-08-16)

| ID | Question | Answer |
| --- | --- | --- |
| Q1 | A domain on Cloudflare for the Pages project? | **No.** Gate the project's `pages.dev` hostname (Task 6 Step 4). If a custom domain is ever added, it needs its own Access application or the tool becomes reachable unauthenticated through it — noted in Task 6. |
| Q2 | Refresh the `mazda5-gen3` KBB figure for 2012 specifically? | **No.** The generation-level figure stands. No task. |
| Q3 | Ruled-out vehicles: dimmed inline, or behind a toggle? | **Behind a toggle.** Task 10 hides them by default with a `Show N ruled out` control. |
