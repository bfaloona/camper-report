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

index.html also owns three other marked blocks that a separate page (the
Shortlist tool, under shortlist/) reuses: /*STYLE-*/ wraps the report's CSS,
/*RENDER-*/ wraps its card/table render functions, and /*DETAIL-*/ wraps the
per-vehicle detail overlay (markup, renderer and close wiring). index.html can't
export these as ES modules without breaking file:// use, so --shared copies
the marked text verbatim into shortlist/index.html instead.

Usage:
    python3 scripts/sync_vehicles.py [--rebuild] [--check]
    python3 scripts/sync_vehicles.py --shared
    python3 scripts/sync_vehicles.py --check-shared

  --check         exit non-zero if any file would change (no writes); for CI/pre-commit.
                   Also checks the shared blocks against shortlist/index.html when that
                   file exists (skipped, not failed, when it doesn't).
  --shared        copy the /*STYLE-*/, /*RENDER-*/ and /*DETAIL-*/ blocks from index.html into
                   shortlist/index.html.
  --check-shared  exit non-zero if shortlist/index.html's shared blocks are out of sync
                   (no writes). Exits 0 if shortlist/index.html doesn't exist yet.

Run from the repository root.
"""
import filecmp
import json
import re
import subprocess
import sys
import os
from pathlib import Path

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
JSON_PATH = os.path.join(REPO, "vehicles.json")
HTML_FILES = [
    os.path.join(REPO, "index.html"),
    os.path.join(REPO, "camper-vehicle-comparison.html"),
]
MARKER = re.compile(r"(/\*DATA-START\*/)(.*?)(/\*DATA-END\*/)", re.S)

ROOT = Path(REPO)
SHARED_BLOCKS = ("STYLE", "RENDER", "DETAIL")
SHORTLIST = ROOT / "shortlist" / "index.html"


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


def check_trait_evidence():
    """0 if shortlist/trait-evidence.js is current, 1 if stale or unbuildable.

    Delegates to the generator's own --check so the parsing rules live in one
    place. A missing script is not a failure: the report half of this repo
    works without the Shortlist.
    """
    script = os.path.join(os.path.dirname(os.path.abspath(__file__)), "gen_trait_evidence.py")
    if not os.path.exists(script):
        return 0
    result = subprocess.run([sys.executable, script, "--check"], capture_output=True, text=True)
    if result.returncode != 0:
        print((result.stdout + result.stderr).strip())
        return 1
    return 0


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
    if not SHORTLIST.exists():
        # Task 10 creates shortlist/index.html; before that, there's nothing
        # to sync or check yet.
        return 0
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


def main():
    rebuild = "--rebuild" in sys.argv
    check = "--check" in sys.argv
    shared = "--shared" in sys.argv
    check_shared = "--check-shared" in sys.argv

    if shared:
        return sync_shared(check=False)
    if check_shared:
        return sync_shared(check=True)

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
        ok = True
        if changed:
            print("Out of sync: " + ", ".join(changed))
            ok = False
        # The DATA block check above only compares each file's data block to
        # vehicles.json independently, so it can't catch the two HTML files
        # drifting from *each other* (e.g. hand-mirrored CSS/JS). Check that
        # directly — this is the only thing enforcing "keep them identical".
        if len(HTML_FILES) == 2 and not filecmp.cmp(HTML_FILES[0], HTML_FILES[1], shallow=False):
            a, b = (os.path.basename(p) for p in HTML_FILES)
            print(f"{a} and {b} are not byte-for-byte identical. Fix: cp {a} {b}")
            ok = False
        # Also check the shared STYLE/RENDER/DETAIL blocks against shortlist/index.html,
        # so one --check command still verifies everything. sync_shared() is a
        # no-op (exit 0) when that file doesn't exist yet.
        if sync_shared(check=True) != 0:
            ok = False
        # And the trait-evidence module, generated from the classification doc.
        # Same reason: one --check command should catch every stale derived file.
        if check_trait_evidence() != 0:
            ok = False
        if ok:
            print("HTML data is in sync with vehicles.json.")
            return 0
        return 1

    if changed:
        print("Updated: " + ", ".join(changed))
    else:
        print("Already in sync; nothing to do.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
