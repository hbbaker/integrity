# 14. Snow marks, as built

- Status: accepted
- Date: 2026-11-20
- Applies and changes: the snow depth of ADR 5.

## Context
ADR 5 gave the method: a snow depth for each grid point, `stamp`, chunk redraws, trail ribbons and spray from the particle pool. This ADR records how it is built and where it differs from ADR 5.

## Decision
**Snow depth** (`Heightfield`)
- `stamp(x, z, radius, depth)` presses the grid points around a point, with a soft edge. A point keeps its greatest depth: many stamps in one place do not dig a hole.
- `heights` is the pressed surface. `baseHeightOf` gives the base ground. `liftPressed` brings the base ground back exactly.

**The snow goes down behind the rider, not under it**
- ADR 5 said that a ride stamps on each step and that the rider goes down by the snow depth. A stamp under the rider tilts the triangle that the rider stands on. The edge rules (ADR 10) read that tilt, so a fresh track can cause a false edge catch.
- The trough of a track and the dent of a landing now wait. They go down when the rider is `clearance` metres past their radius. The ride and the track ribbon cover the place until then.
- The rider still rides down into old tracks, dents and craters.
- When the rider crashes, all waiting snow goes down at once.

**Marks** (`game/ski/snow-tracks.js`)
- Track: one ribbon for each ski, one for a board. The ribbon is narrow on an edge and wide in a brake. A board's ribbon moves toward the edge in use. A ribbon holds a fixed number of pieces; the oldest go first.
- Trough: along the track, deeper in a hard carve or a brake.
- Dent: at a landing, deeper for a greater share of the crash limit.
- Crater: the pelvis and the chest of the fallen body press the snow where they touch it. A fast hit is deep. A slide gives a shallow trench.
- Spray: from the edge in a carve (to the outside of the turn) and in a brake (ahead). A puff at a landing and at a body hit.
- A new run (start again, or a jump to a marker) gives fresh snow.

## Consequences
- The rider's physics on fresh snow is the same as before this ADR.
- The physics ground keeps the base heights (ADR 5), so a body lies up to the crater depth above the snow that the player sees.
- The 1 m grid shows a trough as a soft change of light. The ribbons carry the fine lines.
- Without a particle pool there is no spray. The tests run that way.
