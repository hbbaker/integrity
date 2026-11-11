/*
 * SWING POSES: how the held item moves during a whole-item swing (not a punch). Each style maps swing progress
 * `t` (0..1) to a pose offset. Rotation `rx` is positive when the far end of the item lifts toward the sky.
 *
 *   jab        a short forward poke (the default)
 *   overhead   raise the item up and back, slam it down in front, then recover
 */

const OVERHEAD_WINDUP_END = 0.4;
const OVERHEAD_SLAM_END = 0.65;
const OVERHEAD_RAISED = { rx: 0.95, y: 0.12, z: 0.06 };
const OVERHEAD_STRUCK = { rx: -1.45, y: -0.18, z: -0.34 };

/** The share of the swing at which an overhead swing lands. */
export const OVERHEAD_IMPACT_T = OVERHEAD_SLAM_END;

const smooth = (u) => u * u * (3 - 2 * u);
const lerp = (from, to, u) => from + (to - from) * u;

const STYLES = {
  jab(t) {
    const s = Math.sin(Math.PI * t);
    return { x: -0.12 * s, y: 0, z: -0.22 * s, rx: 0.25 * s, ry: 0.7 * s };
  },
  overhead(t) {
    if (t < OVERHEAD_WINDUP_END) {
      const e = smooth(t / OVERHEAD_WINDUP_END);
      return { x: 0, y: OVERHEAD_RAISED.y * e, z: OVERHEAD_RAISED.z * e, rx: OVERHEAD_RAISED.rx * e, ry: 0 };
    }
    if (t < OVERHEAD_SLAM_END) {
      const u = (t - OVERHEAD_WINDUP_END) / (OVERHEAD_SLAM_END - OVERHEAD_WINDUP_END);
      const e = u * u; // accelerates into the hit
      return {
        x: 0, ry: 0,
        y: lerp(OVERHEAD_RAISED.y, OVERHEAD_STRUCK.y, e),
        z: lerp(OVERHEAD_RAISED.z, OVERHEAD_STRUCK.z, e),
        rx: lerp(OVERHEAD_RAISED.rx, OVERHEAD_STRUCK.rx, e),
      };
    }
    const e = smooth((t - OVERHEAD_SLAM_END) / (1 - OVERHEAD_SLAM_END));
    return { x: 0, ry: 0, y: OVERHEAD_STRUCK.y * (1 - e), z: OVERHEAD_STRUCK.z * (1 - e), rx: OVERHEAD_STRUCK.rx * (1 - e) };
  },
};

/** The pose offset { x, y, z, rx, ry } for `style` at swing progress `t`. Unknown styles fall back to the jab. */
export function swingPose(style, t) {
  return (STYLES[style] ?? STYLES.jab)(t);
}
