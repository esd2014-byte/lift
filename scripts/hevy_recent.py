#!/usr/bin/env python3
"""Show recent Hevy sessions with top sets, for calibrating prescriptions.

The API is reachable directly from the assistant's environment (this was NOT true
when the old workflow was written - it assumed Eli had to run snapshots himself and
paste the output). That removes the manual snapshot step entirely.

Usage: python3 scripts/hevy_recent.py [since YYYY-MM-DD]
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import hevy_api  # noqa: E402

KG_TO_LB = 2.20462


def main():
    since = sys.argv[1] if len(sys.argv) > 1 else "2026-06-01"
    workouts = hevy_api._paginate(hevy_api.list_workouts, "workouts")
    recent = sorted(
        (w for w in workouts if w.get("start_time", "") >= since),
        key=lambda w: w["start_time"],
    )
    print(f"{len(recent)} sessions since {since}\n")
    for w in recent:
        print(f"=== {w['start_time'][:10]}  {w['title']}")
        if w.get("description"):
            print(f"    note: {w['description'][:200]}")
        for ex in w.get("exercises", []):
            sets = [s for s in ex.get("sets", []) if s.get("reps")]
            if not sets:
                continue
            top = max(sets, key=lambda s: (s.get("weight_kg") or 0, s.get("reps") or 0))
            kg = top.get("weight_kg")
            load = f"{kg * KG_TO_LB:.0f} lb" if kg else "BW"
            print(f"    {ex['title'][:34]:36s} {len(sets)} sets, top {load} x {top['reps']}")
        print()


if __name__ == "__main__":
    main()
