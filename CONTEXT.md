# Glossary

Use these terms exactly. Do not use synonyms.

| Term | Meaning | Avoid |
|------|---------|-------|
| Armor piece | One wearable item with an id, a slot, a name and a damage reduction value. | gear, equipment |
| Armor slot | A body place that holds one armor piece: head, arms, chest, legs or boots. | socket |
| Equipped | The armor piece that the player wears in an armor slot. | worn, on |
| Damage reduction | The fraction of incoming damage that the equipped armor pieces remove, capped by config. | resistance, defense |
| Suit | The mech suit that the player can enter. It has its own suit parts. | mech, exo |

## Relationships
- An armor slot holds zero or one armor piece.
- The player has one equipped armor piece per armor slot at most.
- The suit hides the equipped armor while the player is inside it.
