# 0006. A missing Voltra load is estimated from history and shown as calibration

**Status:** Accepted

## Context
The Beyond+ session needs a weight for every cable exercise. The brief is supposed to
give `load_lb`, but model-written briefs sometimes omit it. The first fallback scraped a
number from the coaching note, which was a guess dressed up as a plan.

## Decision
`web/lib/loadGuess.ts` estimates the load, best source first: the lift's own last set
(on the Voltra or in Hevy, whichever is newer), then a related lift scaled by a
conservative ratio from the data repo (`estimate_from`), then the note, then a light
30 lb. It carries the set to today's reps and RPE (Epley), aims at the top of the rep
range, and rounds down to 5 lb. The row is marked as a **calibration**: the Today card,
the Hevy note and the pushed session all say the weight is a starting guess to adjust
after set 1.

## Consequences
- The athlete always gets a reasoned number and is told it's a guess.
- Rounding down means the first set is sometimes too light. That costs a set; too heavy
  could cost an injury.
- `load_lb` in the brief stays the contract. A guess is a fallback, not a substitute.
