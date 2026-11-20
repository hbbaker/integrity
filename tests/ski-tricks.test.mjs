/*
 * Tricks: the flick that starts a spin or a flip, and the name and style points of what the rider did in the air.
 */
import { load, loadConfig } from './support/modules.mjs';

const { FlickDetector } = await load('flick-detector');
const { GRABS, pickGrab, scoreAir } = await load('ski-tricks');

let fails = 0;
const check = (ok, msg) => { console.log(`${ok ? 'ok  ' : 'FAIL'}: ${msg}`); if (!ok) fails++; };
const CONFIG = await loadConfig();
const config = CONFIG.ski.tricks;
const STEP = CONFIG.fixedStep;
const TURN = 2 * Math.PI;

// --- the flick detector ---
const make = () => new FlickDetector(config.flick);
/** Move the mouse `dx`, `dy` in each of `steps` steps; returns the flicks that came out. */
const move = (detector, dx, dy, steps) => { const flicks = []; for (let i = 0; i < steps; i++) { detector.add(dx, dy); const flick = detector.update(STEP); if (flick) flicks.push(flick); } return flicks; };

const quick = move(make(), 40, 5, 4);
check(quick.length === 1 && quick[0].x === 1 && quick[0].y === 0, 'should report one flick to the right when the mouse moves quickly to the right');
check(move(make(), -40, 5, 4)[0].x === -1, 'should report a flick to the left');
const up = move(make(), 6, -50, 4)[0];
check(up.x === 0 && up.y === -1 && move(make(), 6, 50, 4)[0].y === 1, 'should report a flick up or down when that is the stronger direction');
check(move(make(), 1.5, 0, 120).length === 0, 'should not take slow movement for a flick, however long it lasts');
const soft = move(make(), config.flick.threshold + 5, 0, 1)[0];
const hard = move(make(), config.flick.full * 2, 0, 1)[0];
check(soft.strength > 0 && soft.strength < 0.2 && hard.strength === 1, 'should give a stronger flick for more movement, up to 1');
const resting = make();
move(resting, 80, 0, 1);
check(move(resting, 80, 0, 3).length === 0, 'should rest after a flick, so one hand movement is one flick');
check(move(resting, 80, 0, Math.ceil(config.flick.cooldown / STEP) + 2).length === 1, 'should report the next flick after the rest');
const forgotten = make();
forgotten.add(config.flick.threshold - 1, 0);
forgotten.reset();
forgotten.add(config.flick.threshold - 1, 0);
check(forgotten.update(STEP) === null, 'should forget the movement so far when it is reset');

// --- picking a grab ---
const NONE = { forward: false, back: false, left: false, right: false };
check(pickGrab(NONE) === null, 'should pick no grab when no direction is held');
check(GRABS.every((grab) => pickGrab({ ...NONE, [grab.direction]: true }) === grab.id) && new Set(GRABS.map((grab) => grab.direction)).size === GRABS.length, 'should pick a different grab for each direction');

// --- naming and scoring ---
const air = (overrides) => ({ spin: 0, flip: 0, grabs: {}, switch: false, ...overrides });
check(scoreAir(air({}), config) === null, 'should give nothing for a plain jump');
check(scoreAir(air({ spin: 0.6 }), config) === null, 'should give nothing for a spin of less than a quarter turn');
const spin360 = scoreAir(air({ spin: -TURN * 0.98 }), config);
check(spin360.name === '360' && spin360.points === 2 * config.pointsPerHalfSpin, 'should name a full spin 360, to either side, and give points for each half turn');
check(scoreAir(air({ spin: Math.PI * 1.1 }), config).name === '180' && scoreAir(air({ spin: 3 * Math.PI }), config).name === '540', 'should count a spin in half turns');
const back = scoreAir(air({ flip: TURN }), config);
const front = scoreAir(air({ flip: -TURN * 2.02 }), config);
check(back.name === 'BACKFLIP' && back.points === config.pointsPerFlip, 'should name a turn backward a backflip');
check(front.name === 'DOUBLE FRONTFLIP' && front.points === 2 * config.pointsPerFlip, 'should name two turns forward a double frontflip');
const shortGrab = scoreAir(air({ grabs: { indy: config.grabMinTime / 2 } }), config);
const grab = scoreAir(air({ grabs: { indy: 0.5 } }), config);
const longGrab = scoreAir(air({ grabs: { indy: 99 } }), config);
check(shortGrab === null, 'should not count a grab that was only touched');
check(grab.name === 'INDY' && grab.points === config.pointsPerGrab + 0.5 * config.pointsPerGrabSecond, 'should give a grab its points, and more for the time it was held');
check(longGrab.points === config.pointsPerGrab + config.grabMaxTime * config.pointsPerGrabSecond, 'should stop adding points for a grab at the longest time');
const combo = scoreAir(air({ spin: TURN, flip: TURN, grabs: { mute: 0.5 } }), config);
const parts = spin360.points + back.points + config.pointsPerGrab + 0.5 * config.pointsPerGrabSecond;
check(combo.name === 'BACKFLIP 360 MUTE' && combo.points === Math.round(parts * (1 + 2 * config.comboBonus)), 'should name a combination flip, spin, grab, and multiply its points');
const toSwitch = scoreAir(air({ spin: Math.PI, switch: true }), config);
check(toSwitch.name === '180 TO SWITCH' && toSwitch.points === Math.round(config.pointsPerHalfSpin * (1 + config.switchBonus)), 'should reward a landing backward');

console.log(fails ? `${fails} FAILED` : 'ALL OK');
process.exit(fails ? 1 : 0);
