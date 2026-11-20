# 2. Mountain mode: courses, heightfield ground and the rider controller

- Status: accepted
- Date: 2026-11-19

## Context
The game has only flat levels made of boxes. `Player` is an upright, kinematic first-person body. There is no sloped ground and no way for a game mode to move the player itself, to take the look input, or to place the camera. The mountain mode needs all of these.

## Decision
- A new game mode, `mountain` (`game/modes/mountain-mode.js`), delegates to the rules in `game/rules/ski-run.js`. All other mountain code is in `game/ski/`.
- `GameMode` gets three hooks, each with a default that keeps the old behaviour:
  - `stepsPlayer`: false when the mode moves the player itself. The game then does not step `Player` or the held item.
  - `look(dx, dy)`: the mode can take the look input.
  - `applyCamera(alpha, dt)`: the mode can place the camera.
- The ground of a course is a heightfield: a grid of heights with 1 m cells (`core/client/engine/heightfield.js`). A course definition fills the grid once from a slope profile, noise and features. The mesh and the rider read the same grid, so the rider is exactly on the drawn snow.
- The rider on the ground uses its own slope controller (`game/ski/rider.js`). It does not use `Player.update` and it is not a physics-engine body. The controller writes the position into `Player`, so the third-person body and the HUD keep one source for the position.
- The camera is a chase camera behind the rider (`game/ski/chase-camera.js`). The mouse or the right stick orbits it. It returns behind the rider while the rider moves.
- The mountain mode has two courses: Freeride and Park. A course is a data definition plus the shared builder (`game/ski/course.js`).
- The mode is solo. It needs no server change.

## Consequences
- The ride is stable and easy to tune, because it is not a physics-engine simulation.
- The box collision of `World` is not used on a course. Trees and rocks need their own collision in the rider controller.
- The static shadow map does not fit a 1400 m course. The sun's shadow box follows the rider in steps.
- Multiplayer for this mode needs new relay messages later.
