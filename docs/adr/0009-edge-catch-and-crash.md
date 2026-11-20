# 9. Edge catch, crash and recovery

- Status: accepted
- Date: 2026-11-19

## Context
The user asked for edge catching when the rider does not change edges well, and for a crash to start the ragdoll. The ragdoll was planned for a later step (ADR 3). This brings it forward. The landing rule (ADR 4) will use the same crash.

## Decision
**Edge catch** (`Rider._watchForCatch`; numbers in `CONFIG.ski.rider` and `CONFIG.ski.rides`)
- An edge catches when it goes down into the snow on the side that the ride moves toward. Two mistakes cause it:
  1. The player sets the other edge during a brake. In a brake the ride skids with its mountain edge behind, so the other edge is in front.
  2. The player forces the ride from one edge straight to the other at speed. One such change is safe. Some in a row, or one at very high speed, are not. A moment with no steering between the edges prevents it.
- A catch load grows while a mistake continues and decreases after it. At the limit of the ride, the edge catches. The HUD shows a warning before the limit.
- Below a minimum speed an edge does not catch.
- During a brake the mountain edge does not change (this replaces one point of ADR 8: a carve no longer changes the edge of a brake that is in progress).
- An earlier version measured the real sideways speed of the ride. It gave false catches in normal turns on steep ground, because gravity always pulls the ride sideways there. The rule above looks only at what the player does.

**Crash**
- A catch starts a crash. The rider becomes a ragdoll in the Rapier physics world: eleven parts with joints, started in the pose and at the speed of the rider. The legs keep only part of the speed, so the body goes over the caught edge.
- The body model takes its pose from the ragdoll through `driveBones`, the same entry point that the pose solver uses.
- Skis and poles come off and move as separate bodies. A board stays on: it is a body with a joint to each ankle.
- The physics world holds only a square of the course ground around the body. The square moves with the body. It uses the same triangles as the heightfield.
- The run clock continues during a crash. When the body stops (or after a maximum time), the rider gets up at that place, at rest, with the ride on.
- If the physics library cannot load, the game reports the error and continues. A crash then stops the rider for a short time with no ragdoll.

## Consequences
- A crash costs time, not the run.
- The catch rule is deterministic and depends only on the controls, the speed and the tracked edge. It is easy to test and to tune.
- The ragdoll has no joint limits at the hips, shoulders and spine, and its parts do not collide with each other. It can fold in ways a body cannot.
- The game has a second library from the CDN (about 2.2 MB), loaded in the background.
