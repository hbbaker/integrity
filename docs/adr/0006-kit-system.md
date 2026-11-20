# 6. Kit system: kit slots, catalogue, state and how the rider wears it

- Status: accepted
- Date: 2026-11-19

## Context
The rider needs a choice of skis, boards, poles, pants, jackets, helmets and goggles. The armor system (ADR 1) has a different purpose (damage reduction, network sync) and its slots do not match.

## Decision
- The kit is separate from armor. It has six kit slots: ride, poles, pants, jacket, helmet, goggles.
- The ride slot holds skis or a board. That choice also selects how the rider moves. Poles apply only with skis.
- A catalogue (`game/ski/kit/kit-parts.js`) lists the kit pieces. Each kit piece has an id, a kit slot, a name and a model builder. The models are procedural, as the suit parts are.
- `KitState` keeps the kit piece for each kit slot and saves it in localStorage (`oneshot.ski`). It checks the saved ids against the catalogue when it loads.
- `KitWearer` puts the kit pieces on the bones of the body: feet (ride), hands (poles), head (helmet, goggles), spine (jacket), hips and legs (pants).
- The kit screen shows the catalogue with a preview of the rider.
- Kit pieces have no stats in this version. They change the look only, except the ride.

## Consequences
- A new kit piece needs only a catalogue entry and a model builder.
- The armor system does not change. In the mountain mode the rider shows the kit, not the armor.
- Clothing that moves (ADR 3) attaches to kit pieces, so a kit piece can declare its spring chains.
- Multiplayer would need a short kit string in the state message, as armor has.
