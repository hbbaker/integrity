# 10. Edge catch rules: a change that is too fast, and the wrong edge for the slope

- Status: accepted
- Date: 2026-11-19
- Supersedes: the "Edge catch" part of ADR 9. The "Crash" part of ADR 9 stays.

## Context
ADR 9 caught an edge only after several fast edge changes in a row. The user asked for two clear rules: a crash when the rider changes from one edge to the other too fast, and a crash when the slope is incorrect for the edge the rider is on. The user chose a medium strictness for the first rule and a short grace time for the second.

## Decision
Three mistakes catch an edge (`Rider._watchForCatch`). None counts below `catchMinSpeed`.
1. **A change that is too fast.** The player steers from one side straight to the other, with less than `edgeChangeTime` of neutral steering between, while the ride is still set on the first edge. The new edge catches at once.
   - The rule measures the steering input, not the roll of the ride. The roll takes the same time with or without a short pause, so it cannot show the difference.
   - Both keys held together are neutral steering, so a rolled key change with an overlap is safe.
2. **The wrong edge for the slope.** The ride is set on its downhill edge, and the snow tilts sideways under the ride by more than `wrongEdgeSlope`. After `wrongEdgeGrace` seconds the downhill edge catches. The time starts again when the rider leaves the wrong edge.
   - Each turn down the hill starts on the downhill edge, because steering sets the edge. The tilt limit and the grace time let a normal turn pass.
   - With the first values (tilt 0.3, grace 0.45 s), simulated linked turns that go up to about 55 degrees off the fall line do not catch on slopes up to 32 degrees. Turns that go 70 degrees or more across a slope of 26 degrees or more do catch at speed.
3. **The other edge during a brake** (from ADR 9, not changed). A load grows while the leading edge is down in a brake. At `catchLimit` it catches.
- The HUD warning shows the larger of the brake load and the wrong-edge time, as a share of their limits.
- The load for forced edge changes from ADR 9 (`forceSlip`) is removed. Rule 1 replaces it.

## Consequences
- Each rule is one clear mistake with one number to tune.
- Rule 1 depends on a key timing of about 0.08 to 0.1 s. A fast key change can be on either side of the limit.
- Rule 2 limits how far across a steep slope the rider can go at speed before a turn down the hill. Slow riders are not affected.
- The rules use only the controls, the speed, the tracked edge and the slope, so tests can check them step by step.
