# 7. Procedural animation: the pose solver

- Status: accepted
- Date: 2026-11-19

## Context
The rider needs many poses: stances, carve lean, grabs, spins, landings and a crash. The body model has no animation clips. The game already poses it in code each frame.

## Decision
- No authored clips. A pose solver (`game/ski/pose-solver.js`) computes the bone targets each frame from the rider state: velocity, edge angle, slope normal, compression, air rotation rates, the active trick, the landing phase and the gravity load.
- The solver has layers, applied in this order:
  1. Base stance for the ride (skis or board), with knee and hip bend from speed and tuck.
  2. Carve lean into the edge angle.
  3. Trick poses. The trick table holds each pose as parameters (hand target, tuck, twist), not as keyframes.
  4. Landing absorb: the knees and hips fold by the gravity load and the stomp quality.
  5. Secondary motion: damped springs on the spine, head and arms.
  6. Foot placement on the slope normal.
- Damped springs blend between poses. There are no transition clips.
- The body model gets one new entry point, `driveBones`, that sets bones directly. The solver and the ragdoll both use it.
- In a crash the solver gives the bones to the ragdoll through a short blend. The pose targets get weaker as the impact gets stronger.
- All pose numbers are in `CONFIG.ski.pose`. A pose lab in developer mode shows each pose without a run.

## Consequences
- A new trick needs a row in the trick table, not new animation code.
- Motion follows the physics, so it always matches what the rider does.
- The poses need tuning by eye. They will look less polished than motion capture.
- The solver is a pure function of the rider state, so tests can check its output for fixed states.
