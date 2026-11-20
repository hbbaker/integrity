/*
 * LANDING: how hard the rider comes down, and what the rider did about it. A pure function of the landing
 * record that the rider gives (game/ski/rider.js) and the style points of the air time (game/ski/tricks.js).
 *
 * The gravity load is the greatest height above the snow that the rider had in the air. A stomp (a press of the stomp control shortly before the
 * snow) takes load away, and good tricks make that stomp stronger and give it a wider window. A landing
 * that is not square adds load that nothing takes away. What is left decides: clean, sketchy, or a crash.
 */

export const LANDING_RATINGS = { CLEAN: 'clean', STOMPED: 'stomped', SKETCHY: 'sketchy', CRASH: 'crash' };

/**
 * @param landing { load (metres: the greatest height above the snow), stompAge (seconds between the stomp press and the snow, or null: no press),
 *   uprightShare, sidewaysShare (0..1: how much of the tolerance for a flip and for a spin the landing used) }
 * @param style the style points of this air time
 * @param config CONFIG.ski.landing
 * @returns { window (seconds the stomp had), stomped, effectiveLoad, share (of the crash limit), rating }
 */
export function judgeLanding(landing, style, config) {
  const window = Math.min(config.stompWindowMax, config.stompWindow + style * config.windowPerStyle);
  const stomped = landing.stompAge !== null && landing.stompAge <= window;
  const absorbed = stomped ? config.stompAbsorb + Math.min(config.styleAbsorbMax, style * config.absorbPerStyle) : 0;
  const penalty = (landing.uprightShare + landing.sidewaysShare) * config.alignPenalty;
  const effectiveLoad = Math.max(0, landing.load - absorbed) + penalty;
  const share = effectiveLoad / config.crashLimit;
  let rating = LANDING_RATINGS.CLEAN;
  if (share >= 1) rating = LANDING_RATINGS.CRASH;
  else if (share >= config.sketchyShare) rating = LANDING_RATINGS.SKETCHY;
  else if (stomped && landing.load >= config.stompMinLoad) rating = LANDING_RATINGS.STOMPED;
  return { window, stomped, effectiveLoad, share, rating };
}
