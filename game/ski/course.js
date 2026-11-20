import { Heightfield } from '../../core/client/engine/heightfield.js';
import { createValueNoise, layeredNoise, seededRandom } from '../../core/client/engine/noise.js';
import { clamp, lerp, smoothstep } from '../../core/client/engine/math.js';

/*
 * COURSE BUILDER: turns a course definition (see course-freeride.js) into the things a run needs:
 * the ground (a Heightfield), where the rider starts and finishes, and what stands on the slope.
 * It makes no meshes, so it runs in a test; game/ski/course-scene.js draws the result.
 *
 * A course runs down toward -Z, the way yaw 0 faces. `distance` is metres down the course from its
 * top edge (z = maxZ - distance); `x` is metres across it.
 */

export const DOWNHILL_YAW = 0; // the yaw that faces down every course

const DEGREES = Math.PI / 180;
const BASE_HEIGHT = 10; // metres: the height of the lowest point of the fall line
const DROP_FACE_LENGTH = 2.5; // metres down the course that the face of a drop takes
const DROP_EDGE = 10; // metres over which a drop fades out at its sides ...
const DROP_EDGE_SHARE = 0.25; // ... but never more than this share of its width
const CALM_FADE_FROM = 8; // metres past the start gate where the gully and the bumps begin to fade in
const CALM_FADE_TO = 60; // ... and where they are at full strength
const CALM_NOISE = 0.2; // share of the bumps that the calm ground at the start and at the finish keeps
const CALM_FINISH_LENGTH = 60; // metres before the finish over which the gully and the bumps fade out again
const EDGE_MARGIN = 4; // metres from the edge of the course where nothing is placed
const PLACEMENT_TRIES = 14; // candidate points tried for each tree or rock that the definition asks for
const LANDING_BASE = 14; // metres below a drop that stay clear of trees and rocks ...
const LANDING_PER_METRE = 6; // ... plus this much for each metre of the drop's height
const LANDING_SIDE = 5; // metres of clear ground beside a drop's landing
const ROCK_HEIGHT_SHARE = 1.1; // how tall a rock stands, as a share of its radius
const TREE_SEED = 1; // added to the course seed, so trees and rocks do not share one random sequence
const ROCK_SEED = 2;
const CLUMP_SEED = 3;

/** The slope of the fall line at `distance`, in degrees: the profile points joined by straight lines. */
function slopeAt(profile, distance) {
  if (distance <= profile[0][0]) return profile[0][1];
  for (let i = 1; i < profile.length; i++) {
    const [to, toSlope] = profile[i];
    if (distance > to) continue;
    const [from, fromSlope] = profile[i - 1];
    return lerp(fromSlope, toSlope, (distance - from) / (to - from));
  }
  return profile[profile.length - 1][1];
}

/** The height of the fall line at each grid row, measured down the course. Its lowest point is at BASE_HEIGHT. */
function buildFallLine(definition, cell, rows) {
  const heights = new Float32Array(rows + 1);
  let lowest = 0;
  for (let row = 1; row <= rows; row++) {
    const middle = (row - 0.5) * cell;
    heights[row] = heights[row - 1] - Math.tan(slopeAt(definition.profile, middle) * DEGREES) * cell;
    lowest = Math.min(lowest, heights[row]);
  }
  for (let row = 0; row <= rows; row++) heights[row] += BASE_HEIGHT - lowest;
  return (distance) => {
    const position = clamp(distance / cell, 0, rows);
    const row = Math.min(Math.floor(position), rows - 1);
    return lerp(heights[row], heights[row + 1], position - row);
  };
}

/** The valley sides: nothing inside the flat part, then a rise that steepens toward the edge. */
function bankHeight(banks, half, x) {
  const t = clamp((Math.abs(x) - banks.flatHalfWidth) / (half - banks.flatHalfWidth), 0, 1);
  return banks.height * t * t;
}

/** A shallow gully that swings from side to side down the course. */
function gullyHeight(gully, x, distance) {
  const centre = gully.swing * Math.sin((2 * Math.PI * distance) / gully.wavelength);
  const offset = (x - centre) / gully.halfWidth;
  return -gully.depth * Math.exp(-offset * offset);
}

/** One drop: the ground builds up over the approach, then falls away over the face. */
function dropHeight(drop, distance, x) {
  const along = distance < drop.distance
    ? smoothstep(drop.distance - drop.approach, drop.distance, distance)
    : 1 - smoothstep(drop.distance, drop.distance + DROP_FACE_LENGTH, distance);
  if (along === 0) return 0;
  const halfWidth = drop.width / 2;
  const edge = Math.min(DROP_EDGE, drop.width * DROP_EDGE_SHARE);
  const across = 1 - smoothstep(halfWidth - edge, halfWidth, Math.abs(x - drop.x));
  return drop.height * along * across;
}

/** True where trees and rocks must not stand: around the start, on the finish stretch, and where a drop is ridden and landed. */
function isKeptClear(definition, x, distance) {
  const { start, finish, drops, banks } = definition;
  if (Math.hypot(x - start.x, distance - start.distance) < start.clearRadius) return true;
  if (distance > finish.distance - finish.clearLength && Math.abs(x) < banks.flatHalfWidth) return true;
  return drops.some((drop) => {
    const landing = LANDING_BASE + drop.height * LANDING_PER_METRE;
    return distance > drop.distance - drop.approach && distance < drop.distance + landing
      && Math.abs(x - drop.x) < drop.width / 2 + LANDING_SIDE;
  });
}

/**
 * Scatter up to `count` points over the course, none closer than `spacing` to anything in `taken`
 * (which grows as points are placed). `make(x, distance)` returns the thing to place there, or null.
 */
function scatter({ random, count, spacing, half, length, taken, make }) {
  const placed = [];
  const spacingSquared = spacing * spacing;
  for (let tries = count * PLACEMENT_TRIES; tries > 0 && placed.length < count; tries--) {
    const x = lerp(-half + EDGE_MARGIN, half - EDGE_MARGIN, random());
    const distance = lerp(EDGE_MARGIN, length - EDGE_MARGIN, random());
    const item = make(x, distance);
    if (!item) continue;
    if (taken.some((other) => (other.x - item.x) ** 2 + (other.z - item.z) ** 2 < spacingSquared)) continue;
    placed.push(item);
    taken.push(item);
  }
  return placed;
}

/** How likely a candidate point is to get a tree: thick forest on the valley sides, clumps in the glades, a few elsewhere. */
function treeDensity(definition, clumps, x, distance) {
  const { trees, banks } = definition;
  const onBank = smoothstep(banks.flatHalfWidth - trees.bankBlend, banks.flatHalfWidth + trees.bankBlend, Math.abs(x));
  const glade = trees.glades.find((stretch) => distance >= stretch.from && distance <= stretch.to);
  const inClump = clumps(x / trees.clumpWavelength, distance / trees.clumpWavelength) > trees.clumpThreshold;
  const open = glade && inClump ? glade.density : trees.openDensity;
  return Math.max(open, trees.bankDensity * onBank);
}

/**
 * Build a course from its definition, on a grid with `cell` metres between heights.
 * Returns { id, name, width, length, heightfield, start { x, y, z, yaw }, finish { x, y, z },
 * markers [{ name, x, y, z }], obstacles [{ kind: 'tree' | 'rock', x, y, z, radius, height, turn }] }.
 */
export function buildCourse(definition, cell) {
  const { width, length, seed } = definition;
  const half = width / 2;
  const heightfield = new Heightfield({
    minX: -half, minZ: -length / 2, cell, columns: Math.round(width / cell), rows: Math.round(length / cell),
  });
  const { maxZ } = heightfield;
  const fallLine = buildFallLine(definition, cell, heightfield.rows);
  const bumps = createValueNoise(seed);
  const wildFrom = definition.start.distance + CALM_FADE_FROM;
  const wildTo = definition.start.distance + CALM_FADE_TO;
  const calmFrom = definition.finish.distance - CALM_FINISH_LENGTH;

  heightfield.fill((x, z) => {
    const distance = maxZ - z;
    const wild = smoothstep(wildFrom, wildTo, distance) * (1 - smoothstep(calmFrom, definition.finish.distance, distance));
    let height = fallLine(distance) + bankHeight(definition.banks, half, x);
    height += gullyHeight(definition.gully, x, distance) * wild;
    height += layeredNoise(bumps, x, z, definition.noise) * lerp(CALM_NOISE, 1, wild);
    for (const drop of definition.drops) height += dropHeight(drop, distance, x);
    return height;
  });

  const pointAt = (x, distance) => {
    const z = maxZ - distance;
    return { x, y: heightfield.heightAt(x, z), z };
  };
  const normal = { x: 0, y: 1, z: 0 };
  const upwardAt = (point) => heightfield.normalAt(point.x, point.z, normal).y;
  const taken = [];
  const scatterArea = { half, length, taken };

  const { trees, rocks } = definition;
  const treeRandom = seededRandom(seed + TREE_SEED);
  const clumps = createValueNoise(seed + CLUMP_SEED);
  const treeList = scatter({
    ...scatterArea, random: treeRandom, count: trees.count, spacing: trees.spacing,
    make: (x, distance) => {
      if (treeRandom() >= treeDensity(definition, clumps, x, distance) || isKeptClear(definition, x, distance)) return null;
      const point = pointAt(x, distance);
      if (upwardAt(point) < trees.minUpward) return null;
      const size = treeRandom();
      return {
        kind: 'tree', ...point,
        radius: lerp(trees.minTrunkRadius, trees.maxTrunkRadius, size),
        height: lerp(trees.minHeight, trees.maxHeight, size),
        turn: treeRandom() * 2 * Math.PI,
      };
    },
  });

  const rockRandom = seededRandom(seed + ROCK_SEED);
  const rockList = scatter({
    ...scatterArea, random: rockRandom, count: rocks.count, spacing: rocks.spacing,
    make: (x, distance) => {
      if (isKeptClear(definition, x, distance)) return null;
      const point = pointAt(x, distance);
      const density = upwardAt(point) < rocks.steepUpward ? rocks.steepDensity : rocks.openDensity;
      if (rockRandom() >= density) return null;
      const radius = lerp(rocks.minRadius, rocks.maxRadius, rockRandom() ** 2); // mostly small, a few boulders
      return { kind: 'rock', ...point, radius, height: radius * ROCK_HEIGHT_SHARE, turn: rockRandom() * 2 * Math.PI };
    },
  });

  return {
    id: definition.id,
    name: definition.name,
    width,
    length,
    heightfield,
    start: { ...pointAt(definition.start.x, definition.start.distance), yaw: DOWNHILL_YAW },
    finish: pointAt(0, definition.finish.distance),
    markers: definition.markers.map((marker) => ({ name: marker.name, ...pointAt(marker.x, marker.distance) })),
    obstacles: [...treeList, ...rockList],
  };
}
