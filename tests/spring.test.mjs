/*
 * The damped spring: a value that follows a target, with or without overshoot.
 */
import { load } from './support/modules.mjs';

const { DampedSpring } = await load('spring');

let fails = 0;
const check = (ok, msg) => { console.log(`${ok ? 'ok  ' : 'FAIL'}: ${msg}`); if (!ok) fails++; };
const STEP = 1 / 60;
const run = (spring, target, seconds, step = STEP) => {
  let highest = -Infinity;
  for (let t = 0; t < seconds; t += step) highest = Math.max(highest, spring.step(target, step));
  return highest;
};

const critical = new DampedSpring(2, 1);
const highestCritical = run(critical, 1, 3);
check(Math.abs(critical.value - 1) < 1e-3 && Math.abs(critical.velocity) < 1e-2, 'should come to rest on the target when it is given time');
check(highestCritical <= 1 + 1e-6, 'should not pass the target when the damping is 1');

const loose = new DampedSpring(2, 0.4);
const highestLoose = run(loose, 1, 3);
check(highestLoose > 1.05, 'should overshoot the target when the damping is below 1');
check(Math.abs(loose.value - 1) < 0.01, 'should still settle on the target after it overshoots');

const slow = new DampedSpring(0.5, 1);
const fast = new DampedSpring(4, 1);
run(slow, 1, 0.25);
run(fast, 1, 0.25);
check(fast.value > slow.value, 'should follow faster when the frequency is higher');

const longFrames = new DampedSpring(4, 0.6);
run(longFrames, 1, 3, 0.1); // 10 frames per second
check(Number.isFinite(longFrames.value) && Math.abs(longFrames.value - 1) < 0.01, 'should stay stable when the frames are long');

const started = new DampedSpring(2, 1, 5);
check(started.value === 5 && started.step(5, STEP) === 5, 'should start at rest on the value it is given');
loose.reset(3);
check(loose.value === 3 && loose.velocity === 0, 'should be at rest on the new value when it is reset');

console.log(fails ? `${fails} FAILED` : 'ALL OK');
process.exit(fails ? 1 : 0);
