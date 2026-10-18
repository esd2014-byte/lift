# 0007. The coach writes the full days; the app builds the rest by rule

**Status:** Accepted

## Context
The brief recommends one workout day, but the athlete sometimes knows better (a strong
pull day, a sore shoulder, a hotel gym) and needs every variant of whatever day he
picks. Three ways to get them: the morning routine writes every day; the app asks a
model live when he switches; or the app builds them by rule from the program.

## Decision
A mix, chosen by Eli (2026-10-18). The routine writes today's pick and an `alternates`
block for the other **full** days, with the same rules as today: injury cards,
history, ratings, real weights. The app builds the **short** days, and any day the
brief left out, by rule (`web/lib/programDay.ts`): As planned is the program; Beast
mode is +1 set on anchors plus a short day's opener; Quick is the first block; Traveling
is converted with the travel substitution map for the trip's hotel gym. Rule-built days
are labelled "from the program" and carry a warning that the coach's adjustments
aren't in them.

## Consequences
- Picking a full day still gets coaching; no model call or API key in the app, and
  switching is instant.
- The brief's JSON is roughly four times longer, and it's fixed at 5am.
- Rule-built days follow the Gym tab immediately (inactive exercises, missing
  stations); coach-written ones follow it from the next brief.
