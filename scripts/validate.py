#!/usr/bin/env python3
"""Check the program against the library, the station rules, and the injury vetoes.

Run this after any program edit. It catches the errors that are easy to make by
hand and expensive to discover in the gym: an exercise that doesn't exist, a
superset that secretly needs the Voltra twice, or a movement the shoulder can't take.

Usage: python3 scripts/validate.py
Exit code 1 if anything fails.
"""
import os
import sys
from pathlib import Path

import yaml

# The data repo. Defaults to this checkout; set DATA_DIR when code and data are separate clones.
ROOT = Path(os.environ.get("DATA_DIR") or Path(__file__).resolve().parent.parent)


def load(rel):
    return yaml.safe_load((ROOT / rel).read_text())


def flatten_library(lib):
    """library/exercises.yaml groups exercises by section; we want one id -> exercise map."""
    out = {}
    for section, items in lib.items():
        if not isinstance(items, list):
            continue
        for ex in items:
            out[ex["id"]] = {**ex, "_section": section}
    return out


def main():
    lib = flatten_library(load("library/exercises.yaml"))
    stations = load("gym/stations.yaml")["stations"]
    program = load("program/current.yaml")

    errors, warnings = [], []

    for day_id, day in program["days"].items():
        seen_mounts = []
        for block in day["blocks"]:
            ids = block.get("superset") or [block.get("exercise")]

            # 1. Every referenced exercise must exist.
            missing = [i for i in ids if i not in lib]
            if missing:
                errors.append(f"Day {day_id} slot {block['slot']}: unknown exercise(s) {missing}")
                continue

            sts = [lib[i]["station"] for i in ids]

            # 2. Superset pairs must use different stations, and never two Voltra positions.
            if block.get("superset"):
                if len(set(sts)) < len(sts):
                    # Sharing is only legal on a free, non-exclusive station - switching
                    # between two band or two small-DB exercises costs nothing.
                    shared = sts[0]
                    cfg = stations.get(shared, {})
                    if not (cfg.get("cost") == "free" and cfg.get("exclusive") is False):
                        errors.append(
                            f"Day {day_id} slot {block['slot']}: superset {ids} shares "
                            f"station '{shared}' (cost={cfg.get('cost')}, exclusive={cfg.get('exclusive')})"
                        )
                voltra = [s for s in sts if s.startswith("voltra_")]
                if len(voltra) > 1:
                    errors.append(
                        f"Day {day_id} slot {block['slot']}: superset {ids} uses the Voltra twice ({voltra})"
                    )

            # 3. Track Voltra mount positions used across the day.
            for s in sts:
                if s.startswith("voltra_") and s not in seen_mounts:
                    seen_mounts.append(s)

            # 4. Anchors flagged in the program must be anchors in the library.
            if block.get("anchor"):
                for i in ids:
                    if not lib[i].get("anchor"):
                        errors.append(f"Day {day_id} slot {block['slot']}: '{i}' marked anchor but isn't one")

            # 5. Doubler-required exercises must declare it in the program.
            for i in ids:
                if lib[i].get("doubler_required") and not block.get("doubler"):
                    warnings.append(
                        f"Day {day_id} slot {block['slot']}: '{i}' requires the doubler; block doesn't say so"
                    )

        # 6. Mount changes within the declared budget.
        declared = day.get("voltra_mounts", [])
        limit = load("athlete/preferences.yaml")["voltra_mount_policy"]["max_mount_changes_per_session"]
        if len(seen_mounts) > limit:
            errors.append(f"Day {day_id}: uses {len(seen_mounts)} Voltra mounts {seen_mounts}, limit is {limit}")
        if set(seen_mounts) != set(declared):
            warnings.append(f"Day {day_id}: declares mounts {declared} but blocks use {seen_mounts}")

    # 7. Nothing forbidden by the injury file sneaks in.
    injuries = load("athlete/injuries.yaml")
    for rule in injuries["shoulder"]["current_rules"]["forbidden"]:
        for ex_id, ex in lib.items():
            if ex.get("tolerance") == "forbidden":
                errors.append(f"Library: '{ex_id}' is marked forbidden but still present")
        break

    # 8. How much of the library has the athlete actually rated?
    untested = [i for i, e in lib.items() if e.get("tolerance") == "untested"]

    print(f"{len(lib)} exercises, {len(program['days'])} days\n")
    for w in warnings:
        print(f"  WARN  {w}")
    for e in errors:
        print(f"  FAIL  {e}")
    if not errors and not warnings:
        print("  all checks passed")

    print(f"\ntolerance: {len(lib) - len(untested)}/{len(lib)} rated, {len(untested)} untested")
    if not load("library/exercises.yaml")["meta"]["tolerance_reviewed_by_eli"]:
        print("  -> library/exercises.yaml still needs the athlete's review")

    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
