import * as THREE from 'three';
import { material } from './effects.js';

/*
 * Ammo and health pickups: spinning crates dropped by dead bots.
 * A fixed pool of meshes is reused, so dropping and collecting never allocates.
 */

const KIND_HEALTH = 'health';
const KIND_AMMO = 'ammo';

function box(w, h, d, mat) {
  return new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
}

/** White first-aid case with a red cross on every side. */
function buildHealthBox() {
  const group = new THREE.Group();
  const white = material(0xe9ecee, { roughness: 0.5 });
  const red = material(0xd1242a, { roughness: 0.5, emissive: 0x330000 });
  group.add(box(0.5, 0.36, 0.3, white));
  for (const sign of [1, -1]) { // cross on front and back faces
    const horizontal = box(0.2, 0.06, 0.01, red);
    const vertical = box(0.06, 0.2, 0.01, red);
    horizontal.position.z = vertical.position.z = sign * 0.156;
    group.add(horizontal, vertical);
  }
  group.add(box(0.2, 0.05, 0.05, material(0x8b9096, { metalness: 0.8, roughness: 0.3 }))); // handle
  group.children[group.children.length - 1].position.y = 0.2;
  return group;
}

/** Olive ammo crate with a stencilled yellow band and brass rounds on top. */
function buildAmmoBox() {
  const group = new THREE.Group();
  group.add(box(0.55, 0.32, 0.34, material(0x5b6a3a, { roughness: 0.7, metalness: 0.2 })));
  const band = box(0.56, 0.06, 0.35, material(0xd8b422, { roughness: 0.6 }));
  band.position.y = 0.04;
  group.add(band);
  const brass = material(0xb08a2e, { metalness: 0.9, roughness: 0.3 });
  const bullet = new THREE.CylinderGeometry(0.03, 0.03, 0.14, 8);
  for (const x of [-0.12, 0, 0.12]) {
    const round = new THREE.Mesh(bullet, brass);
    round.position.set(x, 0.23, 0);
    group.add(round);
  }
  return group;
}

export class Pickups {
  constructor(scene, cfg) {
    this.cfg = cfg.pickups;
    this.items = [];
    for (const [kind, build] of [[KIND_HEALTH, buildHealthBox], [KIND_AMMO, buildAmmoBox]]) {
      for (let i = 0; i < this.cfg.poolPerKind; i++) {
        const mesh = build();
        mesh.visible = false;
        scene.add(mesh);
        this.items.push({ kind, mesh, active: false, age: 0, life: this.cfg.lifetime, netId: 0, x: 0, z: 0, y: 0 });
      }
    }
    this.onCollect = null; // (kind) => boolean, true if the pickup was actually used
    this.onCollected = null; // (item) => void, after a pickup was used (multiplayer tells the others)
  }

  /** Maybe drop something where a bot died. `needsHealth` biases toward health. */
  maybeDrop(x, y, z, needsHealth) {
    if (Math.random() > this.cfg.dropChance) return;
    const kind = Math.random() < (needsHealth ? this.cfg.healthBias : 0.3) ? KIND_HEALTH : KIND_AMMO;
    this.place(kind, x, y, z);
  }

  /**
   * Put a pickup in the world. `netId` names it across the network (0 = local only);
   * `life` overrides how long it lasts. Returns false when the pool for that kind is full.
   */
  place(kind, x, y, z, netId = 0, life = this.cfg.lifetime) {
    const item = this.items.find((i) => !i.active && i.kind === kind);
    if (!item) return false;
    item.active = true;
    item.age = 0;
    item.life = life;
    item.netId = netId;
    item.x = x;
    item.y = y;
    item.z = z;
    item.mesh.visible = true;
    item.mesh.position.set(x, y + 0.5, z);
    return true;
  }

  /** Someone else picked this one up. */
  removeById(netId) {
    const item = this.items.find((i) => i.active && i.netId === netId);
    if (item) this._hide(item);
  }

  /** Positions of everything lying around, for choosing where the next one goes. */
  positions() {
    return this.items.filter((i) => i.active).map((i) => ({ x: i.x, z: i.z }));
  }

  update(dt, playerPos) {
    const r2 = this.cfg.collectRadius * this.cfg.collectRadius;
    for (const item of this.items) {
      if (!item.active) continue;
      item.age += dt;
      if (item.age > item.life) {
        this._hide(item);
        continue;
      }
      const dx = playerPos.x - item.x;
      const dz = playerPos.z - item.z;
      if (dx * dx + dz * dz < r2 && Math.abs(playerPos.y - item.y) < 2 && this.onCollect(item.kind)) {
        this._hide(item);
        if (this.onCollected) this.onCollected(item);
      }
    }
  }

  /** Per rendered frame: spin, bob, and blink just before despawning. */
  animate(time) {
    for (const item of this.items) {
      if (!item.active) continue;
      item.mesh.rotation.y = time * 2.5 + item.x;
      item.mesh.position.y = item.y + 0.55 + Math.sin(time * 3 + item.z) * 0.1;
      const remaining = item.life - item.age;
      item.mesh.visible = remaining > 4 || Math.floor(time * 8) % 2 === 0;
    }
  }

  clear() {
    for (const item of this.items) this._hide(item);
  }

  _hide(item) {
    item.active = false;
    item.mesh.visible = false;
  }
}
