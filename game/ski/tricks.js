/*
 * TRICKS: what the rider did in one air time, as a name and style points. Pure functions of the landing
 * record that the rider gives (game/ski/rider.js), so they are easy to test and to tune.
 *
 * A spin counts in half turns (180, 360, 540 ...), a flip in whole turns, a grab once it was held long
 * enough. Doing more kinds of trick in one air time multiplies the points.
 */

const HALF_TURN = Math.PI;
const WHOLE_TURN = 2 * Math.PI;
const COUNT_WORDS = ['', '', 'DOUBLE ', 'TRIPLE ', 'QUAD '];

/** The grabs, and the direction control that picks each one while the grab control is held. */
export const GRABS = [
  { id: 'indy', name: 'INDY', direction: 'forward' },
  { id: 'mute', name: 'MUTE', direction: 'back' },
  { id: 'nose', name: 'NOSE GRAB', direction: 'left' },
  { id: 'tail', name: 'TAIL GRAB', direction: 'right' },
];

/** The id of the grab that the held directions pick, or null. `held` is { forward, back, left, right }. */
export function pickGrab(held) {
  return GRABS.find((grab) => held[grab.direction])?.id ?? null;
}

/**
 * Judge one air time.
 * @param landing { spin, flip (radians; a flip above zero is a back flip), grabs { id: seconds held }, switch }
 * @param config CONFIG.ski.tricks
 * @returns { name, points } or null when the rider did no trick
 */
export function scoreAir(landing, config) {
  const halfTurns = Math.round(Math.abs(landing.spin) / HALF_TURN);
  const flips = Math.round(Math.abs(landing.flip) / WHOLE_TURN);
  const grabs = GRABS.filter((grab) => (landing.grabs[grab.id] ?? 0) >= config.grabMinTime);
  const kinds = (halfTurns > 0 ? 1 : 0) + (flips > 0 ? 1 : 0) + (grabs.length > 0 ? 1 : 0);
  if (kinds === 0) return null;

  let points = halfTurns * config.pointsPerHalfSpin + flips * config.pointsPerFlip;
  for (const grab of grabs) points += config.pointsPerGrab + Math.min(config.grabMaxTime, landing.grabs[grab.id]) * config.pointsPerGrabSecond;
  points *= 1 + (kinds - 1) * config.comboBonus;
  if (landing.switch) points *= 1 + config.switchBonus;

  const words = [];
  if (flips > 0) words.push(`${COUNT_WORDS[flips] ?? `${flips}X `}${landing.flip > 0 ? 'BACKFLIP' : 'FRONTFLIP'}`);
  if (halfTurns > 0) words.push(`${halfTurns * 180}`);
  for (const grab of grabs) words.push(grab.name);
  if (landing.switch) words.push('TO SWITCH');
  return { name: words.join(' '), points: Math.round(points) };
}
