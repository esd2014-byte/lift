# Brief output contract

The morning routine writes **two files** per day into `logs/briefs/`:

| File | Purpose | Read by |
|---|---|---|
| `YYYY-MM-DD.md` | Coaching prose | The app's Coaching section |
| `YYYY-MM-DD.json` | Structured session + variants | The app's variant buttons and program table |

The app degrades gracefully: a day with only `.md` shows the coaching text and hides
the variant controls. Never skip the `.md` — it is the part a human reads.

## JSON shape

```json
{
  "date": "2026-09-25",
  "generated_at": "2026-09-25T11:07:00Z",
  "day": "F",
  "day_name": "Prehab, Core & Conditioning",
  "day_type": "short",
  "headline": "No Voltra today. Zero mount setup.",
  "voltra_mounts": [],
  "variants": {
    "full":    { "label": "Full",       "meta": "15-20 min · as programmed", "duration": "15-20 min", "note": null, "rows": [...] },
    "beast":   { "label": "Beast mode", "meta": "60 min · promote to Day A", "duration": "55-65 min",
                 "note": {"kind": "accent", "text": "..."}, "rows": [...] },
    "minimum": { "label": "Minimum",    "meta": "8 min · first superset",    "duration": "8 min",     "note": {...}, "rows": [...] },
    "travel":  { "label": "Traveling",  "meta": "hotel or no kit",           "duration": "12-15 min", "note": {...}, "rows": [...] }
  }
}
```

A row:

```json
{ "superset": "A", "name": "Voltra Lat Pulldown", "station": "Voltra @ pull-up bar",
  "reps": "4 × 10-15", "rpe": 8, "load_lb": 100,
  "note": "MAG neutral bar only" }
```

`superset` is `null` for a standalone exercise; rows sharing a letter are supersetted.
`note.kind` is `"accent"` (useful) or `"warn"` (a caution).

### `load_lb` — required on every Voltra row

The number, in pounds, that should be programmed on the device. It is **mandatory for
any Voltra exercise** because the daily Beyond+ session is generated from it: a missing
`load_lb` makes the app guess one (`lib/loadGuess.ts`): from the last time that lift
was done on the Voltra or logged in Hevy, else a related lift scaled by
`estimate_from` in `scripts/voltra_mapping.yaml`, else the note, else a light 30 lb.
The guess rounds down to 5 lb, and the row is shown as a **calibration** row: the
weight is a starting point to adjust after set 1, and the rep range and RPE are the
real target. A guess is a fallback, not a substitute: the brief should still set it.

Rules:
- Take it from `history/baseline.yaml` or the last logged set for that exercise.
- Voltra Weight Training accepts **5–230 lb**. Anything outside that is rejected.
- For a per-hand dumbbell lift, `load_lb` is **per hand**, matching how it's logged.
- If there is genuinely no basis for a number, omit the field and say so in the
  coaching text. Do not invent one — a wrong weight on the device is worse than a
  blank, because it looks deliberate.

Optional on non-Voltra rows, but include it wherever a number is known: the app
shows it in the session table, which saves looking it up mid-set.

### `hevy_routine` — which routine to open

Optional, per variant. The app shows a **Begin selected workout** control with a Hevy
button, and that button has to name the routine Eli should actually tap.

Usually it's the day's own routine (`"Day F — Prehab + Core + Conditioning (short)"`),
so it can be omitted. **Beast mode is the case that needs it** — promoting to Day E
means the Hevy routine is Day E's, not today's. Set it explicitly whenever the variant
sends him to a different day.

Use the exact routine title as it appears in Hevy. `scripts/sync_program_to_hevy.py`
writes them as `Day A — Push`, `Day F — Prehab + Core + Conditioning (short)`, etc.

## Variant rules

- **full** — the session as programmed. Always present.
- **beast** — *bigger* than full, and this needs judgement rather than a formula.
  On a **short day**, promote to the most overdue real day and keep the short day's
  non-negotiable work as a finisher. On a **real day**, add anchor volume and the
  accessory that usually gets dropped. Say plainly in `note` what was added and why,
  and cap the RPE if he's coming off a layoff or the lift is uncalibrated — "feeling
  great" after four days off is exactly when he'd hurt himself on an anchor.
- **minimum** — the one thing that matters today, 3 sets. Name why in `note`.
- **travel** — no home gym. Substitute against what a hotel gym plausibly has, or
  bodyweight and bands. Keep the movement pattern.

Omit a variant entirely rather than inventing a hollow one. The app renders whatever
is present, in the order full → beast → minimum → travel.
