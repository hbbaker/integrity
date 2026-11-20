# 12. Pop, air tricks, landing and style points

- Status: accepted
- Date: 2026-11-19
- Applies: the controls part of ADR 4. The gravity load and the stomp of ADR 4 are not built yet.

## Context
The rider could only leave the snow at a lip or a cliff, and could do nothing in the air. ADR 4 gave the control scheme for tricks. This ADR records how the first part is built.

## Decision
**Pop**
- Hold the jump control (Space) to charge, release it to pop. The pop is along the ride's own up, so a lip throws the rider further. A release just after the ride leaves the snow still counts.

**In the air**
- A flick of the mouse or the look stick starts a turn: sideways for a spin, up or down for a flip (down, a pull back, is a back flip). Each flick adds turning speed. `core/client/engine/flick-detector.js` finds the flicks; it has no game words.
- The direction controls nudge the same turns: left and right for the spin, forward and back for a front flip and a back flip.
- The sprint control (Shift) held with a direction is a grab: forward Indy, back Mute, left Nose grab, right Tail grab. With the grab control held, the directions pick the grab and do not turn the ride.
- The game uses the existing jump and sprint actions, so the player can rebind them and no key has two actions. ADR 4 named a helper for key combinations (`chord-tracker.js`). It is not built, because a grab is one held control plus a direction and needs no timing.
- In the air the mouse does tricks and does not move the camera.
- The turns continue until the landing. The rider must time them.

**Landing**
- A landing holds when the ride is within `landFlipTolerance` of the right way up and within `landSpinTolerance` of the line it travels on, forward or backward. If not, the rider crashes (ADR 9).
- A backward landing is "switch". The ride then runs tail first. The steering still turns the path the same way, and the edge that the steering asks for is mirrored.

**Style points** (`game/ski/tricks.js`, numbers in `CONFIG.ski.tricks`)
- A spin counts in half turns, a flip in whole turns, a grab when it was held long enough (more points for a longer hold, to a limit).
- More kinds of trick in one air time multiply the points. A switch landing adds a share.
- A crash gives no points. The HUD shows the name and points of a landed trick, and the total of the run.

**Pose** (layer 3 of the pose solver, ADR 7)
- A pop charge sinks the body. A fast spin or flip, or a grab, pulls the ride up under the body. The chest and the head lead a spin. A grab takes one hand to a point of the ride; the trick table in the config holds the hand and the point for each grab and each ride.

## Consequences
- A new grab is one row in `GRABS` and one point per ride in the config.
- The landing check and the scoring are pure functions of one landing record, so tests cover them with fixed cases.
- Nothing stops a turn in the air except an opposite nudge. Clean landings need practice.
- Until the gravity load is built, the height of a drop does not make a landing harder.
