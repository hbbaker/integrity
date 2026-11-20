# 4. Tricks, style, gravity load and the stomp

- Status: accepted
- Date: 2026-11-19

## Context
The mountain mode needs a control scheme for tricks that works on a keyboard with a mouse and on a pad. It also needs a landing rule: a high fall must be dangerous, and good tricks must make the landing easier.

## Decision
**Controls** (all are actions in `game/ui/actions.js`, so the player can rebind them)
- On the ground: left and right carve, forward tucks, back brakes, crouch does a butter or press. Hold and release Space to pop.
- In the air: a flick of the mouse or the right stick starts a spin (sideways flick) or a flip (up or down flick). The move keys nudge the same rotations.
- Hold Grab and press a direction to pick the grab. A spin, a flip and a grab in one air time make a named combination.
- The stomp is also on Space. The rider state selects the meaning: pop on the ground, stomp in the air. A stomp needs a new press. A Space press that is still held from the pop does not count.
- The core gets two input helpers with no game words in them: `flick-detector.js` and `chord-tracker.js`.

**Landing rule** (all numbers are in `CONFIG.ski`)
- The gravity load starts at 0 at take-off. In the air it grows with the downward speed: `gravityLoad += fallSpeed * dt * loadRate`.
- Tricks give style. Style makes the stomp window wider and lets a stomp remove more gravity load.
- At the landing: `effectiveLoad = gravityLoad - style * styleAbsorb - stompBonus + alignmentPenalty`. The alignment penalty comes from the angle between the rider and the slope, and from a rotation that is not complete.
- An effective load above the crash limit causes a crash. Lower values give a landing rating.
- A stomp that is pressed too early locks out for a short time. One press, not many.

## Consequences
- One key for pop and stomp keeps the hand position simple. The air state must be reliable, or a stomp can become a pop.
- The landing rule is a pure function. It is easy to test with a table of cases.
- The flick input shares the mouse with the camera. In the air the mouse does tricks and does not orbit the camera.
