import * as THREE from 'three';
import { DeformableTerrain } from '../../core/client/graphics/deformable-terrain.js';
import { material, createSnowTexture } from '../../core/client/graphics/materials.js';
import { smoothstep } from '../../core/client/engine/math.js';

/*
 * COURSE SCENE: everything you see of a course (game/ski/course.js builds the data): the snow, the
 * trees and rocks, and the start and finish gates. All of it lives in one group; dispose() frees it.
 *
 * Trees and rocks are instanced, one batch for each BAND_LENGTH of course, so a stretch that is out of
 * view or beyond the fog costs nothing to draw.
 */

const BAND_LENGTH = 100; // metres of course in one batch of trees or rocks
const FOLIAGE_TIERS = [ // a tree of height 1: three cones, the widest at the bottom
  { radius: 0.26, height: 0.42, base: 0.14 },
  { radius: 0.2, height: 0.38, base: 0.38 },
  { radius: 0.13, height: 0.36, base: 0.64 },
];
const FOLIAGE_SIDES = 7;
const FOLIAGE_GREEN = 0x1f4d33;
const FOLIAGE_SNOW = 0xe6edf5;
const SNOW_LINE = 0.35; // how far up each tier (0 = its base, 1 = its tip) the snow starts to show
const TRUNK = { topRadius: 0.03, bottomRadius: 0.045, height: 0.3, sides: 5 }; // also for a tree of height 1
const TRUNK_COLOR = 0x4a3526;
const TREE_SINK = 0.3; // metres a tree stands in the snow, so no gap shows under it on a slope
const ROCK_COLOR = 0x6f7378;
const ROCK_SHAPE = { x: 1, y: 0.7, z: 1.15 }; // a rock of radius 1: wider than it is tall
const ROCK_SINK = 0.3; // share of a rock's radius that is buried
const ROCK_TILT = 0.35; // radians a rock may lean
const GATE_POLE_HEIGHT = 3.2;
const GATE_POLE_RADIUS = 0.07;
const GATE_BANNER_HEIGHT = 0.6;
const GATE_BANNER_DEPTH = 0.06;
const GATE_POLE_COLOR = 0x2a2f36;
const START_GATE = { width: 7, ahead: 6, color: 0xff6a00 }; // `ahead`: metres down the course from where the rider starts
const FINISH_GATE = { width: 40, ahead: 0, color: 0x00f0ff };
const UP = new THREE.Vector3(0, 1, 0);

/** The needles of a tree of height 1: stacked cones, green at the base of each tier and snow at its tip. */
function buildFoliageGeometry() {
  const positions = [];
  const colors = [];
  const green = new THREE.Color(FOLIAGE_GREEN);
  const snow = new THREE.Color(FOLIAGE_SNOW);
  const tint = new THREE.Color();
  for (const tier of FOLIAGE_TIERS) {
    const cone = new THREE.ConeGeometry(tier.radius, tier.height, FOLIAGE_SIDES).toNonIndexed();
    cone.translate(0, tier.base + tier.height / 2, 0);
    const corners = cone.attributes.position;
    for (let i = 0; i < corners.count; i++) {
      positions.push(corners.getX(i), corners.getY(i), corners.getZ(i));
      tint.copy(green).lerp(snow, smoothstep(SNOW_LINE, 1, (corners.getY(i) - tier.base) / tier.height));
      colors.push(tint.r, tint.g, tint.b);
    }
    cone.dispose();
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals(); // no shared corners, so every face is flat: a low-polygon tree
  return geometry;
}

function buildTrunkGeometry() {
  const geometry = new THREE.CylinderGeometry(TRUNK.topRadius, TRUNK.bottomRadius, TRUNK.height, TRUNK.sides);
  geometry.translate(0, TRUNK.height / 2, 0);
  return geometry;
}

/** Group obstacles of one kind by the band of course they stand in. */
function byBand(obstacles, kind, minZ) {
  const bands = new Map();
  for (const obstacle of obstacles) {
    if (obstacle.kind !== kind) continue;
    const band = Math.floor((obstacle.z - minZ) / BAND_LENGTH);
    if (!bands.has(band)) bands.set(band, []);
    bands.get(band).push(obstacle);
  }
  return [...bands.values()];
}

export class CourseScene {
  /** @param options { course (from buildCourse), config (CONFIG.ski.terrain) } */
  constructor({ course, config }) {
    this.group = new THREE.Group();
    this.snowTexture = createSnowTexture();
    this.materials = {
      snow: material(0xffffff, { map: this.snowTexture, vertexColors: true, roughness: 0.9 }),
      foliage: material(0xffffff, { vertexColors: true, roughness: 0.85 }),
      trunk: material(TRUNK_COLOR, { roughness: 0.9 }),
      rock: material(ROCK_COLOR, { roughness: 0.8, flatShading: true }),
      pole: material(GATE_POLE_COLOR, { roughness: 0.5, metalness: 0.6 }),
    };
    this.geometries = {
      foliage: buildFoliageGeometry(),
      trunk: buildTrunkGeometry(),
      rock: new THREE.DodecahedronGeometry(1, 0),
    };
    this.batches = [];
    this.gateParts = [];
    this.bannerMaterials = [];

    this.terrain = new DeformableTerrain({
      heightfield: course.heightfield,
      chunkCells: config.chunkCells,
      material: this.materials.snow,
      textureTile: config.textureTile,
      flatColor: config.snowColor,
      steepColor: config.rockColor,
      steepStart: config.rockStart,
      steepFull: config.rockFull,
    });
    this.group.add(this.terrain.group);

    this._addTrees(course);
    this._addRocks(course);
    this._addGate(course, course.start, START_GATE);
    this._addGate(course, course.finish, FINISH_GATE);
  }

  /** One instanced mesh that draws `geometry` once for each item; `place(item, matrix)` sets where. */
  _addBatch(geometry, batchMaterial, items, place, castShadow) {
    const batch = new THREE.InstancedMesh(geometry, batchMaterial, items.length);
    const matrix = new THREE.Matrix4();
    items.forEach((item, index) => {
      place(item, matrix);
      batch.setMatrixAt(index, matrix);
    });
    batch.instanceMatrix.needsUpdate = true;
    batch.castShadow = castShadow;
    batch.receiveShadow = true;
    this.batches.push(batch);
    this.group.add(batch);
  }

  _addTrees(course) {
    const position = new THREE.Vector3();
    const turn = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    const place = (tree, matrix) => {
      position.set(tree.x, tree.y - TREE_SINK, tree.z);
      turn.setFromAxisAngle(UP, tree.turn);
      matrix.compose(position, turn, scale.setScalar(tree.height));
    };
    for (const trees of byBand(course.obstacles, 'tree', course.heightfield.minZ)) {
      this._addBatch(this.geometries.foliage, this.materials.foliage, trees, place, true);
      this._addBatch(this.geometries.trunk, this.materials.trunk, trees, place, false);
    }
  }

  _addRocks(course) {
    const position = new THREE.Vector3();
    const turn = new THREE.Quaternion();
    const lean = new THREE.Euler();
    const scale = new THREE.Vector3();
    const place = (rock, matrix) => {
      position.set(rock.x, rock.y - rock.radius * ROCK_SINK + rock.radius * ROCK_SHAPE.y * 0.5, rock.z);
      turn.setFromEuler(lean.set(Math.sin(rock.turn * 3) * ROCK_TILT, rock.turn, Math.cos(rock.turn * 5) * ROCK_TILT));
      scale.set(rock.radius * ROCK_SHAPE.x, rock.radius * ROCK_SHAPE.y, rock.radius * ROCK_SHAPE.z);
      matrix.compose(position, turn, scale);
    };
    for (const rocks of byBand(course.obstacles, 'rock', course.heightfield.minZ)) {
      this._addBatch(this.geometries.rock, this.materials.rock, rocks, place, true);
    }
  }

  /** Two poles and a banner across the course, `gate.ahead` metres down from `point`. */
  _addGate(course, point, gate) {
    const field = course.heightfield;
    const z = point.z - gate.ahead;
    const halfWidth = gate.width / 2;
    const bases = [-1, 1].map((side) => field.heightAt(point.x + side * halfWidth, z));
    const top = Math.max(...bases) + GATE_POLE_HEIGHT;
    const add = (geometry, partMaterial, x, y) => {
      const part = new THREE.Mesh(geometry, partMaterial);
      part.position.set(x, y, z);
      part.castShadow = true;
      this.gateParts.push(part);
      this.group.add(part);
    };
    bases.forEach((base, index) => {
      const height = top - base;
      add(new THREE.CylinderGeometry(GATE_POLE_RADIUS, GATE_POLE_RADIUS, height, 6), this.materials.pole, point.x + (index === 0 ? -halfWidth : halfWidth), base + height / 2);
    });
    const banner = material(gate.color, { emissive: gate.color, emissiveIntensity: 0.35, roughness: 0.6 });
    add(new THREE.BoxGeometry(gate.width, GATE_BANNER_HEIGHT, GATE_BANNER_DEPTH), banner, point.x, top - GATE_BANNER_HEIGHT / 2);
    this.bannerMaterials.push(banner);
  }

  /** Remove the course from the scene and free everything it holds on the GPU. */
  dispose() {
    this.terrain.dispose();
    for (const batch of this.batches) batch.dispose();
    for (const part of this.gateParts) part.geometry.dispose();
    for (const geometry of Object.values(this.geometries)) geometry.dispose();
    for (const item of [...Object.values(this.materials), ...this.bannerMaterials]) item.dispose();
    this.snowTexture.dispose();
    this.group.removeFromParent();
  }
}
