import * as THREE from 'three';
import { material } from '../../core/client/graphics/materials.js';
import { surfaceMaterial } from '../../core/client/graphics/surfaces.js';
import { box, barrelPart, at } from '../../core/client/combat/viewmodel-parts.js';
import { buildRaygun, glowColor } from './raygun.js';

/*
 * CABLE BOTS holdable models: the first-person look of every item in the hands. Each builder returns
 * { root, muzzle, home, parts }; barrels point down -Z. The system that shows them is in
 * core/client/combat/holdable-system.js.
 */

// Shared materials (never modified per instance, so one set serves every model).
const MAT = {
  metal: surfaceMaterial('brushed', { color: '#30343a', metalness: 0.85, roughness: 0.38, bumpScale: 2.2 }),
  steel: surfaceMaterial('brushed', { color: '#80868e', metalness: 0.9, roughness: 0.3, bumpScale: 1.6 }),
  polymer: surfaceMaterial('weave', { color: '#1f2126', metalness: 0.2, roughness: 0.55, bumpScale: 2.5 }),
  wood: material(0x6b4423, { roughness: 0.65 }),
  brass: material(0xb08a2e, { metalness: 0.9, roughness: 0.3 }),
  accent: surfaceMaterial('circuit', { color: '#2a1466', glow: ['#00f0ff', '#ff2bd6', '#3dff9a'], metalness: 0.4, roughness: 0.45, bumpScale: 3, emissiveIntensity: 1.8 }), // telecom circuitry that glows
  hazard: surfaceMaterial('plate', { color: '#f2c200', glow: '#3dff9a', metalness: 0.35, roughness: 0.42, bumpScale: 2.8 }), // construction-yellow armour plating with seam lights
  orange: surfaceMaterial('plate', { color: '#ff6a00', glow: '#ff2bd6', metalness: 0.3, roughness: 0.45, bumpScale: 2.8 }),
  rubber: surfaceMaterial('rubber', { color: '#15161a', metalness: 0, roughness: 0.85, bumpScale: 3 }),
  hose: material(0x1f6fd6, { roughness: 0.5 }), // air hose
  glove: material(0x0b0d0c, { metalness: 0.85, roughness: 0.34 }), // black cybernetic hand
  sleeve: material(0x1d2421, { metalness: 0.8, roughness: 0.4 }), // dark armoured forearm
  glow: new THREE.MeshStandardMaterial({ color: 0x04120a, emissive: 0x2dff6a, emissiveIntensity: 1.8, roughness: 0.4 }),
};

/** Jacket sleeve from the wrist (origin) along `dir` (gun space), wide end away from the hand. */
function makeSleeve(dir) {
  const length = 0.8;
  const direction = new THREE.Vector3(...dir).normalize();
  const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.064, 0.046, length, 10), MAT.sleeve);
  // The cylinder's +Y axis is its wide (elbow) end; point it along `direction`.
  sleeve.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction);
  sleeve.position.copy(direction).multiplyScalar(length / 2);
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.067, 0.067, 0.02, 12), MAT.glow); // glowing green ring
  band.quaternion.copy(sleeve.quaternion);
  band.position.copy(direction).multiplyScalar(0.14);
  const group = new THREE.Group();
  group.add(sleeve, band);
  return group;
}

/**
 * First-person arm: a black cybernetic hand (palm, curled fingers, thumb) plus an armoured
 * forearm that runs from the wrist back toward the camera and out of the frame.
 *
 * The group's origin is the wrist. `palmRoll` rotates the hand about Z so the palm
 * can face a vertical grip (+/- 90 degrees) or wrap under a horizontal barrel
 * (180 degrees). `sleeveDir` is the sleeve's direction in the gun's space; it is
 * a separate child so it is NOT rotated with the hand.
 */
let BUILD_ARMS = true; // false while building the third-person copies (the cyborg has its own arms)

function makeArm(side, palmRoll, sleeveDir) {
  const arm = new THREE.Group();
  if (!BUILD_ARMS) return arm;
  const hand = new THREE.Group();
  hand.add(box(0.08, 0.045, 0.095, MAT.glove));
  const fingers = at(box(0.08, 0.04, 0.055, MAT.glove), 0, -0.027, -0.07);
  fingers.rotation.x = 0.7; // curled around whatever is being held
  const thumb = at(box(0.024, 0.028, 0.06, MAT.glove), -side * 0.05, 0.005, -0.03);
  thumb.rotation.y = side * 0.4;
  hand.add(fingers, thumb, at(box(0.05, 0.008, 0.05, MAT.glow), 0, 0.027, 0)); // knuckle light
  hand.rotation.z = palmRoll;
  arm.add(hand);

  arm.add(makeSleeve(sleeveDir));
  return arm;
}

/* Each builder returns { root, muzzle, home, parts }. Barrels point down -Z. */

function buildPistol() {
  const root = new THREE.Group();
  const grip = at(box(0.055, 0.15, 0.07, MAT.rubber), 0, -0.085, 0.045);
  grip.rotation.x = 0.2;
  const rightArm = at(makeArm(1, -Math.PI / 2, [0.25, -0.5, 1]), 0.052, -0.09, 0.05);
  const leftArm = at(makeArm(-1, Math.PI / 2, [-0.25, -0.5, 1]), -0.052, -0.11, 0.04);
  const strip = at(box(0.03, 0.04, 0.2, MAT.brass), 0, -0.04, -0.1); // strip of nails
  strip.rotation.x = -0.12;
  root.add(
    at(box(0.062, 0.07, 0.3, MAT.hazard), 0, 0.04, -0.1), // yellow housing
    at(box(0.064, 0.012, 0.12, MAT.orange), 0, 0.072, -0.05), // orange cap, below the sight line
    at(box(0.058, 0.045, 0.26, MAT.metal), 0, -0.002, -0.08), // frame
    grip,
    strip,
    at(box(0.01, 0.02, 0.01, MAT.steel), 0, 0.083, -0.24), // front sight
    at(box(0.032, 0.02, 0.012, MAT.steel), 0, 0.083, 0.05), // rear sight (tops of both sights line up for ADS)
    at(box(0.03, 0.03, 0.05, MAT.steel), 0, 0.04, -0.27), // nose piece
    at(barrelPart(0.01, 0.07, MAT.hose), 0, -0.16, 0.08), // air hose stub under the grip
    rightArm,
    leftArm,
  );
  const muzzle = at(new THREE.Object3D(), 0, 0.04, -0.29);
  root.add(muzzle);
  return { root, muzzle, home: { x: 0.2, y: -0.2, z: -0.42 }, parts: { support: { object: leftArm, baseY: leftArm.position.y } } };
}

function buildShotgun() {
  const root = new THREE.Group();
  const pump = at(box(0.075, 0.06, 0.2, MAT.orange), 0, -0.045, -0.25);
  const leftArm = at(makeArm(-1, Math.PI, [-0.3, -0.35, 1]), 0, -0.055, 0); // palm up, wrapped under the pump
  pump.add(leftArm);
  const rightArm = at(makeArm(1, -Math.PI / 2, [0.3, -0.45, 1]), 0.05, -0.09, 0.22);
  root.add(
    at(barrelPart(0.022, 0.75, MAT.metal), 0, 0.02, -0.3),
    at(barrelPart(0.018, 0.5, MAT.steel), 0, -0.025, -0.18), // magazine tube
    at(box(0.075, 0.095, 0.3, MAT.hazard), 0, 0, 0.1), // yellow housing
    pump,
    at(box(0.055, 0.12, 0.06, MAT.rubber), 0, -0.085, 0.21), // pistol grip
    at(box(0.06, 0.11, 0.3, MAT.hazard), 0, -0.03, 0.4), // stock
    at(box(0.062, 0.01, 0.1, MAT.rubber), 0, 0.054, 0.1), // hazard stripe
    at(barrelPart(0.026, 0.12, MAT.steel), 0, 0.02, -0.5), // steel shroud, kept under the sight line
    at(box(0.03, 0.05, 0.05, MAT.hose), 0.055, 0.0, 0.2), // air fitting on the side
    at(box(0.01, 0.015, 0.01, MAT.brass), 0, 0.045, -0.66), // bead sight
    rightArm,
  );
  const muzzle = at(new THREE.Object3D(), 0, 0.02, -0.68);
  root.add(muzzle);
  return {
    root, muzzle, home: { x: 0.2, y: -0.2, z: -0.4 },
    parts: { pump, pumpBaseZ: pump.position.z, support: { object: leftArm, baseY: leftArm.position.y } },
  };
}

function buildSmg() {
  const root = new THREE.Group();
  const mag = new THREE.Group(); // coil of nails: a flat drum below the receiver
  const drum = barrelPart(0.1, 0.06, MAT.hazard);
  drum.rotation.set(0, 0, Math.PI / 2);
  mag.add(drum, at(barrelPart(0.045, 0.07, MAT.steel), 0, 0, 0), at(box(0.04, 0.05, 0.14, MAT.brass), 0, 0.1, -0.06));
  mag.position.set(0, -0.15, -0.05);
  const grip = at(box(0.055, 0.13, 0.065, MAT.polymer), 0, -0.1, 0.13);
  grip.rotation.x = 0.15;
  const rightArm = at(makeArm(1, -Math.PI / 2, [0.3, -0.45, 1]), 0.052, -0.1, 0.13);
  const leftArm = at(makeArm(-1, Math.PI, [-0.3, -0.35, 1]), 0, -0.07, -0.19); // under the handguard
  root.add(
    at(box(0.07, 0.1, 0.4, MAT.hazard), 0, 0, 0), // yellow housing
    at(box(0.074, 0.06, 0.2, MAT.metal), 0, -0.01, -0.22), // nose
    at(barrelPart(0.015, 0.2, MAT.steel), 0, 0.01, -0.4),
    mag,
    grip,
    at(box(0.045, 0.06, 0.2, MAT.rubber), 0, 0, 0.3), // handle
    at(box(0.03, 0.03, 0.08, MAT.steel), 0, 0.065, -0.05), // rear sight
    at(box(0.01, 0.055, 0.01, MAT.steel), 0, 0.0525, -0.5), // front post
    at(box(0.072, 0.012, 0.15, MAT.orange), 0, 0.052, -0.2),
    rightArm,
    leftArm,
  );
  const muzzle = at(new THREE.Object3D(), 0, 0.01, -0.5);
  root.add(muzzle);
  return {
    root, muzzle, home: { x: 0.2, y: -0.2, z: -0.4 },
    parts: { mag, magBaseY: mag.position.y, support: { object: leftArm, baseY: leftArm.position.y } },
  };
}

function buildSniper() {
  const root = new THREE.Group();
  const lens = new THREE.MeshStandardMaterial({ color: 0x2a6bff, metalness: 0.3, roughness: 0.05, emissive: 0x0a2a88, emissiveIntensity: 0.6 });
  const boltHandle = new THREE.Group(); // slides back and lifts when cycled
  boltHandle.add(
    at(barrelPart(0.008, 0.07, MAT.steel), 0.045, -0.02, 0), // arm sticking out to the right
    at(new THREE.Mesh(new THREE.SphereGeometry(0.016, 10, 8), MAT.steel), 0.08, -0.03, 0),
  );
  boltHandle.children[0].rotation.set(0, 0, Math.PI / 2); // lay the arm along X
  boltHandle.position.set(0, 0.02, 0.12);
  const leftArm = at(makeArm(-1, Math.PI, [-0.3, -0.35, 1]), 0, -0.1, -0.25); // palm up under the forend
  const rightArm = at(makeArm(1, -Math.PI / 2, [0.3, -0.45, 1]), 0.05, -0.09, 0.22);
  root.add(
    at(barrelPart(0.014, 0.75, MAT.metal), 0, 0.02, -0.52), // long barrel
    at(barrelPart(0.021, 0.09, MAT.steel), 0, 0.02, -0.9), // muzzle brake
    at(box(0.06, 0.09, 0.36, MAT.hazard), 0, 0, 0.08), // receiver
    at(box(0.056, 0.07, 0.34, MAT.hazard), 0, -0.02, -0.3), // forend
    at(box(0.05, 0.1, 0.07, MAT.metal), 0, -0.085, 0.0), // magazine
    at(box(0.05, 0.12, 0.055, MAT.rubber), 0, -0.085, 0.21), // grip
    at(box(0.055, 0.12, 0.34, MAT.hazard), 0, -0.02, 0.45), // stock
    at(box(0.058, 0.03, 0.12, MAT.orange), 0, 0.075, 0.5), // cheek rest
    // Scope: a tube on two mounts with a bigger objective bell at the front.
    at(barrelPart(0.026, 0.3, MAT.metal), 0, 0.09, 0.0),
    at(barrelPart(0.036, 0.09, MAT.metal), 0, 0.09, -0.19),
    at(barrelPart(0.03, 0.02, lens), 0, 0.09, -0.24),
    at(barrelPart(0.022, 0.02, lens), 0, 0.09, 0.15),
    at(box(0.02, 0.04, 0.04, MAT.steel), 0, 0.057, -0.08),
    at(box(0.02, 0.04, 0.04, MAT.steel), 0, 0.057, 0.08),
    boltHandle,
    rightArm,
    leftArm,
  );
  const muzzle = at(new THREE.Object3D(), 0, 0.02, -0.96);
  root.add(muzzle);
  return {
    root, muzzle, home: { x: 0.2, y: -0.2, z: -0.4 },
    parts: { bolt: boltHandle, boltBaseZ: boltHandle.position.z, support: { object: leftArm, baseY: leftArm.position.y } },
  };
}

/** The fiber reel: a yellow launcher with a spool of purple fibre on top that spins while the cable is out. */
function buildFiberReel() {
  const root = new THREE.Group();
  const grip = at(box(0.055, 0.15, 0.07, MAT.rubber), 0, -0.085, 0.045);
  grip.rotation.x = 0.2;
  const rightArm = at(makeArm(1, -Math.PI / 2, [0.25, -0.5, 1]), 0.052, -0.09, 0.05);
  const leftArm = at(makeArm(-1, Math.PI / 2, [-0.25, -0.5, 1]), -0.052, -0.11, 0.04);

  const spool = new THREE.Group(); // spins about the X axis
  const fibre = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.07, 16), MAT.accent);
  fibre.rotation.z = Math.PI / 2;
  spool.add(fibre);
  for (const side of [-1, 1]) {
    const flange = new THREE.Mesh(new THREE.CylinderGeometry(0.078, 0.078, 0.01, 16), MAT.steel);
    flange.rotation.z = Math.PI / 2;
    flange.position.x = side * 0.04;
    spool.add(flange);
  }
  spool.add(at(box(0.075, 0.012, 0.03, MAT.orange), 0, 0.06, 0)); // a marker, so the spin is visible
  spool.position.set(0, 0.105, -0.07);

  root.add(
    at(box(0.07, 0.09, 0.3, MAT.hazard), 0, 0.03, -0.1), // yellow housing
    at(box(0.074, 0.02, 0.1, MAT.orange), 0, 0.0, -0.05), // orange band
    grip,
    at(barrelPart(0.024, 0.14, MAT.steel), 0, 0.03, -0.3), // nozzle
    at(barrelPart(0.034, 0.03, MAT.metal), 0, 0.03, -0.37), // flared tip
    at(barrelPart(0.01, 0.07, MAT.hose), 0, -0.16, 0.08), // air hose stub under the grip
    spool,
    rightArm,
    leftArm,
  );
  const muzzle = at(new THREE.Object3D(), 0, 0.03, -0.39);
  root.add(muzzle);
  return {
    root, muzzle, home: { x: 0.2, y: -0.2, z: -0.42 },
    parts: { support: { object: leftArm, baseY: leftArm.position.y } },
    animate(dt, time, state) {
      if (state.active) spool.rotation.x -= dt * 16;
    },
  };
}

function buildShovel() {
  const root = new THREE.Group();
  const shaft = at(barrelPart(0.017, 1.0, MAT.wood), 0, 0, -0.25);
  const handle = at(box(0.2, 0.03, 0.03, MAT.wood), 0, 0, 0.26); // D-grip across the top
  const blade = at(box(0.17, 0.012, 0.24, MAT.steel), 0, -0.01, -0.84); // steel blade, tilted down
  blade.rotation.x = 0.35;
  const collar = at(box(0.045, 0.045, 0.1, MAT.steel), 0, 0, -0.74); // socket where the blade meets the shaft
  const leftArm = at(makeArm(-1, Math.PI, [-0.3, -0.35, 1]), 0, -0.03, -0.18); // palm up under the shaft
  const rightArm = at(makeArm(1, -Math.PI / 2, [0.3, -0.45, 1]), 0.04, -0.03, 0.2);
  root.add(shaft, handle, collar, blade, rightArm, leftArm);
  return {
    root, muzzle: null, home: { x: 0.2, y: -0.22, z: -0.4 },
    parts: { support: { object: leftArm, baseY: leftArm.position.y } },
  };
}

function buildFists() {
  const root = new THREE.Group();
  const hands = [];
  for (const side of [-1, 1]) {
    const hand = new THREE.Group();
    hand.add(
      box(0.085, 0.085, 0.11, MAT.glove), // fist
      at(box(0.09, 0.02, 0.03, MAT.hazard), 0, 0.035, -0.06), // hi-vis knuckle guard
      at(box(0.03, 0.04, 0.06, MAT.glove), -side * 0.05, 0.0, -0.01),
    );
    hand.add(makeSleeve([side * 0.2, -0.3, 1]));
    hand.position.set(side * 0.2, -0.22, -0.38);
    hand.userData.base = hand.position.clone();
    hand.userData.side = side;
    root.add(hand);
    hands.push(hand);
  }
  return { root, muzzle: null, home: { x: 0, y: 0, z: 0 }, parts: { hands } };
}

/**
 * Model definitions by item id:
 *   build()       the first-person model
 *   held: false   the third-person character holds nothing for this item (the fists)
 *   beamColor     for beam weapons: (power, outColor) -> colour
 */
export const HOLDABLE_MODELS = {
  fists: { build: buildFists, held: false },
  pistol: { build: buildPistol },
  shotgun: { build: buildShotgun },
  smg: { build: buildSmg },
  sniper: { build: buildSniper },
  shovel: { build: buildShovel },
  reel: { build: buildFiberReel },
  raygun: { build: () => buildRaygun(makeArm), beamColor: glowColor },
};

/** An item model with no first-person hands or sleeves, for the third-person character to hold. Null when it holds nothing. */
export function buildHeldModel(id) {
  const def = HOLDABLE_MODELS[id];
  if (def.held === false) return null;
  BUILD_ARMS = false;
  try {
    return def.build();
  } finally {
    BUILD_ARMS = true;
  }
}
