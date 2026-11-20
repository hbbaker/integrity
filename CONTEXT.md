# Glossary

Use these terms exactly. Do not use synonyms.

| Term | Meaning | Avoid |
|------|---------|-------|
| Armor piece | One wearable item with an id, a slot, a name and a damage reduction value. | gear, equipment |
| Armor slot | A body place that holds one armor piece: head, arms, chest, legs or boots. | socket |
| Equipped | The armor piece that the player wears in an armor slot. | worn, on |
| Damage reduction | The fraction of incoming damage that the equipped armor pieces remove, capped by config. | resistance, defense |
| Suit | The mech suit that the player can enter. It has its own suit parts. | mech, exo |
| Mountain mode | The game mode where the player rides down a course on skis or on a board. | ski mode, snow mode |
| Course | One mountain layout that a run uses: Freeride or Park. | map, track |
| Run | One descent of a course, from the start gate to the finish or to a reset. | lap, attempt |
| Rider | The player while in the mountain mode. | skier, boarder |
| Ride | The thing that the rider stands on: skis or a board. | vehicle, mount |
| Mountain edge | The edge of the ride that the rider is on: the edge set in a carve, or the uphill edge when the ride is flat across the slope. A brake uses it. | uphill edge, active edge |
| Toeside, heelside | The two edges of a board: the edge under the toes and the edge under the heels. | frontside, backside |
| Edge catch | The leading edge of the ride goes into the snow while the ride moves toward it. It causes a crash. | catch an edge (as a noun), trip |
| Catch load | A value that grows while the leading edge is down during a brake. At its limit the edge catches. | catch meter |
| Wrong edge | The downhill edge, when the ride is set on it while the ride lies across a steep slope. After a grace time it catches. | bad edge |
| Edge hold | The time that the ride has been set on its current edge. A long hold earns a longer grace time for the next edge. | commitment, charge |
| Pop | A jump off the snow from a charge of the jump control. | ollie, hop |
| Switch | Riding backward, tail first, after a backward landing. | fakie |
| Trick | A named move in the air or on a surface: a spin, flip, grab, grind or butter. | stunt |
| Style | The points that tricks give during one air time. | combo points |
| Gravity load | The greatest height of the rider above the snow in one air time, in metres. Too much at the landing causes a crash. | fall damage, impact |
| Stomp | A press of the jump control in the air, shortly before the landing, that removes gravity load. Style makes it stronger. | brace, absorb |
| Crash | A failed landing, an edge catch or a hard collision. It starts the ragdoll. The rider gets up where the body stops. | bail, wipeout |
| Kit piece | One item of ski clothing or hardware with an id, a kit slot and a name. | gear, equipment |
| Kit slot | A place that holds one kit piece: ride, poles, pants, jacket, helmet or goggles. | socket |
| Pose solver | The code that computes the body pose of the rider each frame from the rider state. | animator, animation clip |
| Snow depth | The distance that the snow surface is pressed down at a point by a ride or a body. | deformation map |

## Relationships
- An armor slot holds zero or one armor piece.
- The player has one equipped armor piece per armor slot at most.
- The suit hides the equipped armor while the player is inside it.
- A run uses one course and one ride.
- The rider has one kit piece per kit slot at most. Poles apply only with skis.
- Tricks give style. Style and a stomp reduce the gravity load at the landing.
- A gravity load above the crash limit at the landing causes a crash.
- In a crash, skis and poles come off the rider. A board stays on.
- An edge catch causes a crash. Three mistakes cause an edge catch: an edge change that is too fast, the wrong edge for the slope, and the other edge set during a brake.
