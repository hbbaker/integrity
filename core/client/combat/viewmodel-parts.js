/*
 * Small mesh helpers for building first-person models. They are plain geometry: the look
 * (materials, colours, hands) belongs to the game's model builders.
 */
import * as THREE from 'three';

export function box(width, height, depth, mat) {
  return new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), mat);
}

/** A cylinder laid along -Z, the way a barrel points. */
export function barrelPart(radius, length, mat) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, length, 12), mat);
  mesh.rotation.x = Math.PI / 2;
  return mesh;
}

/** Position an object and return it, so parts can be listed inline. */
export function at(object, x, y, z) {
  object.position.set(x, y, z);
  return object;
}

const BEVEL_UV_SCALE = 8; // a texture tile covers about 0.12 m on a bevelled box (extrusions map UVs in metres)
const MIN_BEVEL = 0.0005;

/**
 * A box with softened edges: much less blocky than BoxGeometry, but still a few polygons.
 * `bevel` is the edge softening in metres (kept smaller than half the smallest side).
 */
export function bevelBox(width, height, depth, mat, bevel = 0.006) {
  const b = Math.max(MIN_BEVEL, Math.min(bevel, width / 2 - MIN_BEVEL, height / 2 - MIN_BEVEL, depth / 2 - MIN_BEVEL));
  const w = width / 2 - b;
  const h = height / 2 - b;
  const shape = new THREE.Shape();
  shape.moveTo(-w, -h);
  shape.lineTo(w, -h);
  shape.lineTo(w, h);
  shape.lineTo(-w, h);
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: depth - 2 * b, bevelEnabled: true, bevelThickness: b, bevelSize: b, bevelSegments: 2, curveSegments: 1,
  });
  geometry.translate(0, 0, -(depth - 2 * b) / 2);
  const uv = geometry.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * BEVEL_UV_SCALE, uv.getY(i) * BEVEL_UV_SCALE);
  return new THREE.Mesh(geometry, mat);
}

/**
 * A turned part (a barrel, a muzzle brake, a scope tube) along -Z, starting at z = 0 and running forward.
 * `profile` is a list of [radius, distanceForward] points; a ring or a flare is just a step in the radius.
 */
export function lathePart(profile, mat, segments = 20) {
  const points = profile.map(([radius, distance]) => new THREE.Vector2(radius, distance));
  const geometry = new THREE.LatheGeometry(points, segments);
  geometry.rotateX(-Math.PI / 2); // the lathe axis (+Y) now runs down -Z
  return new THREE.Mesh(geometry, mat);
}

/** A glowing material: a dark base with its own light, so it shines in shade too. Intensity is animated per model. */
export function glowMaterial(color, intensity = 1.8) {
  return new THREE.MeshStandardMaterial({ color: 0x050505, emissive: color, emissiveIntensity: intensity, roughness: 0.4 });
}

/**
 * A row of small lights along -Z for an ammo or charge readout. `update(fraction, time)` lights that share of the
 * cells; at a quarter or less they turn red and pulse. `chase(time, speed)` runs one lit cell along the row instead.
 */
export function makeGauge(count, { pitch = 0.024, size = [0.004, 0.011, 0.018], color = 0x00f0ff, lowColor = 0xff3b5c } = {}) {
  const lit = glowMaterial(color, 2.2);
  const dim = new THREE.MeshStandardMaterial({ color: 0x0a1418, emissive: 0x08242c, emissiveIntensity: 0.45, roughness: 0.5 });
  const geometry = new THREE.BoxGeometry(...size);
  const group = new THREE.Group();
  const cells = [];
  for (let i = 0; i < count; i++) {
    const cell = new THREE.Mesh(geometry, dim);
    cell.position.z = -i * pitch;
    group.add(cell);
    cells.push(cell);
  }
  const show = (n) => cells.forEach((cell, i) => { cell.material = i < n ? lit : dim; });
  return {
    group,
    update(fraction, time) {
      const low = fraction <= 0.25;
      lit.emissive.setHex(low ? lowColor : color);
      lit.emissiveIntensity = low ? 1.4 + Math.sin(time * 12) : 2.2;
      show(Math.ceil(fraction * count - 1e-6));
    },
    chase(time, speed = 14) {
      lit.emissive.setHex(color);
      lit.emissiveIntensity = 2.6;
      const at = Math.floor(time * speed) % count;
      cells.forEach((cell, i) => { cell.material = i === at ? lit : dim; });
    },
  };
}
