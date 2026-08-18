#!/usr/bin/env python3
"""Generate shortlist/trait-evidence.js from docs/trait-picker-classification.md.

The classification doc is the reviewed source of truth for which bullet
supports which trait (and which bullets support none). This script turns its
per-vehicle tables into the static evidence module the Shortlist's trait
picker shows under each trait row, so the two can never be edited apart:
change the classification, rerun this, commit both.

Output shape:
  TRAIT_EVIDENCE: { <field_id>: [ { v: vehicle_id, text } ] }
  GENERAL_EVIDENCE: [ { v, text, polarity } ]   # bullets tied to no trait

Field-mapped entries carry no polarity: the picker marks those rows with the
vehicle's verdict against the trait, not the bullet's pro/con side. Only the
general list, which has no trait to be judged against, still needs it.

Evidence is keyed by *field* rather than picker-row id because several rows
share a field (both overnight_climate rows, both tow_class rows, ...): the
same supporting bullets apply to each.

Usage:
  python3 scripts/gen_trait_evidence.py           write the module
  python3 scripts/gen_trait_evidence.py --check   verify it is current (no writes)

`--check` is called by `sync_vehicles.py --check`, so the one command the house
rules already ask for covers this generated file too.
"""
import json
import re
import os
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DOC = os.path.join(REPO, "docs", "trait-picker-classification.md")
OUT = os.path.join(REPO, "shortlist", "trait-evidence.js")
VEHICLES = os.path.join(REPO, "vehicles.json")

# Field tokens the traits column may name, in the order the picker groups them.
# "ground_clearance_in" rows feed the clearance_class trait.
FIELD_TOKENS = {
    "overnight_climate": "overnight_climate",
    "sliding_doors": "sliding_doors",
    "stealth_profile": "stealth_profile",
    "camper_popularity_tier": "camper_popularity_tier",
    "sleeps_six_feet": "sleeps_six_feet",
    "tow_class": "tow_class",
    "clearance_class": "clearance_class",
    "ground_clearance_in": "clearance_class",
    "rear_seat_fold": "rear_seat_fold",
    "drivetrain_bucket": "drivetrain_bucket",
    "onboard_ac_power": "onboard_ac_power",
    "spare_tire": "spare_tire",
    "still_in_production": "still_in_production",
    "dc_fast_charging": "dc_fast_charging",
    "roof_rails": "roof_rails",
    "heated_front_seats": "heated_front_seats",
    "heated_steering_wheel": "heated_steering_wheel",
    "ventilated_front_seats": "ventilated_front_seats",
    "dual_zone_climate": "dual_zone_climate",
    "remote_start": "remote_start",
    "sunroof": "sunroof",
    "power_liftgate": "power_liftgate",
    "cargo_power_outlet": "cargo_power_outlet",
    "fold_flat_passenger": "fold_flat_passenger",
}

# Every field a picker row can gate on must be nameable in the classification
# doc, or a bullet mapped to it produces no evidence and nothing says so — the
# same silent-no-op the FIELD_IDS/FIELDS test exists to prevent, one layer over.
def check_token_coverage():
    traits = os.path.join(REPO, "shortlist", "traits.js")
    fields = set(re.findall(r"field:\s*'([a-z0-9_]+)'", open(traits, encoding="utf-8").read()))
    missing = sorted(fields - set(FIELD_TOKENS.values()))
    if missing:
        raise SystemExit(
            "these trait fields cannot be named in the classification doc; "
            f"add them to FIELD_TOKENS: {', '.join(missing)}"
        )

HEADING = re.compile(r"^### (\S+) \(")
ROW = re.compile(r"^\| (pro|con) \| (.*) \| (?:D|R|D\+R|E) \| (.*) \|$")
# Loose form, to catch a row the strict pattern silently skipped.
ROW_LOOSE = re.compile(r"^\| (?:pro|con) \|")


def build():
    """Parse the classification doc; return (module_text, stats)."""
    check_token_coverage()
    evidence = {}
    general = []
    vehicle = None
    rows = 0
    loose = 0
    with open(DOC, encoding="utf-8") as f:
        for line in f:
            line = line.rstrip("\n")
            m = HEADING.match(line)
            if m:
                vehicle = m.group(1)
                continue
            if ROW_LOOSE.match(line):
                loose += 1
            m = ROW.match(line)
            if not m or vehicle is None:
                continue
            rows += 1
            side, text, traits_cell = m.groups()
            text = text.replace("\\|", "|")
            fields = []
            for token, field in FIELD_TOKENS.items():
                if re.search(rf"\b{token}\b", traits_cell) and field not in fields:
                    fields.append(field)
            if fields:
                for field in fields:
                    evidence.setdefault(field, []).append({"v": vehicle, "text": text})
            else:
                # Includes both pure-editorial rows ("— (...)") and rows whose
                # only mapped fields are numeric spec restatements (mpg, price,
                # cargo volume...) with no picker row. Only the former belong in
                # the general list: a bullet that restates a table column is
                # already visible as that column.
                if traits_cell.startswith("—"):
                    general.append({"v": vehicle, "text": text, "polarity": side})
    # No hardcoded row count: assert the strict pattern matched every bullet row
    # the loose one saw, which is the regex-drift protection a literal was
    # standing in for.
    if rows != loose:
        raise SystemExit(f"parsed {rows} of {loose} bullet rows — ROW pattern is out of date")
    _check_against_dataset(evidence, general)

    body = (
        "// Generated by scripts/gen_trait_evidence.py from\n"
        "// docs/trait-picker-classification.md — do not edit by hand. Rerun the\n"
        "// script after changing camper_pros/camper_cons or the classification.\n"
        f"export const TRAIT_EVIDENCE = {json.dumps(evidence, indent=1, ensure_ascii=False)};\n\n"
        f"export const GENERAL_EVIDENCE = {json.dumps(general, indent=1, ensure_ascii=False)};\n"
    )
    mapped = sum(len(v) for v in evidence.values())
    return body, f"{mapped} field-mapped entries across {len(evidence)} fields, {len(general)} general"


def _check_against_dataset(evidence, general):
    """Every quoted bullet must still exist verbatim in vehicles.json.

    The bullet text is copied into this module, so a reworded pro/con would
    otherwise leave the picker quoting the old wording with nothing to notice.
    """
    with open(VEHICLES, encoding="utf-8") as f:
        data = json.load(f)
    bullets = {
        v["id"]: set(v.get("camper_pros", [])) | set(v.get("camper_cons", []))
        for v in data["vehicles"]
    }
    stale = []
    for entry in [e for rows in evidence.values() for e in rows] + general:
        if entry["text"] not in bullets.get(entry["v"], ()):
            stale.append(f'{entry["v"]}: {entry["text"][:60]}')
    if stale:
        raise SystemExit(
            "classification quotes bullets that are not in vehicles.json "
            f"(edit the doc and rerun this script):\n  " + "\n  ".join(stale[:10])
        )


def main():
    check = "--check" in sys.argv[1:]
    body, stats = build()
    if check:
        current = open(OUT, encoding="utf-8").read() if os.path.exists(OUT) else ""
        if current != body:
            raise SystemExit(
                f"{os.path.relpath(OUT, REPO)} is stale — "
                "run python3 scripts/gen_trait_evidence.py"
            )
        print(f"trait evidence is in sync with the classification doc ({stats}).")
        return
    with open(OUT, "w", encoding="utf-8") as f:
        f.write(body)
    print(f"wrote {os.path.relpath(OUT, REPO)}: {stats}")


if __name__ == "__main__":
    main()
