# 1. Armor system: slots, catalogue, state and damage reduction

- Status: accepted
- Date: 2026-11-16

## Context
The character has a mech suit but no worn armor. A textured helmet asset exists and must be equippable. Other slots will get pieces later.

## Decision
- Armor has five slots: head, arms, chest, legs, boots (the body rig slots).
- Each armor piece has an id, slot, name, `armor` (damage reduction fraction) and a model.
- A catalogue (`game/armor/armor-parts.js`) lists the pieces. `ArmorState` keeps the equipped piece per slot and saves it in localStorage (`oneshot.armor`).
- The equipped pieces travel in the player state message as key `ar`, one digit per slot (0 = empty), decoded defensively.
- Total damage reduction is the sum of the equipped `armor` values, capped by `CONFIG.armor.maxReduction`. `core/` receives it as a plain multiplier on `Player`, because `core/` must not import `game/`.
- The mech suit hides armor and ignores its damage reduction while worn. Armor returns when the player leaves the suit.
- The armor is visible in third person, on the character preview and on remote players. First person never shows the head.

## Consequences
- A new piece needs only a catalogue entry and a model.
- Network messages grow by one short string.
- Bots do not wear armor yet.
