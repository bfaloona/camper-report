# Camper Vehicle Comparison

A single-page report comparing vehicles for camper / car-camping conversions. No
build step, no framework, no dependencies — just data plus one self-contained HTML page.

## Files

| File | Role |
| --- | --- |
| `vehicles.json` | **Source of truth.** One record per vehicle-generation, deeply researched with sources. |
| `index.html` | The report. Embeds a render-trimmed copy of the data and renders it with vanilla JS. |
| `camper-vehicle-comparison.html` | **Byte-for-byte identical to `index.html`.** Keep them in sync. |
| `scripts/sync_vehicles.py` | Propagates `vehicles.json` into the embedded data in both HTML files. |
| `.claude/skills/add-vehicle/` | Skill: how to research and add a new vehicle record. |

There is no bundler or generator: `index.html` ships the data inline. The two HTML
files must stay identical — every change to one must be mirrored in the other (the
sync script does this for the data block).

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
- `camper_pros` / `camper_cons`: bullet strings written for the camping use case.
- `sources`: every URL used. `last_verified`: ISO date of the research pass.

To add a vehicle, use the **add-vehicle** skill (`.claude/skills/add-vehicle/SKILL.md`),
which carries the full field checklist and the exact edit-and-sync procedure.

## House rules

- `vehicles.json` is authoritative; the HTML data block is derived. Edit the JSON, sync the HTML.
- Keep `index.html` and `camper-vehicle-comparison.html` identical.
- Bump the top-level `updated` and each record's `last_verified` when you change data.
- Every factual field should be defensible from a URL in that record's `sources`.
- Verify locally by running `python3 scripts/sync_vehicles.py --check` and opening
  `index.html` in a browser (it is fully static — no server needed).
- Pinned vehicles (`localStorage` key `camper-report:pins`, defaults in the `/*PURE-START*/`
  block) are always rendered regardless of filters; sorting is unaffected. The pure helpers
  in that block are unit-tested by `node --test scripts/pins.test.mjs` — keep them free of
  DOM access.
