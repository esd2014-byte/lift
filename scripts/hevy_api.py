#!/usr/bin/env python3
"""Minimal Hevy API helper.

Reads the API key from `.hevy_api_key` at the repo root (gitignored, chmod 600).
Ported from the retired "Personal Trainer" workspace folder, 2026-09-21.

Hevy API base: https://api.hevyapp.com/v1
Auth: `api-key` header

Usage (from the shell):
    python3 hevy_api.py routines
    python3 hevy_api.py workouts
    python3 hevy_api.py folders

Usage (importing):
    from hevy_api import list_routines, get_workouts, create_routine, ...
"""

import json
import sys
from pathlib import Path
from urllib import request, parse

BASE_URL = "https://api.hevyapp.com/v1"
SCRIPT_DIR = Path(__file__).resolve().parent
API_KEY_FILE = SCRIPT_DIR.parent / ".hevy_api_key"


def _api_key():
    if not API_KEY_FILE.exists():
        sys.exit(
            f"Missing API key file at {API_KEY_FILE}. "
            "See Hevy MCP setup.md (superseded section) or the project chat for setup."
        )
    return API_KEY_FILE.read_text().strip()


def _request(method, path, params=None, body=None):
    url = BASE_URL + path
    if params:
        url += "?" + parse.urlencode({k: v for k, v in params.items() if v is not None})
    headers = {
        "api-key": _api_key(),
        "Accept": "application/json",
    }
    data = None
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        headers["Content-Type"] = "application/json"
    req = request.Request(url, data=data, headers=headers, method=method)
    try:
        with request.urlopen(req) as resp:
            raw = resp.read().decode("utf-8")
            if not raw:
                return {}
            try:
                return json.loads(raw)
            except json.JSONDecodeError:
                # Some endpoints (POST /exercise_templates) return a bare id or a
                # non-JSON body on success. Don't turn a successful write into an error.
                return {"raw": raw, "status": resp.status}
    except request.HTTPError as e:
        body_text = e.read().decode("utf-8", errors="replace")
        raise RuntimeError("HTTP {} {}: {}".format(e.code, e.reason, body_text))


# --- Routines ---

def list_routines(page=1, page_size=10):
    return _request("GET", "/routines", params={"page": page, "pageSize": page_size})


def get_routine(routine_id):
    return _request("GET", "/routines/" + routine_id)


def create_routine(payload):
    return _request("POST", "/routines", body=payload)


def update_routine(routine_id, payload):
    return _request("PUT", "/routines/" + routine_id, body=payload)


# --- Workouts ---

def list_workouts(page=1, page_size=10):
    return _request("GET", "/workouts", params={"page": page, "pageSize": page_size})


def get_workout(workout_id):
    return _request("GET", "/workouts/" + workout_id)


def workout_count():
    return _request("GET", "/workouts/count")


# --- Exercise templates ---

def list_exercise_templates(page=1, page_size=100):
    return _request(
        "GET", "/exercise_templates", params={"page": page, "pageSize": page_size}
    )


def get_exercise_template(template_id):
    return _request("GET", "/exercise_templates/" + template_id)


# --- Routine folders ---

def list_routine_folders(page=1, page_size=10):
    return _request(
        "GET", "/routine_folders", params={"page": page, "pageSize": page_size}
    )


def create_routine_folder(title):
    return _request("POST", "/routine_folders", body={"routine_folder": {"title": title}})


# --- CLI entrypoint ---

def _print(obj):
    print(json.dumps(obj, indent=2, default=str))


def _paginate(fetch_fn, key, max_pages=20):
    """Walk pages of a list endpoint (page_size capped at 10 by Hevy) until empty."""
    items = []
    for page in range(1, max_pages + 1):
        result = fetch_fn(page=page, page_size=10)
        batch = result.get(key, [])
        items.extend(batch)
        # Hevy returns page_count; asking for page_count+1 is a hard 404, so stop on it.
        # (The old "stop when the batch is short" check missed the case where the last
        # page is exactly full - it then walked off the end and raised.)
        page_count = result.get("page_count")
        if page_count is not None and page >= page_count:
            break
        if len(batch) < 10:
            break
    return items


def snapshot(workout_pages=3):
    """Bundle routines, recent workouts, and folders into one structure for the assistant to read."""
    return {
        "routines": _paginate(list_routines, "routines"),
        "routine_folders": _paginate(list_routine_folders, "routine_folders"),
        "workouts": _paginate(list_workouts, "workouts", max_pages=workout_pages),
        "workout_count": workout_count(),
    }


DEFAULT_SNAPSHOT_PATH = SCRIPT_DIR / "Personal trainer" / "hevy_snapshot.json"


def save_snapshot(out_path=None, workout_pages=3):
    """Run snapshot() and write to disk. Returns the dict.

    Default path is `<parent>/Personal trainer/hevy_snapshot.json` — the project folder
    where the assistant reads from. Override with out_path if you want it somewhere else.
    """
    target = Path(out_path) if out_path else DEFAULT_SNAPSHOT_PATH
    target.parent.mkdir(parents=True, exist_ok=True)
    data = snapshot(workout_pages=workout_pages)
    target.write_text(json.dumps(data, indent=2, default=str))
    return data, target


def _main(argv):
    cmd = argv[1] if len(argv) > 1 else "routines"
    if cmd == "routines":
        _print(list_routines())
    elif cmd == "workouts":
        _print(list_workouts())
    elif cmd == "folders":
        _print(list_routine_folders())
    elif cmd == "count":
        _print(workout_count())
    elif cmd == "templates":
        _print(list_exercise_templates(page_size=10))
    elif cmd == "snapshot":
        _print(snapshot())
    elif cmd == "save-snapshot":
        out = argv[2] if len(argv) > 2 else None
        data, path = save_snapshot(out)
        wcount = data.get("workout_count", {}).get("workout_count", "?")
        rcount = len(data.get("routines", []))
        print("Snapshot saved to: {}".format(path))
        print("  {} routines, {} total workouts in account.".format(rcount, wcount))
    else:
        sys.exit(
            "Unknown command: {}. Use one of: routines, workouts, folders, count, templates, snapshot, save-snapshot".format(cmd)
        )


if __name__ == "__main__":
    _main(sys.argv)
