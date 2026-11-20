# 5. Snow depth: the ground that skis, boards and bodies press down

- Status: accepted
- Date: 2026-11-19

## Context
The snow must show where a ride carved and where a body hit. The course is about 240 m by 1400 m, so the method must be cheap per frame.

## Decision
- The heightfield of a course (ADR 2) holds a snow depth for each grid point, next to the base height. The surface height is the base height minus the snow depth.
- `stamp(x, z, radius, depth)` presses the snow down around a point with a soft edge. A ride stamps on each step. A landing and each ragdoll impact stamp a crater.
- The terrain mesh (`core/client/graphics/deformable-terrain.js`) is made of chunks. After a stamp, only the chunks that the stamp touches get new vertex positions and normals.
- Thin ski and board lines are narrower than a grid cell. Trail ribbons on the surface draw them. The grid shows the wider troughs and craters.
- Snow spray uses the existing `ParticlePool`.
- The snow depth changes what the player sees and lowers the rider by the depth. The Rapier ground collider keeps the base heights.

## Consequences
- The cost of a stamp is a few grid points and one or two chunk updates.
- Tracks stay for the whole run. A new run resets the snow depth.
- Fine detail is limited to the 1 m grid plus the ribbons. A finer grid costs more memory and more vertices.
- Loose skis and the ragdoll collide with the base ground, so they can sit a little above a deep crater.
