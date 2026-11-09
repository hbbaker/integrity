import * as THREE from 'three';
import {
  material, createConcreteTexture, createCorrugatedTexture, createSteelTexture, createHazardTexture,
} from './effects.js';

/*
 * The arena and its collision.
 *
 * COLLISION MODEL
 * Every solid is an axis-aligned footprint (minX..maxX, minZ..maxZ) resting on the
 * floor, with a top surface height. Boxes have a flat top; ramps have a top that
 * rises linearly along one axis. Because nothing floats and there are no ceilings,
 * collision reduces to two cheap questions:
 *   1. groundHeight(x, z): how high is the floor under this point?
 *   2. isBlocked(x, z, radius, feetY): is there a solid whose top is more than
 *      `stepHeight` above my feet within `radius` of this point?
 * Moving is done one axis at a time (X, then Z), so you slide along walls.
 */

const RAMP_DIRECTIONS = {
  // Which world direction the ramp climbs towards, and the mesh yaw that gets there.
  '+x': 0,
  '-x': Math.PI,
  '+z': -Math.PI / 2,
  '-z': Math.PI / 2,
};

/** Weathered container / paint colours. */
const PALETTE = {
  red: '#8a2f22',
  blue: '#2d5a8a',
  green: '#3b6b4a',
  orange: '#b86a1f',
  yellow: '#c9a227',
  gray: '#6d7378',
};

/** Triangular prism centred on the origin: low end at -x, high end at +x. */
function createWedgeGeometry(length, height, width) {
  const l = length / 2;
  const h = height / 2;
  const w = width / 2;
  const A = [-l, -h, -w], B = [l, -h, -w], C = [l, h, -w];
  const D = [-l, -h, w], E = [l, -h, w], F = [l, h, w];
  const tris = [
    A, C, B, // -z side
    D, E, F, // +z side
    A, B, E, A, E, D, // bottom
    B, F, E, B, C, F, // high end wall
    A, D, F, A, F, C, // sloped top
  ];
  const positions = new Float32Array(tris.length * 3);
  tris.forEach((v, i) => positions.set(v, i * 3));
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  // Simple planar UVs in metres (1 unit = 1 tile of 2 m) so the hazard stripes keep their scale.
  const uvs = new Float32Array(tris.length * 2);
  tris.forEach((v, i) => {
    uvs[i * 2] = (v[0] + v[2]) / 2;
    uvs[i * 2 + 1] = v[1] / 2;
  });
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geometry.computeVertexNormals(); // Non-indexed => flat shading, which suits hard-edged steel.
  return geometry;
}

/**
 * Box geometry whose UVs are in metres / tileSize, so a texture keeps the same
 * physical scale on every face no matter how big the box is. (Default box UVs
 * stretch the texture 0..1 across each face, which smears long walls.)
 */
function createBoxGeometry(width, height, depth, tileSize) {
  const geometry = new THREE.BoxGeometry(width, height, depth);
  const uv = geometry.attributes.uv;
  // BoxGeometry face order: +x, -x, +y, -y, +z, -z (4 vertices each).
  const faceSize = [[depth, height], [depth, height], [width, depth], [width, depth], [width, height], [width, height]];
  for (let face = 0; face < 6; face++) {
    for (let v = 0; v < 4; v++) {
      const i = face * 4 + v;
      uv.setXY(i, (uv.getX(i) * faceSize[face][0]) / tileSize, (uv.getY(i) * faceSize[face][1]) / tileSize);
    }
  }
  return geometry;
}

export class World {
  constructor(scene, config) {
    this.scene = scene;
    this.config = config;
    this.half = config.arena.half;
    this.sun = null;
    this.group = null;
    this.stepHeight = config.player.stepHeight;
    this.solids = [];
    // Dug holes (DIG SITE): tile "x,z" -> depth in metres. A hole lowers the ground of its whole tile.
    this.depressions = new Map();
    // Set by move(): which axes were blocked. Read right after calling it.
    this.hitX = false;
    this.hitZ = false;

    this.textures = {
      concrete: createConcreteTexture(),
      steel: createSteelTexture(),
      hazard: createHazardTexture(),
    };
    this._buildLights(scene);
    this.build('waves');
  }

  /**
   * (Re)build the level for a mode: 'waves' = the small arena, 'sandbox' = the big open map,
   * 'dig' = an empty walled site that dig-world.js fills in.
   * Everything solid lives in one group so a rebuild is a clean swap. The caller must
   * re-render the (static) shadow map afterwards: renderer.shadowMap.needsUpdate = true.
   */
  build(mode) {
    if (this.group) {
      this.scene.remove(this.group);
      this.group.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
    }
    this.group = new THREE.Group();
    this.scene.add(this.group);
    this.solids = [];
    this.depressions.clear();
    const area = { sandbox: this.config.sandbox, dig: this.config.dig }[mode] ?? this.config.arena;
    this.half = area.half;
    this._fitSun();
    if (mode !== 'dig') this._buildFloor(this.group); // the dig site builds its own ground, tile by tile, so tiles can be dug out
    this._buildWalls(this.group, area.wallHeight);
    if (mode === 'sandbox') this._buildSandboxProps(this.group);
    else if (mode !== 'dig') this._buildProps(this.group); // the dig site brings its own props (dig-world.js)
  }

  _fitSun() {
    const sun = this.sun;
    const k = (this.half + 10) / 40; // 1 for the small arena
    sun.position.set(24 * k, 42 * k, 14 * k);
    const cam = sun.shadow.camera;
    cam.left = cam.bottom = -(this.half + 10);
    cam.right = cam.top = this.half + 10;
    cam.far = 120 * k + 40;
    cam.updateProjectionMatrix();
    const size = this.half > 40 ? 4096 : 2048;
    if (sun.shadow.mapSize.x !== size) {
      sun.shadow.mapSize.set(size, size);
      if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
    }
  }

  /* ----------------------------- construction ----------------------------- */

  _buildLights(scene) {
    scene.add(new THREE.HemisphereLight(0xcfe0f0, 0x6a6a60, 0.35)); // the environment map does most ambient work
    const sun = new THREE.DirectionalLight(0xfff0d6, 3.2);
    sun.position.set(24, 42, 14);
    // Shadows are rendered ONCE (everything that casts is static; see main.js),
    // so they cost nothing per frame. The shadow box covers the whole arena.
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const cam = sun.shadow.camera;
    cam.left = cam.bottom = -40;
    cam.right = cam.top = 40;
    cam.near = 5;
    cam.far = 120;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.04;
    scene.add(sun);
    this.sun = sun;
  }

  _buildFloor(scene) {
    const size = this.half * 2;
    const texture = this.textures.concrete.clone();
    texture.repeat.set(size / 4, size / 4); // 4 m tiles
    texture.needsUpdate = true;
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(size, size),
      material(0xffffff, { map: texture, roughness: 0.92 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);
  }

  _buildWalls(scene, height) {
    const h = this.half;
    const t = 1; // wall thickness, built outside the playable area
    const wall = material(0xb4b6b2, { map: this.textures.concrete, roughness: 0.9 });
    this._addBox(scene, 0, -h - t / 2, h * 2 + t * 2, height, t, wall, 4);
    this._addBox(scene, 0, h + t / 2, h * 2 + t * 2, height, t, wall, 4);
    this._addBox(scene, -h - t / 2, 0, t, height, h * 2, wall, 4);
    this._addBox(scene, h + t / 2, 0, t, height, h * 2, wall, 4);
  }

  _container(color) {
    return material(0xffffff, { map: createCorrugatedTexture(color), roughness: 0.55, metalness: 0.45 });
  }

  _buildProps(scene) {
    const steel = material(0xffffff, { map: this.textures.steel, roughness: 0.5, metalness: 0.7 });
    const hazard = material(0xffffff, { map: this.textures.hazard, roughness: 0.6, metalness: 0.3 });
    const concrete = material(0xc4c6c2, { map: this.textures.concrete, roughness: 0.9 });

    // Two raised steel platforms, each with a hazard-striped ramp.
    this._addBox(scene, -14, -12, 8, 1.2, 6, steel, 2);
    this._addRamp(scene, -10, -5.5, -14, -10, 1.2, '-x', hazard);
    this._addBox(scene, 14, 12, 8, 1.2, 6, steel, 2);
    this._addRamp(scene, 5.5, 10, 10, 14, 1.2, '+x', hazard);

    // Cover pieces of varied height (1.0 can be hopped, 1.5+ blocks you).
    this._addBox(scene, 0, 0, 3, 1.5, 3, this._container(PALETTE.orange), 2);
    this._addBox(scene, -6, 8, 2, 1.0, 6, concrete, 4);
    this._addBox(scene, 8, -8, 6, 1.0, 2, concrete, 4);
    this._addBox(scene, 20, -14, 2.5, 2.5, 2.5, this._container(PALETTE.blue), 2);
    this._addBox(scene, -22, 12, 2.5, 2.5, 2.5, this._container(PALETTE.red), 2);
    this._addBox(scene, 0, -18, 5, 1.2, 1.5, concrete, 4);
    this._addBox(scene, 0, 18, 5, 1.2, 1.5, concrete, 4);
    this._addBox(scene, 22, 0, 1.5, 1.5, 5, this._container(PALETTE.green), 2);
    this._addBox(scene, -24, -2, 1.5, 1.5, 5, this._container(PALETTE.yellow), 2);
  }

  /** The big open map: a clear central plaza ringed by platforms, container yards, walls and ramps. */
  _buildSandboxProps(scene) {
    const steel = material(0xffffff, { map: this.textures.steel, roughness: 0.5, metalness: 0.7 });
    const hazard = material(0xffffff, { map: this.textures.hazard, roughness: 0.6, metalness: 0.3 });
    const concrete = material(0xc4c6c2, { map: this.textures.concrete, roughness: 0.9 });
    const colours = [PALETTE.red, PALETTE.blue, PALETTE.green, PALETTE.orange, PALETTE.yellow, PALETTE.gray];
    const containers = colours.map((c) => this._container(c));

    // Raised steel platforms with ramps, one per quadrant (varied heights; ramps rise 1.2-2.4 m).
    const decks = [[-60, -60, 1.2, '-x'], [60, -55, 1.8, '+x'], [-55, 60, 2.4, '+z'], [62, 58, 1.2, '-z']];
    for (const [x, z, h, dir] of decks) {
      this._addBox(scene, x, z, 14, h, 10, steel, 2);
      const len = h * 4; // gentle slope
      if (dir === '-x') this._addRamp(scene, x - 7 - len, x - 7, z - 3, z + 3, h, '-x', hazard);
      else if (dir === '+x') this._addRamp(scene, x + 7, x + 7 + len, z - 3, z + 3, h, '+x', hazard);
      else if (dir === '+z') this._addRamp(scene, x - 3, x + 3, z + 5, z + 5 + len, h, '+z', hazard);
      else this._addRamp(scene, x - 3, x + 3, z - 5 - len, z - 5, h, '-z', hazard);
    }

    // Stepped pyramid in the north: climbable by jumping.
    for (let i = 0; i < 4; i++) this._addBox(scene, 0, -70, 16 - i * 4, 0.9 * (i + 1), 16 - i * 4, steel, 2);

    // Container yards (deterministic scatter, kept clear of the spawn plaza).
    let seed = 7;
    const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    let placed = 0;
    for (let tries = 0; tries < 400 && placed < 34; tries++) {
      const x = (rand() * 2 - 1) * (this.half - 8);
      const z = (rand() * 2 - 1) * (this.half - 8);
      if (Math.hypot(x, z - 70) < 14) continue; // spawn plaza
      if (Math.abs(x) < 10 && z < -60) continue; // pyramid
      if (decks.some(([dx, dz]) => Math.hypot(x - dx, z - dz) < 24)) continue;
      const w = 2.5 + rand() * 4;
      const d = 2.5 + rand() * 4;
      const h = [1.0, 1.5, 2.5, 2.5][Math.floor(rand() * 4)];
      const mat = rand() < 0.3 ? concrete : containers[Math.floor(rand() * containers.length)];
      this._addBox(scene, x, z, w, h, d, mat, mat === concrete ? 4 : 2);
      placed += 1;
    }

    // Long low walls bordering the plaza and a central landmark.
    this._addBox(scene, -24, 70, 1, 1.2, 14, concrete, 4);
    this._addBox(scene, 24, 70, 1, 1.2, 14, concrete, 4);
    this._addBox(scene, 0, 0, 6, 2.5, 6, containers[3], 2);
  }

  _addBox(scene, cx, cz, width, height, depth, mat, tileSize) {
    const mesh = new THREE.Mesh(createBoxGeometry(width, height, depth, tileSize), mat);
    mesh.position.set(cx, height / 2, cz);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
    this.solids.push({
      minX: cx - width / 2, maxX: cx + width / 2,
      minZ: cz - depth / 2, maxZ: cz + depth / 2,
      height, ramp: null,
    });
  }

  /** A visible solid block (a house) added to the current level. */
  addBlock(cx, cz, width, height, depth, mat) {
    this._addBox(this.group, cx, cz, width, height, depth, mat, 4);
  }

  /** An invisible solid for something that has its own mesh (a hydrant, a pole). */
  addCollider(cx, cz, width, height, depth) {
    this.solids.push({
      minX: cx - width / 2, maxX: cx + width / 2,
      minZ: cz - depth / 2, maxZ: cz + depth / 2,
      height, ramp: null,
    });
  }

  _addRamp(scene, minX, maxX, minZ, maxZ, height, climbs, mat) {
    const alongX = climbs === '+x' || climbs === '-x';
    const length = alongX ? maxX - minX : maxZ - minZ;
    const width = alongX ? maxZ - minZ : maxX - minX;
    const mesh = new THREE.Mesh(createWedgeGeometry(length, height, width), mat);
    mesh.rotation.y = RAMP_DIRECTIONS[climbs];
    mesh.position.set((minX + maxX) / 2, height / 2, (minZ + maxZ) / 2);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
    this.solids.push({ minX, maxX, minZ, maxZ, height, ramp: climbs });
  }

  /* ------------------------------ collision ------------------------------- */

  /** Height of solid `s`'s top surface at (x, z); x/z must already be inside its footprint. */
  _surfaceHeight(s, x, z) {
    if (!s.ramp) return s.height;
    let t;
    switch (s.ramp) {
      case '+x': t = (x - s.minX) / (s.maxX - s.minX); break;
      case '-x': t = (s.maxX - x) / (s.maxX - s.minX); break;
      case '+z': t = (z - s.minZ) / (s.maxZ - s.minZ); break;
      default: t = (s.maxZ - z) / (s.maxZ - s.minZ); break;
    }
    return s.height * t;
  }

  /** Floor height directly beneath a point: 0 on open ground, above 0 on solids, below 0 in a dug hole. */
  groundHeight(x, z) {
    let best = 0;
    for (const s of this.solids) {
      if (x < s.minX || x > s.maxX || z < s.minZ || z > s.maxZ) continue;
      const h = this._surfaceHeight(s, x, z);
      if (h > best) best = h;
    }
    return best > 0 ? best : -this.holeDepth(x, z);
  }

  /** Depth in metres of the hole under a point (0 when there is none). */
  holeDepth(x, z) {
    if (this.depressions.size === 0) return 0;
    return this.depressions.get(this._tileKey(x, z)) ?? 0;
  }

  /** Dig the tile under (x, z) down to `depth` metres; 0 fills it. Used by the DIG SITE. */
  setHoleDepth(x, z, depth) {
    const key = this._tileKey(x, z);
    if (depth > 0) this.depressions.set(key, depth);
    else this.depressions.delete(key);
  }

  /** Fill every hole in (leaving a DIG SITE). */
  clearHoles() {
    this.depressions.clear();
  }

  _tileKey(x, z) {
    return `${Math.floor(x + this.half)},${Math.floor(z + this.half)}`;
  }

  /**
   * True if a vertical cylinder of `radius` standing at (x, z) with feet at `feetY`
   * overlaps a solid whose nearest top surface is higher than a step.
   */
  isBlocked(x, z, radius, feetY) {
    const limit = feetY + this.stepHeight;
    const r2 = radius * radius;
    for (const s of this.solids) {
      // Nearest point of the footprint to the circle centre.
      const nx = x < s.minX ? s.minX : x > s.maxX ? s.maxX : x;
      const nz = z < s.minZ ? s.minZ : z > s.maxZ ? s.maxZ : z;
      const dx = x - nx;
      const dz = z - nz;
      if (dx * dx + dz * dz >= r2) continue;
      if (this._surfaceHeight(s, nx, nz) > limit) return true;
    }
    // The wall of a hole: ground higher than a step above the feet cannot be walked onto from inside it.
    if (this.depressions.size > 0 && feetY < 0 && -this.holeDepth(x, z) > limit) return true;
    return false;
  }

  /**
   * Move `pos` (feet position, mutated) by (dx, dz) one axis at a time so the
   * mover slides along walls. Sets this.hitX / this.hitZ.
   */
  move(pos, dx, dz, radius, feetY) {
    this.hitX = false;
    this.hitZ = false;
    if (dx !== 0) {
      if (this.isBlocked(pos.x + dx, pos.z, radius, feetY)) this.hitX = true;
      else pos.x += dx;
    }
    if (dz !== 0) {
      if (this.isBlocked(pos.x, pos.z + dz, radius, feetY)) this.hitZ = true;
      else pos.z += dz;
    }
  }

  /**
   * Distance along a ray to the nearest solid or the floor, or Infinity.
   * Ramps use their bounding box to find the entry, then march along the ray to
   * find where it actually meets the sloped surface.
   */
  raycast(origin, dir, maxDist) {
    let best = Infinity;

    if (dir.y < 0) {
      const t = -origin.y / dir.y;
      if (t > 0 && t < maxDist) best = t;
    }

    const ox = origin.x, oy = origin.y, oz = origin.z;
    const dx = dir.x, dy = dir.y, dz = dir.z;
    for (const s of this.solids) {
      // Slab test against the solid's bounding box (written out per axis: no per-ray allocations).
      let tMin = 0;
      let tMax = Math.min(maxDist, best);
      if (Math.abs(dx) < 1e-8) { if (ox < s.minX || ox > s.maxX) continue; }
      else {
        let t1 = (s.minX - ox) / dx, t2 = (s.maxX - ox) / dx;
        if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
        if (t1 > tMin) tMin = t1;
        if (t2 < tMax) tMax = t2;
      }
      if (Math.abs(dy) < 1e-8) { if (oy < 0 || oy > s.height) continue; }
      else {
        let t1 = (0 - oy) / dy, t2 = (s.height - oy) / dy;
        if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
        if (t1 > tMin) tMin = t1;
        if (t2 < tMax) tMax = t2;
      }
      if (Math.abs(dz) < 1e-8) { if (oz < s.minZ || oz > s.maxZ) continue; }
      else {
        let t1 = (s.minZ - oz) / dz, t2 = (s.maxZ - oz) / dz;
        if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
        if (t1 > tMin) tMin = t1;
        if (t2 < tMax) tMax = t2;
      }
      if (tMin > tMax || tMin <= 0) continue;

      if (!s.ramp) {
        best = tMin;
        continue;
      }
      for (let t = tMin; t <= tMax; t += 0.15) {
        const x = origin.x + dir.x * t;
        const z = origin.z + dir.z * t;
        const cx = Math.min(Math.max(x, s.minX), s.maxX);
        const cz = Math.min(Math.max(z, s.minZ), s.maxZ);
        if (origin.y + dir.y * t <= this._surfaceHeight(s, cx, cz)) {
          if (t < best) best = t;
          break;
        }
      }
    }
    return best;
  }
}
