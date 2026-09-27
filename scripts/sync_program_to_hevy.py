#!/usr/bin/env python3
"""Push program/current.yaml into Hevy as routines.

The repo is the source of truth for the program; Hevy is the logger. This is the
bridge. Re-run it whenever the program changes.

What it does:
  1. Archives existing routines by renaming them with a "zz [archived]" prefix.
     Renaming, not deleting - the logged history stays attached, and the Hevy API
     has no routine-delete endpoint anyway.
  2. Creates any custom exercise templates the program needs (the Voltra anchors).
  3. Creates one routine per program day, with supersets and coaching notes.

Usage:
    python3 scripts/sync_program_to_hevy.py --dry-run     # show the plan
    python3 scripts/sync_program_to_hevy.py               # apply
"""
import os
import argparse
import sys
from pathlib import Path

import yaml

sys.path.insert(0, str(Path(__file__).resolve().parent))
import hevy_api  # noqa: E402

# The data repo. Defaults to this checkout; set DATA_DIR when code and data are separate clones.
ROOT = Path(os.environ.get("DATA_DIR") or Path(__file__).resolve().parent.parent)
ARCHIVE_PREFIX = "zz [archived] "

WARMUP_NOTES = (
    "WARM-UP (do these, then start the first lift):\n"
    "- Cat / Cow x8\n"
    "- Band pull-apart x15\n"
    "- Band external rotation x15 each side\n"
    "- Two ramp-up sets on the first lift, well short of the working weight."
)


def load(rel):
    return yaml.safe_load((ROOT / rel).read_text())


def flatten_library(lib):
    out = {}
    for _, items in lib.items():
        if isinstance(items, list):
            for ex in items:
                out[ex["id"]] = ex
    return out


def resolve_templates(mapping, dry_run):
    """Return {exercise_id: template_id}, creating custom templates as needed."""
    templates = hevy_api._paginate(
        hevy_api.list_exercise_templates, "exercise_templates", max_pages=60
    )
    by_title = {t["title"]: t["id"] for t in templates}

    resolved, missing = {}, []
    for ex_id, title in mapping["stock"].items():
        if title in by_title:
            resolved[ex_id] = by_title[title]
        else:
            missing.append(f"{ex_id} -> '{title}' (not found in Hevy)")

    for ex_id, spec in mapping["custom"].items():
        if spec["title"] in by_title:
            resolved[ex_id] = by_title[spec["title"]]
            continue
        if dry_run:
            print(f"  would create custom template: {spec['title']}")
            resolved[ex_id] = f"<new:{spec['title']}>"
            continue
        hevy_api._request("POST", "/exercise_templates", body={"exercise": {
            "title": spec["title"],
            "exercise_type": "weight_reps",
            "muscle_group": spec["muscle_group"],
            "equipment_category": spec["equipment_category"],
        }})
        print(f"  created custom template: {spec['title']}")

    if missing:
        sys.exit("Unmapped exercises:\n  " + "\n  ".join(missing))

    if not dry_run and any(t not in by_title for t in
                           (s["title"] for s in mapping["custom"].values())):
        # Re-read so the newly created templates get their real ids.
        templates = hevy_api._paginate(
            hevy_api.list_exercise_templates, "exercise_templates", max_pages=60
        )
        by_title = {t["title"]: t["id"] for t in templates}
        for ex_id, spec in mapping["custom"].items():
            resolved[ex_id] = by_title[spec["title"]]

    return resolved


def archive_unused(dry_run, keep_titles):
    """Archive only routines the current program no longer contains.

    Routines whose titles the program still uses are UPDATED in place instead
    (see main). Archiving and recreating them would mint a fresh "zz [archived]"
    copy on every program change, and Hevy would fill up with near-duplicates.
    """
    routines = hevy_api._paginate(hevy_api.list_routines, "routines")
    for r in routines:
        title = r.get("title", "")
        if title.startswith(ARCHIVE_PREFIX) or title in keep_titles:
            continue
        if dry_run:
            print(f"  would archive: {title}")
            continue
        payload = {"routine": {
            "title": ARCHIVE_PREFIX + title,
            "notes": r.get("notes") or "Archived - superseded by the current program.",
            "exercises": strip_for_put(r.get("exercises", [])),
        }}
        hevy_api.update_routine(r["id"], payload)
        print(f"  archived: {title}")


def existing_by_title():
    return {r.get("title", ""): r["id"] for r in hevy_api._paginate(hevy_api.list_routines, "routines")}


def strip_for_put(exercises):
    """Hevy's GET returns fields its PUT rejects. Keep only what PUT accepts."""
    out = []
    for e in exercises:
        sets = []
        for s in e.get("sets", []):
            st = {"type": s.get("type", "normal"),
                  "weight_kg": s.get("weight_kg"),
                  "reps": s.get("reps")}
            if s.get("duration_seconds") is not None:
                st["duration_seconds"] = s["duration_seconds"]
            sets.append(st)
        out.append({
            "exercise_template_id": e["exercise_template_id"],
            "superset_id": e.get("superset_id"),
            "notes": e.get("notes") or "",
            "sets": sets or [{"type": "normal", "weight_kg": None, "reps": None}],
        })
    return out


def is_voltra(ex):
    return str(ex.get("station", "")).startswith("voltra_")


def build_routine(day_id, day, lib, tmpl, notes_map):
    """Turn one program day into a Hevy routine payload.

    Voltra exercises are deliberately EXCLUDED. They're logged on the device via
    Beyond+, which captures force, power and velocity per rep - far better data than
    anything typed by hand. Leaving them here as placeholder sets made every session
    look half-finished, and Hevy silently DROPS an exercise with an empty set list
    (tested 2026-09-26), so there's no "present but untickable" option either.

    The running order lives in the Lift app, which shows the whole session including
    Voltra. Hevy only carries what Eli actually ticks.
    """
    exercises = [{
        "exercise_template_id": tmpl["warmup"],
        "superset_id": None,
        "notes": WARMUP_NOTES,
        "sets": [{"type": "normal", "weight_kg": None, "reps": 8}],
    }]

    superset_counter = 0
    for block in day["blocks"]:
        ids = block.get("superset") or [block["exercise"]]
        # Drop Voltra work, then clear a superset that lost its partner - a lone
        # exercise carrying a superset id renders as a broken pair in Hevy.
        ids = [i for i in ids if not is_voltra(lib[i])]
        if not ids:
            continue
        ss_id = None
        if block.get("superset") and len(ids) > 1:
            ss_id = superset_counter
            superset_counter += 1

        for ex_id in ids:
            ex = lib[ex_id]
            reps = block.get("reps")
            note_parts = [f"RPE {block['rpe']}"]
            note_parts.append(f"[{ex['station']}]")
            if block.get("droppable"):
                note_parts.append("[DROP if short on time]")
            if notes_map.get(ex_id):
                note_parts.append(notes_map[ex_id])
            if block.get("doubler"):
                note_parts.append("DOUBLER ON for this exercise.")

            sets = []
            for _ in range(block["sets"]):
                s = {"type": "normal", "weight_kg": None,
                     "reps": reps[0] if reps else None}
                if block.get("time_sec"):
                    s = {"type": "normal", "weight_kg": None, "reps": None,
                         "duration_seconds": block["time_sec"]}
                sets.append(s)

            exercises.append({
                "exercise_template_id": tmpl[ex_id],
                "superset_id": ss_id,
                "notes": " — ".join(note_parts),
                "sets": sets,
            })

    kind = "real" if day["type"] == "real" else "SHORT"
    voltra_count = sum(
        1 for b in day["blocks"]
        for i in (b.get("superset") or [b["exercise"]])
        if is_voltra(lib[i])
    )
    note = f"Program v1 · {kind} day · {day['minutes'][0]}-{day['minutes'][1]} min"
    if voltra_count:
        note += (f" · {voltra_count} Voltra exercise(s) NOT listed here - they're in "
                 f"today's Beyond+ session. Full running order is in the Lift app.")
    return {"routine": {
        "title": f"Day {day_id} — {day['name']}",
        "notes": note,
        "exercises": exercises,
    }}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    program = load("program/current.yaml")
    lib = flatten_library(load("library/exercises.yaml"))
    mapping = load("scripts/hevy_mapping.yaml")

    print("Resolving exercise templates...")
    tmpl = resolve_templates(mapping, args.dry_run)

    payloads = {
        day_id: build_routine(day_id, day, lib, tmpl, mapping.get("notes", {}))
        for day_id, day in program["days"].items()
    }
    titles = {p["routine"]["title"] for p in payloads.values()}

    print("\nArchiving routines the program no longer uses...")
    archive_unused(args.dry_run, titles)

    print("\nWriting program routines...")
    existing = {} if args.dry_run else existing_by_title()
    for day_id, payload in payloads.items():
        title = payload["routine"]["title"]
        n_ex = len(payload["routine"]["exercises"])
        verb = "update" if (args.dry_run or title in existing) else "create"
        if args.dry_run:
            print(f"  would write: {title}  ({n_ex} exercises)")
            continue
        if title in existing:
            hevy_api.update_routine(existing[title], payload)
            print(f"  updated: {title}  ({n_ex} exercises)")
        else:
            hevy_api.create_routine(payload)
            print(f"  created: {title}  ({n_ex} exercises)")

    print("\nDone." if not args.dry_run else "\nDry run - nothing changed.")


if __name__ == "__main__":
    main()
