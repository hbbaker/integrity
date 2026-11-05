import * as THREE from 'three';
import { material } from './effects.js';

/*
 * XENO RAY: an organic alien raygun with no hard edges. Everything is a lathe,
 * tube, torus, sphere or capsule: a teardrop body, a flared emitter horn with three
 * curved prongs around a glowing orb, glowing coil rings, a glowing vein spiralling
 * along the body, a glass energy chamber whose level shows the charge, and a
 * swept grip with tail fins.
 *
 * Barrels point down -Z (the lathe axis is rotated so +profile-y runs to the muzzle).
 * The glow colour follows the beam's power: alien green at full power, fading to
 * amber as the timed falloff eats into it.
 */

const GREEN = new THREE.Color(0x4dffb0);
const AMBER = new THREE.Color(0xff8f2e);

/** Beam / glow colour for a power level 0..1. */
export function glowColor(power, out) {
  return out.copy(AMBER).lerp(GREEN, power);
}

/** Lathe from [radius, alongAxis] points, with the axis rotated to run toward -Z. */
function lathe(points, segments = 32) {
  const geometry = new THREE.LatheGeometry(points.map(([r, y]) => new THREE.Vector2(r, y)), segments);
  geometry.rotateX(-Math.PI / 2);
  return geometry;
}

/** Soft pulses along u: scrolled over the vein so light appears to travel down it. */
function createPulseTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 8;
  const ctx = canvas.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 128, 0);
  g.addColorStop(0, '#202020');
  g.addColorStop(0.35, '#ffffff');
  g.addColorStop(0.5, '#303030');
  g.addColorStop(1, '#202020');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 8);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(5, 1);
  return texture;
}

function glowMaterial(intensity) {
  return new THREE.MeshStandardMaterial({
    color: 0x07130f, emissive: GREEN.clone(), emissiveIntensity: intensity, roughness: 0.35, metalness: 0.2,
  });
}

function at(object, x, y, z) {
  object.position.set(x, y, z);
  return object;
}

const damp = (current, target, rate, dt) => current + (target - current) * (1 - Math.exp(-rate * dt));

/**
 * @param makeArm  the shared first-person arm builder from weapons.js
 * Returns { root, muzzle, home, parts, animate(dt, time, state) } where state is
 * { firing, energy 0..1, power 0..1, reloading }.
 */
export function buildRaygun(makeArm) {
  const root = new THREE.Group();

  const bodyMat = new THREE.MeshPhysicalMaterial({
    color: 0x2b2f4a, metalness: 0.85, roughness: 0.28,
    clearcoat: 1, clearcoatRoughness: 0.15, iridescence: 0.8, iridescenceIOR: 1.6,
  });
  const darkMat = material(0x14161f, { metalness: 0.7, roughness: 0.4 });
  const glassMat = new THREE.MeshPhysicalMaterial({
    color: 0xaaffe0, transparent: true, opacity: 0.28, roughness: 0.05, metalness: 0, clearcoat: 1,
  });

  // Teardrop body, then the emitter horn that flares from its front.
  const body = new THREE.Mesh(lathe([
    [0.001, -0.2], [0.022, -0.198], [0.04, -0.185], [0.054, -0.16], [0.062, -0.12], [0.064, -0.07],
    [0.06, -0.02], [0.052, 0.03], [0.044, 0.08], [0.04, 0.12], [0.038, 0.16],
  ]), bodyMat);
  const horn = at(new THREE.Mesh(lathe([
    [0.037, 0], [0.035, 0.03], [0.042, 0.06], [0.056, 0.09], [0.07, 0.115], [0.073, 0.127], [0.064, 0.128],
  ]), bodyMat), 0, 0, -0.16);
  root.add(body, horn);

  // Glowing emitter orb with three curved prongs that slowly spin around it.
  const orbMat = glowMaterial(3);
  const orb = at(new THREE.Mesh(new THREE.SphereGeometry(0.034, 20, 14), orbMat), 0, 0, -0.205);
  const prongMat = glowMaterial(1.5);
  const prongs = new THREE.Group();
  prongs.position.z = 0;
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    const point = (r, z) => new THREE.Vector3(Math.cos(a) * r, Math.sin(a) * r, z);
    const curve = new THREE.CatmullRomCurve3([point(0.045, -0.17), point(0.088, -0.23), point(0.05, -0.335)]);
    prongs.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 20, 0.0065, 6), prongMat));
  }
  root.add(orb, prongs);

  // Glowing coil rings around the body; their light chases down the barrel.
  const coilSpecs = [[-0.09, 0.066], [-0.04, 0.064], [0.01, 0.057], [0.06, 0.049], [0.1, 0.043]]; // [along, radius]
  const coils = coilSpecs.map(([along, radius]) => {
    const mat = glowMaterial(1);
    const ring = at(new THREE.Mesh(new THREE.TorusGeometry(radius + 0.004, 0.0075, 8, 28), mat), 0, 0, -along);
    root.add(ring);
    return mat;
  });

  // A vein spiralling along the body with pulses of light travelling down it.
  const pulseTexture = createPulseTexture();
  const veinMat = new THREE.MeshStandardMaterial({
    color: 0x07130f, emissive: GREEN.clone(), emissiveMap: pulseTexture, emissiveIntensity: 2.2, roughness: 0.4,
  });
  const veinPoints = [];
  for (let i = 0; i <= 40; i++) {
    const t = i / 40;
    const along = -0.17 + t * 0.3;
    const angle = 0.6 + t * Math.PI * 3;
    const r = 0.06 - t * 0.014 + 0.0015;
    veinPoints.push(new THREE.Vector3(Math.cos(angle) * r, Math.sin(angle) * r, -along));
  }
  root.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(veinPoints), 120, 0.0038, 6), veinMat));

  // Glass energy chamber on the near (left) side. The core's length shows the charge.
  const chamber = new THREE.Group();
  chamber.position.set(-0.066, 0.012, -0.02);
  chamber.rotation.x = Math.PI / 2; // capsule axis -> along the barrel
  chamber.add(new THREE.Mesh(new THREE.CapsuleGeometry(0.02, 0.085, 6, 14), glassMat));
  const coreMat = glowMaterial(2);
  const core = new THREE.Mesh(new THREE.CapsuleGeometry(0.0125, 0.07, 6, 12), coreMat);
  chamber.add(core);
  chamber.add(at(new THREE.Mesh(new THREE.TorusGeometry(0.021, 0.0045, 6, 16), darkMat), 0, 0.05, 0).rotateX(Math.PI / 2));
  chamber.add(at(new THREE.Mesh(new THREE.TorusGeometry(0.021, 0.0045, 6, 16), darkMat), 0, -0.05, 0).rotateX(Math.PI / 2));
  root.add(chamber);

  // Swept, curved grip, trigger guard, tail fins.
  const gripCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, -0.04, 0.05), new THREE.Vector3(0, -0.1, 0.08), new THREE.Vector3(0, -0.17, 0.1),
  ]);
  root.add(
    new THREE.Mesh(new THREE.TubeGeometry(gripCurve, 16, 0.028, 12), bodyMat),
    at(new THREE.Mesh(new THREE.SphereGeometry(0.031, 14, 10), bodyMat), 0, -0.17, 0.1),
  );
  const guard = at(new THREE.Mesh(new THREE.TorusGeometry(0.036, 0.0045, 6, 16, Math.PI), darkMat), 0, -0.06, 0.0);
  guard.rotation.set(0, Math.PI / 2, Math.PI);
  const trigger = at(new THREE.Mesh(new THREE.CapsuleGeometry(0.004, 0.02, 4, 6), darkMat), 0, -0.052, 0.01);
  root.add(guard, trigger);
  for (const side of [-1, 1]) {
    const fin = at(new THREE.Mesh(new THREE.ConeGeometry(0.018, 0.13, 12), bodyMat), side * 0.048, 0.035, 0.15);
    fin.rotation.set(Math.PI / 2, 0, 0);
    fin.rotation.y = side * 0.35;
    root.add(fin);
  }

  // Sights for aiming down them: a rear ring and a front fin, tops lined up at y=0.088.
  const ringSight = at(new THREE.Mesh(new THREE.TorusGeometry(0.016, 0.003, 6, 18), darkMat), 0, 0.088, 0.07);
  const ringPost = at(new THREE.Mesh(new THREE.CapsuleGeometry(0.0035, 0.015, 4, 6), darkMat), 0, 0.066, 0.07);
  const fin = at(new THREE.Mesh(new THREE.ConeGeometry(0.006, 0.036, 8), darkMat), 0, 0.07, -0.265);
  root.add(ringSight, ringPost, fin);

  // Arms: right hand on the grip, left hand cupped under the body.
  const rightArm = at(makeArm(1, -Math.PI / 2, [0.3, -0.45, 1]), 0.052, -0.11, 0.085);
  const leftArm = at(makeArm(-1, Math.PI, [-0.3, -0.35, 1]), 0, -0.085, -0.1);
  root.add(rightArm, leftArm);

  const muzzle = at(new THREE.Object3D(), 0, 0, -0.29);
  root.add(muzzle);

  const colour = new THREE.Color();
  let fireBlend = 0;

  /** Per-frame glow animation. `state`: { firing, energy 0..1, power 0..1, reloading }. */
  function animate(dt, time, state) {
    glowColor(state.power, colour);
    fireBlend = damp(fireBlend, state.firing ? 1 : 0, 10, dt);
    const speed = 1 + fireBlend * 4 + (state.reloading ? 2 : 0);

    // Coil rings: a wave of light running down the barrel, faster and brighter while firing.
    coils.forEach((mat, i) => {
      const wave = 0.5 + 0.5 * Math.sin(time * 5 * speed - i * 1.15);
      mat.emissive.copy(colour);
      mat.emissiveIntensity = 0.4 + wave * 1.4 + fireBlend * 1.6;
    });

    pulseTexture.offset.x -= dt * (0.25 + fireBlend * 2.2 + (state.reloading ? 0.8 : 0));
    veinMat.emissive.copy(colour);
    veinMat.emissiveIntensity = 1.6 + fireBlend * 2;

    const pulse = 0.5 + 0.5 * Math.sin(time * 3 * speed);
    orbMat.emissive.copy(colour);
    orbMat.emissiveIntensity = 1.8 + pulse * 1.4 + fireBlend * 4;
    orb.scale.setScalar(1 + pulse * 0.07 + fireBlend * 0.18);

    prongs.rotation.z += dt * (0.7 + fireBlend * 7);
    prongMat.emissive.copy(colour);
    prongMat.emissiveIntensity = 0.8 + pulse * 0.8 + fireBlend * 2.2;

    // Charge level: the core shrinks toward the rear as energy drains.
    core.scale.y = Math.max(0.04, state.energy);
    core.position.y = -0.035 * (1 - core.scale.y);
    coreMat.emissive.copy(colour);
    coreMat.emissiveIntensity = 1 + pulse * 0.8 + fireBlend * 1.5;
  }

  return {
    root, muzzle, home: { x: 0.2, y: -0.2, z: -0.4 }, animate,
    parts: { support: { object: leftArm, baseY: leftArm.position.y } },
  };
}
