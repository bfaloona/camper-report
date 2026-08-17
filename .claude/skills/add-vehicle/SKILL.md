---
name: add-vehicle
description: Research and add a vehicle to the camper comparison report. Use when asked to add a car/SUV/van/model (any year or trim) to vehicles.json / the comparison report, or to refresh an existing vehicle's data. Covers the research checklist, the record schema, and the exact edit-and-sync procedure for vehicles.json + both HTML files.
---

# Adding a vehicle to the camper comparison report

`vehicles.json` is the single source of truth. Both `index.html` and
`camper-vehicle-comparison.html` embed a render-trimmed copy of that data. You edit
the JSON, then run `scripts/sync_vehicles.py` to propagate to the HTML. Never
hand-edit the embedded `DATA` block. See `CLAUDE.md` for the data-flow overview.

Records here are deeply researched and every factual field is defensible from a URL.
Match that bar — do not invent numbers. When a figure can't be verified, say so in
the relevant `method`/`assumption`/`notes` field rather than guessing.

## Step 1 — Scope the record

One record = one **vehicle + generation + powertrain**. Before researching:

- Pick the **generation** (e.g. Santa Fe TM 2019–2023 vs MX5 2024+). Don't mix specs
  across generations. Confirm the chassis/generation code.
- Pick the **powertrain**: `gas`, `hybrid`, or `phev`.
- Pick the **`listed_year`**: `min(latest model year available, 2024)`, except models
  not sold in the US in/before 2024, which use their first US model year. If the user
  names a specific year, use it.
- Choose an **id**: kebab-case `make-model-generation`, e.g. `hyundai-tucson-hybrid-nx4`.
  Must be unique — check existing ids in `vehicles.json`.
- Check for an existing record of the same model/generation to avoid duplicates.
- Pick the **camping trim**: favor a trim with a fold-flat 60/40 (or better) second row
  and, where offered, a 115V/120V AC inverter outlet. Record *why* in `trim_rationale`.

## Step 2 — Research the fields (with a source URL for each)

Gather all of the following. KBB, fueleconomy.gov, and some manufacturer pages often
return 403 to direct fetch — cite search-surfaced figures and note the limitation.

- **Identity**: make, model, trim, class (`SUV`/`Minivan`/`Compact minivan`/`Compact
  van`/`Wagon`/`Hatchback`), powertrain, generation_span (e.g. "2019–2023 (4th gen, TM)").
- **Drivetrain**: `AWD`, `4WD`, `FWD`, or `RWD` for the listed trim (the page filters
  `AWD`/`4WD` vs `FWD`/`RWD`).
- **Tow rating**: max towing capacity in lbs (`0` if not rated for US towing) plus the
  manufacturer-published max tongue weight in lbs (`null` if none is published), with a
  note and source.
- **KBB used value**: `low` (trade-in/private-party floor) and `high` (private-party/
  retail ceiling) for the listed year in good condition, plus an `assumption` string and
  `source` URL.
- **Exterior** (in): length, width, height.
- **Cargo length behind front seats** (in), second row folded — almost always
  community/reviewer-measured, not an official spec. Capture the `method` (who measured,
  how, whether the floor is flat) and a `source`.
- **Max cargo volume** (cu ft), config string, source. Note any hybrid/PHEV battery penalty.
- **MPG**: EPA city/hwy. For PHEV also add `mpge` and `ev_range_mi`, and a `note` (EPA
  often lists combined-only for PHEVs). Note trim/drivetrain differences.
- **Safety**: ADAS suite name + standard feature list; IIHS/NHTSA ratings for the year.
- **Reliability**: RepairPal score (/5) + scale note, JD Power if available,
  `known_issues` (recalls with numbers/dates where possible), source.
- **Camper popularity**: `High`/`Medium`/`Low` with real `evidence` (forums, build
  communities, dedicated kit vendors).
- **Conversion products**: `{ name, url, type }` for kits/mattresses/platforms that fit
  this generation. Verify fitment years.
- **Photos**: for `exterior`, `dashboard`, `cargo` — prefer Wikimedia Commons
  (public-domain / CC). Provide the **direct `upload.wikimedia.org` URL**, the Commons
  `source_page`, the `license`, and a `note` if the shown trim/powertrain differs. Use
  `null` for any slot with no stable photo. **Verify each image loads and confirm its
  license on the Commons file page** — don't trust a guessed URL.
- **Ground clearance & tow rating** — fold into `camper_pros`/`camper_cons`/`notes`.
- **model_url**: official manufacturer page for the year if one exists.
- **camper_pros / camper_cons**: bullet strings written for the camping use case.

Doing the research as parallel sub-agents (one per vehicle) works well for batches, but
verify photo URLs/licenses yourself — sub-agent egress may block Commons.

## Step 3 — Write the record into `vehicles.json`

Append one object to the `vehicles` array with **every** field below (all existing
records are complete — match the full set). Field order to mirror existing records:

```json
{
  "id": "...", "make": "...", "model": "...", "trim": "...",
  "trim_rationale": "...",
  "class": "SUV", "powertrain": "hybrid", "drivetrain": "AWD",
  "generation_span": "...", "listed_year": 2023,
  "kbb_value_usd": { "low": 0, "high": 0, "assumption": "...", "source": "..." },
  "exterior_in": { "length": 0, "width": 0, "height": 0 },
  "cargo_length_behind_front_seats_in": { "value": 0, "method": "...", "source": "..." },
  "mpg": { "city": 0, "hwy": 0, "note": "..." },
  "safety": { "suite": "...", "features": ["..."] },
  "camper_popularity": { "rating": "Medium", "evidence": "..." },
  "conversion_products": [ { "name": "...", "url": "...", "type": "..." } ],
  "photos": {
    "exterior": { "url": "...", "source_page": "...", "license": "...", "note": "..." },
    "dashboard": null,
    "cargo": null
  },
  "sources": ["...every URL used..."],
  "notes": "caveats, what couldn't be verified, generation disambiguation",
  "last_verified": "YYYY-MM-DD",
  "model_url": "...",
  "max_cargo_cf": { "value": 0, "config": "...", "source": "..." },
  "tow_rating": { "max": 2000, "tongue": null, "note": "...", "source": "..." },
  "reliability": { "score": 4.0, "scale": "RepairPal /5 ...", "known_issues": "...", "source": "..." },
  "equipment": { "basis": "Standard on the listed trim. Optional or dealer-installed counts as false.", "...": "ten booleans + rear_seat_fold — copy the key set from any existing record" },
  "sitting_height_over_folded_seats_in": { "value": null, "method": "...", "source": null },
  "ground_clearance_in": { "value": 0, "source": "..." },
  "spare_tire": { "value": "compact", "source": "..." },
  "onboard_ac_power": { "value": "none", "basis": "Available on this generation from the factory, any trim or option.", "source": "..." },
  "still_in_production": { "value": true, "source": "..." },
  "dc_fast_charging": { "value": false, "note": "no charge port; not a plug-in", "source": null },
  "camper_pros": ["..."],
  "camper_cons": ["..."]
}
```

For a `phev`, add `"mpge"` and `"ev_range_mi"` inside `mpg`. `reliability` may also
carry an optional `"jd_power"` string. Also bump the top-level `"updated"` to today.

Researched-field conventions (the Shortlist's trait picker gates on these, so a
missing key silently reads as "no data" for that vehicle — `npm test` guards
that every record carries them):

- `ground_clearance_in.value`: manufacturer-published clearance for the listed
  trim, in inches.
- `spare_tire.value`: `"full-size"` / `"compact"` / `"none"` as shipped.
- `onboard_ac_power.value`: `"none"` / `"low_watt"` (household 120V outlet
  ≤ 400 W) / `"high_watt"` (≥ 1000 W). **Its basis differs from `equipment` on
  purpose**: available on this generation from the factory, any trim or option
  — restate that in the record's `basis` (decision Q2, 2026-08-17).
- `still_in_production.value`: this generation or a direct successor on sale
  new in the US.
- `dc_fast_charging.value`: only plug-ins can be `true`; gas/hybrid records are
  an honest `false` with the no-charge-port note instead of a source.
- Any of the `value`s may be `null` when honestly unanswerable — never guess,
  never invent a source.

Prefer editing the JSON programmatically to keep it valid — e.g. load it, append the
dict, and write back with `json.dumps(data, indent=2, ensure_ascii=False)` + a trailing
newline (this reproduces the file's exact formatting).

## Step 4 — Sync the HTML and verify

```bash
python3 scripts/sync_vehicles.py          # appends the new vehicle to both HTML files
python3 scripts/sync_vehicles.py --check  # confirms all three files agree
```

Then sanity-check:

- `python3 -c "import json; json.load(open('vehicles.json'))"` — JSON still valid.
- `git diff --stat` — `vehicles.json`, `index.html`, and `camper-vehicle-comparison.html`
  all changed; the two HTML diffs are identical in size.
- Open `index.html` in a browser (fully static) and confirm the new card renders with
  photos, specs, and the pros/cons and "why this trim" sections.

## Step 5 — Commit

Commit `vehicles.json` and both HTML files together with a clear message (e.g.
`Add 2023 Hyundai Tucson Hybrid`). Do not open a PR unless asked.
