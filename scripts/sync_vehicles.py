#!/usr/bin/env python3
"""Sync the embedded vehicle data in the HTML files from vehicles.json.

vehicles.json is the single source of truth. Both index.html and
camper-vehicle-comparison.html embed a *render-trimmed* copy of that data
between the /*DATA-START*/ and /*DATA-END*/ markers. This script keeps them
in agreement.

The embedded copy differs from vehicles.json in three ways (research metadata
that the page never renders is dropped to keep the HTML small):
  - the top-level "$schema_note" key is omitted
  - each vehicle drops its "sources" and "notes" keys
  - each conversion_products entry keeps only "name" and "url" (drops "type")
  - each photos slot keeps only "url" and "note" (drops "source_page","license")

By default this script is APPEND-ONLY: any vehicle present in vehicles.json but
missing (by "id") from a page's embedded data is appended; existing embedded
entries are left byte-for-byte untouched, so the diff stays minimal. This is
the normal path when adding a new vehicle.

Pass --rebuild to regenerate every embedded entry from vehicles.json instead
(use when you have *edited* an existing vehicle's rendered fields). Rebuild may
reorder a few keys on first run, since the embedded blocks were hand-authored
with slightly different key order than vehicles.json.

Usage:
    python3 scripts/sync_vehicles.py [--rebuild] [--check]

  --check   exit non-zero if any file would change (no writes); for CI/pre-commit.

Run from the repository root.
"""
import json
import re
import sys
import os

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
JSON_PATH = os.path.join(REPO, "vehicles.json")
HTML_FILES = [
    os.path.join(REPO, "index.html"),
    os.path.join(REPO, "camper-vehicle-comparison.html"),
]
MARKER = re.compile(r"(/\*DATA-START\*/)(.*?)(/\*DATA-END\*/)", re.S)


def trim_vehicle(v):
    """Return the render-only subset of a vehicle record."""
    out = {}
    for k, val in v.items():
        if k in ("sources", "notes"):
            continue
        if k == "conversion_products":
            out[k] = [{"name": p["name"], "url": p["url"]} for p in val]
        elif k == "photos":
            slots = {}
            for slot, pv in val.items():
                if pv is None:
                    slots[slot] = None
                else:
                    d = {"url": pv["url"]}
                    if "note" in pv:
                        d["note"] = pv["note"]
                    slots[slot] = d
            out[k] = slots
        else:
            out[k] = val
    return out


def build_block(source, current_block, rebuild):
    """Return the new embedded-data string for one HTML file."""
    current = json.loads(current_block)
    if rebuild:
        vehicles = [trim_vehicle(v) for v in source["vehicles"]]
    else:
        # Append-only: keep existing entries exactly, add any missing by id.
        existing = current["vehicles"]
        have = {v["id"] for v in existing}
        vehicles = list(existing)
        for v in source["vehicles"]:
            if v["id"] not in have:
                vehicles.append(trim_vehicle(v))
    data = {"updated": source["updated"], "vehicles": vehicles}
    return json.dumps(data, indent=1, ensure_ascii=False)


def main():
    rebuild = "--rebuild" in sys.argv
    check = "--check" in sys.argv

    with open(JSON_PATH, encoding="utf-8") as f:
        source = json.load(f)

    changed = []
    for path in HTML_FILES:
        with open(path, encoding="utf-8") as f:
            html = f.read()
        m = MARKER.search(html)
        if not m:
            print(f"ERROR: markers not found in {path}", file=sys.stderr)
            return 2
        new_block = build_block(source, m.group(2), rebuild)
        if new_block == m.group(2):
            continue
        changed.append(os.path.basename(path))
        if not check:
            new_html = html[: m.start(2)] + new_block + html[m.end(2):]
            with open(path, "w", encoding="utf-8") as f:
                f.write(new_html)

    if check:
        if changed:
            print("Out of sync: " + ", ".join(changed))
            return 1
        print("HTML data is in sync with vehicles.json.")
        return 0

    if changed:
        print("Updated: " + ", ".join(changed))
    else:
        print("Already in sync; nothing to do.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
