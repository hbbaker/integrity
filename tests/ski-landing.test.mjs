/*
 * The landing rule: gravity load, the stomp, what tricks add to it, and the rating that comes out.
 */
import { load, loadConfig } from './support/modules.mjs';

const { judgeLanding, LANDING_RATINGS } = await load('ski-landing');

let fails = 0;
const check = (ok, msg) => { console.log(`${ok ? 'ok  ' : 'FAIL'}: ${msg}`); if (!ok) fails++; };
const CONFIG = await loadConfig();
const config = CONFIG.ski.landing;
const near = (a, b) => Math.abs(a - b) < 1e-9;
const landing = (overrides) => ({ load: 0, stompAge: null, uprightShare: 0, sidewaysShare: 0, ...overrides });
const judge = (overrides, style = 0) => judgeLanding(landing(overrides), style, config);
const { CLEAN, STOMPED, SKETCHY, CRASH } = LANDING_RATINGS;
const LIMIT = config.crashLimit;
const IN_TIME = config.stompWindow / 2;

// --- with no stomp ---
check(judge({ load: 1 }).rating === CLEAN && near(judge({ load: 1 }).share, 1 / LIMIT), 'should call a small drop clean, with its share of the limit');
check(judge({ load: LIMIT * config.sketchyShare + 0.01 }).rating === SKETCHY, 'should call a drop near the limit sketchy');
check(judge({ load: LIMIT - 0.01 }).rating === SKETCHY && judge({ load: LIMIT }).rating === CRASH, 'should crash at the limit');
check(judge({ load: LIMIT + 1 }, 5000).rating === CRASH, 'should not let tricks alone save a landing: they work through the stomp');

// --- the stomp ---
const stomped = judge({ load: LIMIT + 1, stompAge: IN_TIME });
check(stomped.stomped && stomped.rating === STOMPED && near(stomped.effectiveLoad, LIMIT + 1 - config.stompAbsorb), 'should take load away with a stomp in time, and survive a drop that would crash');
check(judge({ load: LIMIT + 1, stompAge: config.stompWindow + 0.01 }).rating === CRASH, 'should not count a stomp that was pressed too early');
check(!judge({ load: LIMIT + 1, stompAge: config.stompWindow + 0.01 }).stomped, 'should say that the early stomp failed');
check(judge({ load: LIMIT + config.stompAbsorb + 0.5, stompAge: IN_TIME }).rating === CRASH, 'should crash a drop that is too big for a stomp alone');
check(judge({ load: config.stompMinLoad / 2, stompAge: IN_TIME }).rating === CLEAN, 'should not call a stomp of a tiny hop a stomp');
check(judge({ load: 1, stompAge: IN_TIME }).effectiveLoad === 0, 'should never make the load negative');

// --- tricks make the stomp stronger and its window wider ---
const BIG = LIMIT + config.stompAbsorb + 2;
check(judge({ load: BIG, stompAge: IN_TIME }, 0).rating === CRASH && judge({ load: BIG, stompAge: IN_TIME }, 1000).rating !== CRASH, 'should survive a bigger drop when the stomp comes after good tricks');
check(near(judge({ load: BIG, stompAge: IN_TIME }, 500).effectiveLoad, BIG - config.stompAbsorb - 500 * config.absorbPerStyle), 'should take away more load for each style point');
check(near(judge({ load: 99, stompAge: IN_TIME }, 1e9).effectiveLoad, 99 - config.stompAbsorb - config.styleAbsorbMax), 'should limit what style can take away');
const lateForNothing = config.stompWindow + 0.1;
check(!judge({ load: 3, stompAge: lateForNothing }, 0).stomped && judge({ load: 3, stompAge: lateForNothing }, 1000).stomped, 'should give the stomp a wider window after good tricks');
check(near(judge({}, 1000).window, config.stompWindow + 1000 * config.windowPerStyle) && judge({}, 1e9).window === config.stompWindowMax, 'should widen the window with each style point, up to a limit');

// --- a landing that is not square ---
const crooked = judge({ load: 1, sidewaysShare: 1 });
check(near(crooked.effectiveLoad, 1 + config.alignPenalty), 'should add load for a landing at the edge of the spin tolerance');
check(near(judge({ load: 1, uprightShare: 0.5, sidewaysShare: 0.5 }).effectiveLoad, 1 + config.alignPenalty), 'should add load for a flip that is not finished, too');
check(near(judge({ load: 2, sidewaysShare: 1, stompAge: IN_TIME }, 5000).effectiveLoad, config.alignPenalty), 'should not let a stomp take the penalty away');
check(judge({ load: LIMIT - 1, sidewaysShare: 1 }).rating === CRASH, 'should crash a drop that a square landing would hold, when the landing is crooked');

console.log(fails ? `${fails} FAILED` : 'ALL OK');
process.exit(fails ? 1 : 0);
