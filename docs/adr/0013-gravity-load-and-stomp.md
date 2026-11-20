# 13. Gravity load and the stomp, as built

- Status: accepted
- Date: 2026-11-20
- Applies and changes: the landing rule of ADR 4.

## Context
ADR 4 gave the landing rule: a gravity load grows in free fall, tricks give style, and a timed stomp removes load. This ADR records how it is built and where it differs from ADR 4.

## Decision
**Gravity load** (`Rider`, `air.load`)
- The gravity load is the greatest height of the rider above the snow during one air time, in metres.
- ADR 4 said the load grows with the downward speed. That is the metres fallen. A test on the course showed that this is wrong on a slope: a 2 m lip on steep ground gave 11 m, because the rider falls along the hill. The height above the snow gives 1 to 4 m for lips, about 5 m for cliff band A and about 9 m for cliff band B.

**Stomp**
- The stomp is a new press of the jump control (Space) in the air. Only the first press of an air time counts.
- It succeeds if it comes within the stomp window before the snow. The window is `stompWindow`, plus time for each style point of the air time, up to a limit.
- A successful stomp removes `stompAbsorb` metres of load, plus more for each style point, up to a limit.
- With no successful stomp, style removes nothing. This follows the sentence in ADR 4 ("style ... lets a stomp remove more gravity load") and not its formula, which also subtracted style without a stomp.
- A jump control that is held from the air does not charge a pop after the landing. The player must release it first.

**Judging** (`game/ski/landing.js`, numbers in `CONFIG.ski.landing`)
- Effective load = load minus what the stomp removes, plus an alignment penalty. The penalty grows with how much of the flip and spin tolerances the landing used. A stomp does not remove it.
- At `crashLimit` the rider crashes (ADR 9). From `sketchyShare` of the limit the landing is sketchy: the rider loses speed and half the style points of the trick. A successful stomp of a real drop is "stomped" and adds a share of style points.
- With the first numbers (limit 4.5 m, stomp 3 m, 0.004 m per style point): lips need nothing; cliff band A needs a stomp; cliff band B needs a stomp and about 500 style points, or it crashes.

**What the player sees**
- A gravity bar in the air shows the load as a share of the limit. It is red at the limit or above. Its border changes when the stomp is used.
- The landing banner shows STOMPED or SKETCHY with the trick.
- Pose layer 4 (ADR 7): the body folds by the share of the limit that was left, then stands up again.

## Consequences
- The rule is a pure function with one record as input. Tests cover it with a table of cases.
- A big drop cannot be survived by a stomp alone. The player must do tricks, as the user asked.
- The bar does not show when to stomp. The player learns the timing.
