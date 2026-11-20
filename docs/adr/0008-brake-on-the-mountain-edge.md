# 8. The brake uses the mountain edge

- Status: accepted
- Date: 2026-11-19

## Context
The first brake always looked the same: skis made a wedge, and a board always swung to its heelside. The user asked that the rider track which edge is to the mountain, and that the brake use that edge. On a board, a toeside ride must brake toeside and a heelside ride must brake heelside.

## Decision
- The rider tracks its mountain edge (left or right) on every step on the snow:
  1. In a carve, it is the edge that the rider has set.
  2. With the ride flat, it is the uphill edge when the ride lies across the slope.
  3. With the ride flat and straight down the fall line, the last answer stays.
- A carve has priority over the slope, so that at the start of a turn the brake uses the new edge.
- The brake swings the ride across the slope and rolls it onto the mountain edge. The body leans back against that edge.
- On a board the edges are toeside and heelside. The stance sets which side is toeside (`toeEdge`).
- Skis do the same as a hockey stop. The wedge brake is removed.
- The brake still slows the rider by a fixed deceleration. Only the pose and the edge change.
- The HUD shows the name of the mountain edge.

## Consequences
- The brake matches what the rider did just before it.
- The tracked edge is rider state, so later steps can use it (snow spray on the correct side, edge tricks).
- Skis lose the snowplough look at low speed.
