# 3. Physics: Rapier for rigid bodies, own spring chains for clothing

- Status: accepted
- Date: 2026-11-19

## Context
A crash must become a ragdoll. Skis and poles must come off and tumble. A board must stay on the feet. Clothing must move with the body. The repository has no physics code and no build step, and the client loads its only library (Three.js) from a CDN.

## Decision
- Use Rapier (`@dimforge/rapier3d-compat`) from the jsdelivr CDN through the import map, at a pinned version. The compat build has its WASM inside the script, so no second request is necessary.
- Rapier simulates only rigid bodies: the static course ground and props, the ragdoll, the skis and poles that come off, and the board that stays on the feet.
- `core/client/physics/rapier-world.js` is the only file that imports Rapier. The game uses this small interface, not the library.
- The rider that is not in a crash is not a Rapier body (see ADR 2).
- Clothing does not use Rapier. It uses small spring chains (`core/client/physics/spring-chain.js`): points that are tied to bones, with length constraints and collision against body capsules. Rapier has no cloth, and a chain of rigid bodies for each kit piece costs more than it gives.
- The package is also a dev dependency, so the headless tests can load it in Node.

## Consequences
- The ragdoll and the loose skis get correct collisions and joints for little code.
- The client has a second runtime dependency from the CDN (about 1.5 MB). The game needs internet access for it, as it does for Three.js.
- The spring chains are approximate. They look right at game speed but they are not a real cloth simulation.
- If Rapier is replaced later, only `rapier-world.js` changes.
