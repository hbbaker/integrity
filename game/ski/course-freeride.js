/*
 * The FREERIDE course: one long off-piste descent with an open bowl, steeps, tree glades, three cliff
 * bands and a few natural lips. This file is only data; game/ski/course.js turns it into ground.
 *
 * `distance` is always metres down the course from its top edge. `x` is metres across it (0 = the middle).
 */
export const FREERIDE_COURSE = {
  id: 'freeride',
  name: 'FREERIDE',
  seed: 20261119, // the bumps, trees and rocks are the same on every run
  width: 240,
  length: 1400,

  // The fall line: [distance, slope in degrees]. The slope changes evenly between points. Below zero is uphill.
  profile: [
    [0, 24], [30, 24], // the ridge behind the start
    [48, 4], [78, 4], // start bench
    [125, 21], [245, 24], // open bowl
    [268, 31], [330, 31], // steeps
    [352, 14], [420, 14], // bench
    [452, 27], [620, 27], // upper glades, cliff band A
    [642, 13], [700, 13], // bench
    [730, 32], [900, 32], // the face: cliff bands B and C
    [930, 22], [1100, 22], // lower glades
    [1135, 10], [1250, 10], // runout
    [1278, 1], [1335, 1], // finish flat
    [1355, -13], [1400, -13], // the rise that stops you
  ],

  // The valley sides: level with the run inside `flatHalfWidth`, then they rise to `height` at the course edge.
  banks: { flatHalfWidth: 76, height: 34 },
  // A shallow gully that winds down the middle: `swing` metres to each side, once per `wavelength`.
  gully: { depth: 3.5, halfWidth: 24, swing: 30, wavelength: 540 },
  // Bumps and hollows: layers of noise, from long rolls to small ripples.
  noise: [
    { wavelength: 95, amplitude: 3.5 },
    { wavelength: 41, amplitude: 1.4 },
    { wavelength: 15, amplitude: 0.5 },
    { wavelength: 5.5, amplitude: 0.12 },
  ],

  // Drops: the ground runs flatter for `approach` metres, then falls `height` metres. `width` is the span across the slope.
  drops: [
    { distance: 205, x: -18, width: 30, height: 1.6, approach: 12 }, // first lip
    { distance: 300, x: 28, width: 34, height: 2.4, approach: 12 }, // lip in the steeps
    { distance: 385, x: 0, width: 60, height: 1.4, approach: 9 }, // roller on the bench
    { distance: 535, x: -22, width: 56, height: 5, approach: 34 }, // cliff band A
    { distance: 792, x: 14, width: 70, height: 9, approach: 44 }, // cliff band B: the big one
    { distance: 862, x: -40, width: 40, height: 4, approach: 26 }, // cliff band C
    { distance: 985, x: 20, width: 28, height: 2.2, approach: 10 }, // lower kickers
    { distance: 1050, x: -25, width: 28, height: 2.6, approach: 11 },
  ],

  start: { distance: 62, x: 0, clearRadius: 28 }, // nothing stands within clearRadius of the start gate
  finish: { distance: 1295, clearLength: 40 }, // the run is clear for clearLength before the finish and all the way after it

  // Places a developer can jump to (developer mode only).
  markers: [
    { name: 'START', distance: 62, x: 0 },
    { name: 'STEEPS', distance: 262, x: 8 },
    { name: 'CLIFFS', distance: 745, x: 14 },
    { name: 'RUNOUT', distance: 1125, x: 0 },
  ],

  trees: {
    count: 1000,
    spacing: 4.5, // metres between any two trunks at least
    minHeight: 6,
    maxHeight: 13,
    minTrunkRadius: 0.22, // the trunk is what the rider can hit
    maxTrunkRadius: 0.4,
    openDensity: 0.012, // chance that a candidate point on open ground gets a tree
    bankDensity: 0.9, // ... on the valley sides
    bankBlend: 11, // metres each side of the flat edge over which the forest thickens
    glades: [ // stretches of the run with trees to ride between
      { from: 432, to: 615, density: 0.55 },
      { from: 905, to: 1095, density: 0.5 },
    ],
    clumpWavelength: 30, // glade trees stand in clumps about this far apart
    clumpThreshold: 0.05, // how much of a glade is clump (lower = more trees)
    minUpward: 0.78, // no trees on ground steeper than this (the normal's upward part)
  },

  rocks: {
    count: 140,
    spacing: 5,
    minRadius: 0.5,
    maxRadius: 1.9,
    steepUpward: 0.9, // ground steeper than this counts as rocky
    steepDensity: 0.5, // chance that a candidate point on rocky ground gets a rock
    openDensity: 0.02,
  },
};
