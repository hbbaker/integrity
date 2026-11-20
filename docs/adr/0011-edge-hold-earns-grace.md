# 11. A held edge earns grace for the next edge

- Status: accepted
- Date: 2026-11-19
- Changes: the grace time of rule 2 in ADR 10. The rest of ADR 10 stays.

## Context
With a fixed grace time, the wrong-edge rule (ADR 10, rule 2) treated all turns the same. The user asked that a hold of the old edge for a certain time extends the grace period. Smooth, technical edge changes must be rewarded, and a player must fail until the player learns the mechanic.

## Decision
- The rider measures how long the ride is set on its current edge (the edge hold), up to `edgeHoldFull`.
- When the ride takes the other edge, the hold of the old edge sets the grace time of the new edge:
  - below `edgeHoldMin`: the base grace only (`wrongEdgeGrace`, now 0.25 s);
  - at `edgeHoldFull`: the base grace plus all of `wrongEdgeBonus` (0.6 s);
  - between them: a share of the bonus.
- Time with the ride flat between the edges decreases the hold. A change must be prompt as well as prepared. (Rule 1 of ADR 10 still needs a short neutral moment, so the correct change is: hold, a short neutral moment, the new edge.)
- The base grace is shorter than before (0.25 s, was 0.45 s). A turn down the hill from far across a steep slope fails with the base grace and passes with a full hold.
- The HUD shows the edge name in green when the hold has earned the full bonus. The game does not explain the rule.

## Consequences
- A committed carve followed by a prompt change is rewarded with room for a wide turn. A rushed or hesitant change is not.
- In simulation (skis, 26 degree slope): a turn from about 70 degrees off the fall line passes after a full hold and catches with no hold or after a long flat pause. Linked full turns pass, because each turn holds its edge.
- A new player crashes on steep ground until the player learns to hold the edge. On slopes below about 17 degrees the wrong-edge rule does not apply, so the start of the course is safe.
- The mechanic has three numbers to tune: `edgeHoldMin`, `edgeHoldFull` and `wrongEdgeBonus`.
