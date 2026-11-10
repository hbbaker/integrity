import * as THREE from 'three';
import { material } from '../../core/client/graphics/materials.js';

/*
 * The DIG SITE as it looks to a player: grass, a street, houses, the surface
 * indicators, and the holes players dig. It is built from the server's `dg_map`
 * message, which holds only what is visible on the surface. Buried lines never
 * reach this file until a strike reveals them (see reveal()).
 *
 * Tile (x, z) covers world x in [x - half, x - half + 1): the grid is centred on the origin.
 */

// Paint colours for a revealed line, after the APWA utility colour code.
const LINE_COLORS = {
  electric: 0xe3242b,
  gas: 0xffd800,
  water: 0x2f7bff,
  telecom: 0xff7a1a,
  sewer: 0x2fbf5a,
};

const SIGN_HEIGHT = 0.75;
const METRES_PER_INCH = 0.0254;
const WALL_INSET = 0.002; // pit walls sit just inside their tile so neighbours never overlap
const PIPE_RADIUS = 0.09;
const TILE_TOP = 0.012; // flat markings sit just above the ground
const CURSOR_Y = 0.03;
const HOUSE_HEIGHT = 3.2;

function box(width, height, depth, mat) {
  return new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), mat);
}

function cylinder(radiusTop, radiusBottom, height, mat, segments = 12) {
  return new THREE.Mesh(new THREE.CylinderGeometry(radiusTop, radiusBottom, height, segments), mat);
}

function at(object, x, y, z) {
  object.position.set(x, y, z);
  return object;
}

const MAT = {
  ground: material(0xffffff, { roughness: 1 }), // tinted per tile through instance colours
  asphalt: material(0x2d2f33, { roughness: 0.95 }),
  paint: material(0xe8e2c4, { roughness: 0.8 }),
  wall: material(0xd9d1bc, { roughness: 0.9 }),
  trim: material(0x8a6a4a, { roughness: 0.85 }),
  roof: material(0x7a3b30, { roughness: 0.85 }),
  glass: material(0x8fb4d6, { roughness: 0.15, metalness: 0.2 }),
  door: material(0x5a3a22, { roughness: 0.8 }),
  hydrant: material(0xd1242a, { roughness: 0.5, metalness: 0.3 }),
  steel: material(0x777c83, { roughness: 0.45, metalness: 0.8 }),
  dark: material(0x1a1b1e, { roughness: 0.7, metalness: 0.4 }),
  wood: material(0x5b4026, { roughness: 0.9 }),
  green: material(0x3d6b45, { roughness: 0.6 }),
  concrete: material(0x9a9c98, { roughness: 0.95 }),
  waterLid: material(0x2f6fd6, { roughness: 0.5, metalness: 0.4 }),
  gasBody: material(0xe8c21a, { roughness: 0.5, metalness: 0.3 }),
  flag: material(0xff7a1a, { roughness: 0.7 }),
  dirtWall: material(0x7a5533, { roughness: 1, side: THREE.DoubleSide }),
  dirtFloor: material(0x4d3420, { roughness: 1 }),
  cursorOk: new THREE.MeshBasicMaterial({ color: 0x66ff88, transparent: true, opacity: 0.5, depthWrite: false }),
  cursorNo: new THREE.MeshBasicMaterial({ color: 0xff5555, transparent: true, opacity: 0.5, depthWrite: false }),
};

/** A roof ridge: a four-sided pyramid squashed to the footprint. */
function roofFor(width, depth) {
  const roof = new THREE.Mesh(new THREE.ConeGeometry(0.5, 1, 4), MAT.roof);
  roof.rotation.y = Math.PI / 4;
  roof.scale.set(Math.SQRT2 * width, 1.6, Math.SQRT2 * depth);
  return roof;
}

function buildHouse(rect, facesLargerZ) {
  const width = rect.x1 - rect.x0 + 1;
  const depth = rect.z1 - rect.z0 + 1;
  const height = HOUSE_HEIGHT;
  const group = new THREE.Group();
  group.add(at(box(width, height, depth, MAT.wall), 0, height / 2, 0));
  group.add(at(roofFor(width, depth), 0, height + 0.8, 0));
  const facing = facesLargerZ ? 1 : -1; // which wall holds the door
  const front = (depth / 2 + 0.02) * facing;
  group.add(at(box(1, 2.1, 0.06, MAT.door), 0, 1.05, front));
  for (const offset of [-2.6, 2.6]) {
    group.add(at(box(1.3, 1.1, 0.06, MAT.glass), offset, 1.8, front));
    group.add(at(box(1.4, 0.1, 0.1, MAT.trim), offset, 1.2, front));
  }
  group.add(at(box(2.2, 0.2, 1.1, MAT.concrete), 0, 0.1, front + 0.5 * facing)); // step
  return group;
}

/* Indicator models, each about 1 m across and centred on its tile. */

function buildHydrant() {
  const group = new THREE.Group();
  group.add(at(cylinder(0.16, 0.19, 0.6, MAT.hydrant), 0, 0.3, 0));
  group.add(at(cylinder(0.2, 0.2, 0.06, MAT.hydrant), 0, 0.62, 0));
  group.add(at(new THREE.Mesh(new THREE.SphereGeometry(0.15, 10, 8), MAT.hydrant), 0, 0.7, 0));
  for (const side of [-1, 1]) {
    const nozzle = cylinder(0.06, 0.06, 0.18, MAT.steel);
    nozzle.rotation.z = Math.PI / 2;
    group.add(at(nozzle, side * 0.2, 0.42, 0));
  }
  return group;
}

function buildPole() {
  const group = new THREE.Group();
  group.add(at(cylinder(0.13, 0.17, 6.5, MAT.wood, 8), 0, 3.25, 0));
  group.add(at(box(1.8, 0.12, 0.12, MAT.wood), 0, 6.0, 0)); // crossarm
  const riser = cylinder(0.04, 0.04, 3.4, MAT.steel, 8); // conduit running up the pole to the buried line
  group.add(at(riser, 0.17, 1.7, 0));
  group.add(at(box(0.16, 0.12, 0.16, MAT.steel), 0.17, 0.12, 0));
  return group;
}

function buildDogbox() {
  const group = new THREE.Group();
  group.add(at(box(0.45, 0.9, 0.35, MAT.green), 0, 0.45, 0));
  group.add(at(box(0.5, 0.06, 0.4, MAT.dark), 0, 0.93, 0));
  group.add(at(box(0.3, 0.45, 0.02, MAT.dark), 0, 0.5, 0.18));
  return group;
}

function buildVault() {
  const group = new THREE.Group();
  group.add(at(box(1.1, 0.05, 0.8, MAT.concrete), 0, 0.025, 0));
  group.add(at(box(0.9, 0.03, 0.6, MAT.dark), 0, 0.065, 0));
  group.add(at(box(0.3, 0.02, 0.06, MAT.steel), 0, 0.09, 0));
  return group;
}

function buildWaterMeter() {
  const group = new THREE.Group();
  group.add(at(cylinder(0.28, 0.28, 0.05, MAT.concrete, 16), 0, 0.025, 0));
  group.add(at(cylinder(0.22, 0.22, 0.04, MAT.waterLid, 16), 0, 0.07, 0));
  return group;
}

function buildGasMeter() {
  const group = new THREE.Group();
  group.add(at(box(0.35, 0.4, 0.2, MAT.gasBody), 0, 0.85, 0));
  group.add(at(cylinder(0.025, 0.025, 0.6, MAT.steel, 8), -0.1, 0.35, 0));
  group.add(at(cylinder(0.025, 0.025, 0.6, MAT.steel, 8), 0.1, 0.35, 0));
  return group;
}

function buildGasMarker() {
  const group = new THREE.Group();
  group.add(at(cylinder(0.04, 0.04, 1.1, MAT.gasBody, 8), 0, 0.55, 0));
  group.add(at(box(0.3, 0.2, 0.02, MAT.gasBody), 0, 1.0, 0.04));
  return group;
}

function buildManhole() {
  const group = new THREE.Group();
  group.add(at(cylinder(0.5, 0.5, 0.03, MAT.dark, 20), 0, 0.02, 0));
  group.add(at(cylinder(0.38, 0.38, 0.02, MAT.steel, 20), 0, 0.04, 0));
  return group;
}

function buildDrain() {
  const group = new THREE.Group();
  group.add(at(box(0.8, 0.03, 0.5, MAT.dark), 0, 0.02, 0));
  for (let slat = -3; slat <= 3; slat++) group.add(at(box(0.04, 0.02, 0.44, MAT.steel), slat * 0.1, 0.045, 0));
  return group;
}

/** Builder and (optional) collider for each indicator kind the server can send. */
const INDICATORS = {
  hydrant: { build: buildHydrant, collider: [0.4, 0.8, 0.4] },
  pole: { build: buildPole, collider: [0.4, 6, 0.4] },
  dogbox: { build: buildDogbox, collider: [0.5, 0.9, 0.4] },
  vault: { build: buildVault },
  water_meter: { build: buildWaterMeter },
  gas_meter: { build: buildGasMeter },
  gas_marker: { build: buildGasMarker, collider: [0.3, 1.0, 0.3] },
  manhole: { build: buildManhole },
  drain: { build: buildDrain },
};

/** Canvas texture with a hole's depth written on it, one per distinct text. */
function makeSignTexture(text) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 96;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffd800';
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 8;
  ctx.fillRect(4, 4, 248, 88);
  ctx.strokeRect(4, 4, 248, 88);
  ctx.fillStyle = '#000';
  ctx.font = 'italic 900 56px Impact, "Arial Black", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 128, 52);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

const GRASS_COLOR = new THREE.Color(0x5d8a45);
const ASPHALT_COLOR = new THREE.Color(0x303236);
const tileKey = (x, z) => `${x},${z}`;

/** A small repeatable variation per tile so the lawn is not one flat colour. */
function tileShade(x, z) {
  const hash = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453;
  return 0.92 + 0.16 * (hash - Math.floor(hash));
}

const SIDES = [
  { dx: 0, dz: -1, x: 0, z: -0.5 + WALL_INSET, turn: 0 }, // north wall, faces +z
  { dx: 0, dz: 1, x: 0, z: 0.5 - WALL_INSET, turn: Math.PI }, // south wall, faces -z
  { dx: -1, dz: 0, x: -0.5 + WALL_INSET, z: 0, turn: Math.PI / 2 }, // west wall, faces +x
  { dx: 1, dz: 0, x: 0.5 - WALL_INSET, z: 0, turn: -Math.PI / 2 }, // east wall, faces -x
];

export class DigSite {
  /** @param options { scene, world } */
  constructor({ scene, world }) {
    this.scene = scene;
    this.world = world;
    this.group = new THREE.Group();
    this.holes = new Map(); // "x,z" -> { depth (inches), locked, view }
    this.revealed = new Map(); // "x,z" -> paint mesh
    this.blocked = new Set(); // tiles the server refused as locked (a line is under them that we have not been shown)
    this.decals = new Map(); // "x,z" -> flat marking (road dashes) that must vanish when its tile is dug
    this.buildingTiles = []; // [x0, z0, x1, z1] rectangles, for client-side "cannot dig here"
    this.signTextures = new Map();
    this.paints = new Map(); // revealed-line paint materials, one per utility kind
    this.ground = null; // InstancedMesh: one flat quad per tile, hidden when the tile is dug out
    this.size = 48;
    this.half = 24;
    this._hidden = new THREE.Matrix4().makeScale(0, 0, 0);
    this._matrix = new THREE.Matrix4();
    this.cursor = at(box(1, 0.02, 1, MAT.cursorOk), 0, CURSOR_Y, 0);
    this.cursor.visible = false;
    this.cursor.renderOrder = 5;
  }

  /** Build everything from the server's map message payload (`dg_map.map`). */
  build(map) {
    this.clear();
    this.size = map.w;
    this.half = map.w / 2;
    this.scene.add(this.group);
    this.group.add(this.cursor);

    this._buildGround(map);
    for (const [x0, z0, x1, z1] of map.roads) this._addRoadMarkings(x0, z0, x1, z1);

    this.buildingTiles = map.buildings.map(([x0, z0, x1, z1]) => [x0, z0, x1, z1]);
    for (const [x0, z0, x1, z1, facesLargerZ] of map.buildings) this._addBuilding(x0, z0, x1, z1, !!facesLargerZ);
    for (const indicator of map.indicators) this._addIndicator(indicator);
  }

  /** World position of a tile's centre (on the surface, y = 0). */
  tileCentre(x, z, out = new THREE.Vector3()) {
    return out.set(x + 0.5 - this.half, 0, z + 0.5 - this.half);
  }

  /** The tile containing a world point, or null when it is off the map. */
  tileAt(worldX, worldZ) {
    const x = Math.floor(worldX + this.half);
    const z = Math.floor(worldZ + this.half);
    return x >= 0 && z >= 0 && x < this.size && z < this.size ? { x, z } : null;
  }

  isBuilding(x, z) {
    return this.buildingTiles.some(([x0, z0, x1, z1]) => x >= x0 && x <= x1 && z >= z0 && z <= z1);
  }

  holeAt(x, z) {
    return this.holes.get(tileKey(x, z)) ?? { depth: 0, locked: false };
  }

  isLocked(x, z) {
    return this.holeAt(x, z).locked || this.revealed.has(tileKey(x, z)) || this.blocked.has(tileKey(x, z));
  }

  /**
   * A dig result for a tile: take the tile out of the ground and make the hole `depth` inches deep.
   * A strike also passes the struck line's kind and the tiles revealed with it, so the pipe shows in the pit.
   */
  setHole(x, z, depth, { struck = false, kind = null, line = null } = {}) {
    const key = tileKey(x, z);
    let hole = this.holes.get(key);
    if (!hole) {
      hole = { depth: 0, locked: false, view: this._createHoleView(x, z) };
      this.holes.set(key, hole);
      this._setGroundVisible(x, z, false);
      this.decals.get(key)?.removeFromParent();
    }
    hole.depth = depth;
    hole.locked = hole.locked || struck;
    this.world.setHoleDepth(...this._worldXZ(x, z), depth * METRES_PER_INCH); // the player can now fall in
    if (struck && kind) this._showPipe(hole.view, kind, line, depth);
    this._refreshPit(x, z);
    for (const side of SIDES) this._refreshPit(x + side.dx, z + side.dz); // neighbours: their shared wall may now be hidden or shown
  }

  markBlocked(x, z) {
    this.blocked.add(tileKey(x, z));
  }

  /** Paint a struck utility on the ground for everyone: `tiles` are [x, z] pairs. */
  reveal(tiles, kind) {
    const paintMaterial = this._paintFor(kind);
    for (const [x, z] of tiles) {
      const key = tileKey(x, z);
      if (this.revealed.has(key) || (this.holes.get(key)?.depth ?? 0) > 0) continue; // a dug tile shows its pipe in the pit instead
      const paint = at(box(0.9, 0.012, 0.9, paintMaterial), 0, TILE_TOP + 0.004, 0);
      paint.position.add(this.tileCentre(x, z));
      this.group.add(paint);
      this.revealed.set(key, paint);
    }
  }

  _paintFor(kind) {
    if (!this.paints.has(kind)) {
      const color = LINE_COLORS[kind] ?? 0xffffff;
      this.paints.set(kind, material(color, { roughness: 0.6, emissive: color, emissiveIntensity: 0.35 }));
    }
    return this.paints.get(kind);
  }

  /** Show the dig cursor on a tile (or hide it with null). `ok` colours it green or red. */
  setCursor(tile, ok) {
    this.cursor.visible = !!tile;
    if (!tile) return;
    this.tileCentre(tile.x, tile.z, this.cursor.position);
    this.cursor.position.y = CURSOR_Y - this.holeAt(tile.x, tile.z).depth * METRES_PER_INCH; // on the floor of a hole
    this.cursor.material = ok ? MAT.cursorOk : MAT.cursorNo;
  }

  /** Remove everything this site added (back to the menu). */
  clear() {
    this.scene.remove(this.group);
    this.group.traverse((object) => { if (object.geometry && object !== this.cursor) object.geometry.dispose(); });
    this.group = new THREE.Group();
    this.holes.clear();
    this.revealed.clear();
    this.blocked.clear();
    this.decals.clear();
    this.buildingTiles = [];
    this.ground = null;
    this.world.clearHoles();
    for (const texture of this.signTextures.values()) texture.dispose();
    this.signTextures.clear();
  }

  /* ------------------------------- internals ------------------------------ */

  _worldXZ(x, z) {
    return [x + 0.5 - this.half, z + 0.5 - this.half];
  }

  /** One quad per tile in a single InstancedMesh, tinted grass or asphalt. A dug tile's quad is scaled away. */
  _buildGround(map) {
    const geometry = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    this.ground = new THREE.InstancedMesh(geometry, MAT.ground, map.w * map.h);
    this.ground.receiveShadow = true;
    const color = new THREE.Color();
    for (let z = 0; z < map.h; z++) {
      for (let x = 0; x < map.w; x++) {
        const index = z * map.w + x;
        const onRoad = map.roads.some(([x0, z0, x1, z1]) => x >= x0 && x <= x1 && z >= z0 && z <= z1);
        color.copy(onRoad ? ASPHALT_COLOR : GRASS_COLOR).multiplyScalar(onRoad ? 1 : tileShade(x, z));
        this.ground.setColorAt(index, color);
        const [worldX, worldZ] = this._worldXZ(x, z);
        this.ground.setMatrixAt(index, this._matrix.makeTranslation(worldX, 0, worldZ));
      }
    }
    this.ground.instanceMatrix.needsUpdate = true;
    this.ground.instanceColor.needsUpdate = true;
    this.group.add(this.ground);
  }

  _setGroundVisible(x, z, visible) {
    const index = z * this.size + x;
    const [worldX, worldZ] = this._worldXZ(x, z);
    this.ground.setMatrixAt(index, visible ? this._matrix.makeTranslation(worldX, 0, worldZ) : this._hidden);
    this.ground.instanceMatrix.needsUpdate = true;
  }

  /** The dashed centre line down the middle of a road. */
  _addRoadMarkings(x0, z0, x1, z1) {
    const centreZ = (z0 + z1 + 1) / 2 - this.half;
    const row = Math.floor((z0 + z1) / 2);
    for (let x = x0 + 1; x < x1; x += 3) {
      const dash = at(box(1.4, 0.005, 0.14, MAT.paint), x + 0.5 - this.half, 0.0125, centreZ);
      this.group.add(dash);
      this.decals.set(tileKey(x, row), dash); // the dash straddles two tile rows: digging either removes it
      this.decals.set(tileKey(x, row + 1), dash);
    }
  }

  _addBuilding(x0, z0, x1, z1, facesLargerZ) {
    const house = buildHouse({ x0, z0, x1, z1 }, facesLargerZ);
    const width = x1 - x0 + 1;
    const depth = z1 - z0 + 1;
    house.position.set(x0 + width / 2 - this.half, 0, z0 + depth / 2 - this.half);
    house.traverse((object) => { object.castShadow = true; object.receiveShadow = true; });
    this.group.add(house);
    this.world.addCollider(house.position.x, house.position.z, width, HOUSE_HEIGHT, depth);
  }

  _addIndicator({ k, x, z }) {
    const kind = INDICATORS[k];
    if (!kind) return;
    const model = kind.build();
    this.tileCentre(x, z, model.position);
    model.traverse((object) => { object.castShadow = true; });
    this.group.add(model);
    if (kind.collider) this.world.addCollider(model.position.x, model.position.z, ...kind.collider);
  }

  /** The meshes of one hole: four walls, a floor, a depth sign, a flag for a struck hole, and a pipe slot. */
  _createHoleView(x, z) {
    const view = new THREE.Group();
    this.tileCentre(x, z, view.position);
    view.walls = SIDES.map((side) => {
      const wall = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), MAT.dirtWall);
      wall.position.x = side.x;
      wall.position.z = side.z;
      wall.rotation.y = side.turn;
      view.add(wall);
      return wall;
    });
    view.floor = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), MAT.dirtFloor);
    view.add(view.floor);
    view.sign = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthWrite: false }));
    view.sign.scale.set(0.9, 0.34, 1);
    view.sign.position.set(0, SIGN_HEIGHT, 0);
    view.add(view.sign);
    view.flag = new THREE.Group();
    view.flag.add(at(cylinder(0.012, 0.012, 0.9, MAT.steel, 6), 0, 0.45, 0), at(box(0.28, 0.18, 0.01, MAT.flag), 0.14, 0.8, 0));
    view.flag.position.set(0.42, 0, 0.42);
    view.flag.visible = false;
    view.add(view.flag);
    view.pipe = null;
    this.group.add(view);
    return view;
  }

  /** Size the walls and floor to the hole's depth and to how deep its neighbours are. */
  _refreshPit(x, z) {
    const hole = this.holes.get(tileKey(x, z));
    if (!hole) return;
    const { view } = hole;
    const depth = hole.depth * METRES_PER_INCH;
    SIDES.forEach((side, index) => {
      const neighbour = (this.holes.get(tileKey(x + side.dx, z + side.dz))?.depth ?? 0) * METRES_PER_INCH;
      const wall = view.walls[index];
      const height = depth - neighbour; // only the part of the wall that is not open to the next hole
      wall.visible = height > 0.001;
      if (wall.visible) {
        wall.scale.y = height;
        wall.position.y = -(depth + neighbour) / 2;
      }
    });
    view.floor.position.y = -depth + 0.002;
    view.flag.visible = hole.locked;
    const text = `${hole.depth} IN`;
    if (!this.signTextures.has(text)) this.signTextures.set(text, makeSignTexture(text));
    view.sign.material.map = this.signTextures.get(text);
    view.sign.material.needsUpdate = true;
    if (view.pipe) view.pipe.position.y = -depth + PIPE_RADIUS;
  }

  /** A struck line lies across the pit floor, in its utility colour. */
  _showPipe(view, kind, revealed, depthInches) {
    if (view.pipe) return;
    const alongX = !revealed || revealed.length < 2 || revealed.every(([, tileZ]) => tileZ === revealed[0][1]);
    const pipe = cylinder(PIPE_RADIUS, PIPE_RADIUS, 1, this._paintFor(kind), 10);
    pipe.rotation.z = alongX ? Math.PI / 2 : 0;
    pipe.rotation.x = alongX ? 0 : Math.PI / 2;
    pipe.position.y = -depthInches * METRES_PER_INCH + PIPE_RADIUS;
    view.add(pipe);
    view.pipe = pipe;
  }
}
