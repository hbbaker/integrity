import * as THREE from 'three';

/*
 * Two-bone IK: where the middle joint of a two-bone limb (an elbow, a knee) goes when the end of the
 * limb is put on a target. Shared by the body model and by anything that builds a body in the same pose.
 */

const MIN_FOLD = 0.02; // metres: a limb never folds quite flat ...
const MAX_REACH = 0.001; // ... and never locks quite straight

/**
 * A limb of two bones (`upperLength`, `lowerLength`) from `origin` whose end goes to `target`, or as near as
 * the limb reaches. The middle joint bends toward `hint` (`fallback` when the hint lies along the limb).
 * All points are in one space. Returns { upper, lower } (unit directions of the two bones), `joint` (the
 * middle joint) and `end` (where the limb's end is).
 */
export function bendLimb(origin, target, upperLength, lowerLength, hint, fallback) {
  const toTarget = target.clone().sub(origin);
  const distance = THREE.MathUtils.clamp(toTarget.length(), Math.abs(upperLength - lowerLength) + MIN_FOLD, upperLength + lowerLength - MAX_REACH);
  const along = toTarget.normalize();
  const pole = hint.clone().addScaledVector(along, -hint.dot(along));
  if (pole.lengthSq() < 1e-6) pole.copy(fallback);
  pole.normalize();

  const alongJoint = (upperLength * upperLength - lowerLength * lowerLength + distance * distance) / (2 * distance);
  const outFromLine = Math.sqrt(Math.max(0, upperLength * upperLength - alongJoint * alongJoint));
  const joint = origin.clone().addScaledVector(along, alongJoint).addScaledVector(pole, outFromLine);
  const end = origin.clone().addScaledVector(along, distance);
  return { upper: joint.clone().sub(origin).normalize(), lower: end.clone().sub(joint).normalize(), joint, end };
}
