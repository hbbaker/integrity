import * as THREE from 'three';

/* ------------------------------------------------------------------ *
 *  Realistic look: PBR materials, procedural textures, sky + environment
 * ------------------------------------------------------------------ */

/** Comic lettering used by the in-world speech bubbles (matches the HUD font). */
export const COMIC_FONT = '"Impact", "Haettenschweiler", "Arial Narrow Bold", sans-serif';

/** Standard PBR material. Defaults to a rough dielectric. */
export function material(color, { roughness = 0.75, metalness = 0, ...extra } = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness, ...extra });
}

export function easeOutBack(t) {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  const u = t - 1;
  return 1 + c3 * u * u * u + c1 * u * u;
}

function makeCanvas(size) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  return canvas;
}

function toTexture(canvas, { repeat = true } = {}) {
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8; // clamped by the renderer to what the GPU supports
  if (repeat) texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

/** Per-pixel grain: every pixel's brightness is jittered by +/- `amount` (0..255). */
function addGrain(ctx, size, amount) {
  const image = ctx.getImageData(0, 0, size, size);
  const d = image.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (Math.random() - 0.5) * amount;
    d[i] += n;
    d[i + 1] += n;
    d[i + 2] += n;
  }
  ctx.putImageData(image, 0, 0);
}

/** Soft dark blotches: stains, rust, dirt. */
function addBlotches(ctx, size, count, color, maxRadius) {
  for (let i = 0; i < count; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const r = 6 + Math.random() * maxRadius;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, color);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
}

/** Poured concrete with stains, hairline cracks and expansion joints. Tile = 4 m. */
export function createConcreteTexture() {
  const size = 512;
  const canvas = makeCanvas(size);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#8c8e8a';
  ctx.fillRect(0, 0, size, size);
  addBlotches(ctx, size, 40, 'rgba(60,58,50,0.22)', 90);
  addBlotches(ctx, size, 25, 'rgba(190,190,180,0.12)', 70);
  addGrain(ctx, size, 38);
  ctx.strokeStyle = 'rgba(40,40,38,0.35)';
  ctx.lineWidth = 3; // joints around the tile
  ctx.strokeRect(1, 1, size - 2, size - 2);
  ctx.lineWidth = 1;
  for (let i = 0; i < 5; i++) { // cracks
    ctx.beginPath();
    let x = Math.random() * size;
    let y = Math.random() * size;
    ctx.moveTo(x, y);
    for (let s = 0; s < 12; s++) {
      x += (Math.random() - 0.5) * 50;
      y += (Math.random() - 0.3) * 40;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  return toTexture(canvas);
}

/** Corrugated painted steel (shipping container). Tile = 2 m, ribs run vertically. */
export function createCorrugatedTexture(baseColor) {
  const size = 256;
  const canvas = makeCanvas(size);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = baseColor;
  ctx.fillRect(0, 0, size, size);
  const ribWidth = 16;
  for (let x = 0; x < size; x += ribWidth) { // light/dark halves fake the rib shading
    ctx.fillStyle = 'rgba(255,255,255,0.10)';
    ctx.fillRect(x, 0, ribWidth / 2, size);
    ctx.fillStyle = 'rgba(0,0,0,0.20)';
    ctx.fillRect(x + ribWidth / 2, 0, ribWidth / 2, size);
  }
  addBlotches(ctx, size, 30, 'rgba(90,40,10,0.35)', 50); // rust
  addBlotches(ctx, size, 20, 'rgba(0,0,0,0.25)', 40); // grime
  addGrain(ctx, size, 26);
  return toTexture(canvas);
}

/** Diamond-plate style dark steel for platform tops. Tile = 2 m. */
export function createSteelTexture() {
  const size = 256;
  const canvas = makeCanvas(size);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#5b6168';
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = 'rgba(255,255,255,0.18)';
  for (let y = 0; y < size; y += 16) {
    for (let x = 0; x < size; x += 16) {
      const o = (y / 16) % 2 ? 8 : 0;
      ctx.save();
      ctx.translate(x + o + 4, y + 8);
      ctx.rotate(((x / 16 + y / 16) % 2 ? 1 : -1) * 0.7);
      ctx.fillRect(-5, -1.5, 10, 3);
      ctx.restore();
    }
  }
  addBlotches(ctx, size, 20, 'rgba(0,0,0,0.25)', 50);
  addGrain(ctx, size, 24);
  return toTexture(canvas);
}

/** Yellow/black diagonal hazard stripes for ramps and barriers. Tile = 2 m. */
export function createHazardTexture() {
  const size = 256;
  const canvas = makeCanvas(size);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#d8aa1a';
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = '#1b1b1b';
  for (let i = -size; i < size * 2; i += 64) { // diagonal bands
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i + 32, 0);
    ctx.lineTo(i + 32 - size, size);
    ctx.lineTo(i - size, size);
    ctx.closePath();
    ctx.fill();
  }
  addBlotches(ctx, size, 20, 'rgba(0,0,0,0.3)', 40);
  addGrain(ctx, size, 28);
  return toTexture(canvas);
}

/**
 * Sky dome: a big inside-out sphere with a vertical gradient and a soft sun glow.
 * Used both as the visible sky and (via createEnvironment) as the reflection /
 * ambient light source for every PBR material.
 */
export function createSkyDome(radius) {
  const canvas = document.createElement('canvas');
  canvas.width = 16;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, '#3f78bd');
  g.addColorStop(0.42, '#9dc0dd');
  g.addColorStop(0.5, '#d9e1e4'); // horizon haze
  g.addColorStop(0.52, '#8d8f8a');
  g.addColorStop(1, '#6c6e6a'); // ground bounce
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 16, 256);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(radius, 24, 16),
    new THREE.MeshBasicMaterial({ map: texture, side: THREE.BackSide, fog: false, depthWrite: false }),
  );
  dome.renderOrder = -1;
  return dome;
}

/** Prefiltered environment map made from the sky, for PBR reflections and ambient light. */
export function createEnvironment(renderer) {
  const skyScene = new THREE.Scene();
  skyScene.add(createSkyDome(50));
  const pmrem = new THREE.PMREMGenerator(renderer);
  const target = pmrem.fromScene(skyScene, 0.02);
  pmrem.dispose();
  return target.texture;
}

/* ------------------------------------------------------------------ *
 *  Small canvas textures
 * ------------------------------------------------------------------ */

export function makeGlowTexture() {
  const canvas = makeCanvas(64);
  const ctx = canvas.getContext('2d');
  const grad = ctx.createRadialGradient(32, 32, 2, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.35, 'rgba(255,230,140,0.9)');
  grad.addColorStop(1, 'rgba(255,160,40,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 64, 64);
  ctx.fillStyle = 'rgba(255,255,255,0.9)'; // four spikes
  ctx.fillRect(30, 2, 4, 60);
  ctx.fillRect(2, 30, 60, 4);
  return toTexture(canvas, { repeat: false });
}

function roundRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/* ------------------------------------------------------------------ *
 *  Pooled particles (debris, sparks, puffs, smoke)
 *  Everything is pre-allocated; spawning never creates objects.
 *  Particles are unlit (MeshBasicMaterial): sparks should glow, and flat debris
 *  chunks are small and brief enough that nobody notices.
 * ------------------------------------------------------------------ */

export class ParticlePool {
  constructor(scene, solidCount = 200, smokeCount = 36) {
    const box = new THREE.BoxGeometry(1, 1, 1);
    this.solids = [];
    for (let i = 0; i < solidCount; i++) {
      const mesh = new THREE.Mesh(box, new THREE.MeshBasicMaterial({ color: 0xffffff }));
      mesh.visible = false;
      scene.add(mesh);
      this.solids.push({
        mesh, active: false, life: 0, maxLife: 1, size: 1, gravity: 0,
        vel: new THREE.Vector3(), spin: new THREE.Vector3(),
      });
    }
    this.cursor = 0;

    const blob = new THREE.IcosahedronGeometry(1, 1);
    this.smokes = [];
    for (let i = 0; i < smokeCount; i++) {
      const mesh = new THREE.Mesh(blob, new THREE.MeshBasicMaterial({ color: 0x9a9da3, transparent: true, depthWrite: false }));
      mesh.visible = false;
      scene.add(mesh);
      this.smokes.push({ mesh, active: false, life: 0, maxLife: 1, size: 1, vel: new THREE.Vector3() });
    }
    this.smokeCursor = 0;
  }

  _nextSolid() {
    // Prefer a free slot; if the pool is exhausted recycle round-robin (oldest-ish).
    for (let i = 0; i < this.solids.length; i++) {
      const idx = (this.cursor + i) % this.solids.length;
      if (!this.solids[idx].active) {
        this.cursor = (idx + 1) % this.solids.length;
        return this.solids[idx];
      }
    }
    const p = this.solids[this.cursor];
    this.cursor = (this.cursor + 1) % this.solids.length;
    return p;
  }

  spawn(pos, vx, vy, vz, color, size, life, gravity, spinAmount) {
    const p = this._nextSolid();
    p.active = true;
    p.life = p.maxLife = life;
    p.size = size;
    p.gravity = gravity;
    p.vel.set(vx, vy, vz);
    p.spin.set(
      (Math.random() - 0.5) * spinAmount,
      (Math.random() - 0.5) * spinAmount,
      (Math.random() - 0.5) * spinAmount,
    );
    p.mesh.material.color.setHex(color);
    p.mesh.position.copy(pos);
    p.mesh.rotation.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
    p.mesh.scale.setScalar(size);
    p.mesh.visible = true;
  }

  /** Small sparks / impact puff. */
  burst(pos, color, count, speed, size = 0.07, life = 0.35, gravity = 10) {
    for (let i = 0; i < count; i++) {
      const theta = Math.random() * Math.PI * 2;
      const up = Math.random() * 0.8 + 0.2;
      const s = speed * (0.4 + Math.random() * 0.6);
      this.spawn(pos, Math.cos(theta) * s, up * s, Math.sin(theta) * s, color, size * (0.6 + Math.random() * 0.8), life * (0.6 + Math.random() * 0.6), gravity, 18);
    }
  }

  /** Chunks of broken robot flying apart. */
  debris(pos, colors, count, scale = 1) {
    for (let i = 0; i < count; i++) {
      const theta = Math.random() * Math.PI * 2;
      const s = 3 + Math.random() * 4;
      this.spawn(
        pos, Math.cos(theta) * s, 4 + Math.random() * 4, Math.sin(theta) * s,
        colors[i % colors.length], (0.1 + Math.random() * 0.14) * scale, 1.1 + Math.random() * 0.5, 22, 24,
      );
    }
  }

  smoke(pos, count, scale = 1) {
    for (let i = 0; i < count; i++) {
      const s = this.smokes[this.smokeCursor];
      this.smokeCursor = (this.smokeCursor + 1) % this.smokes.length;
      s.active = true;
      s.life = s.maxLife = 0.6 + Math.random() * 0.3;
      s.size = (0.35 + Math.random() * 0.3) * scale;
      s.vel.set((Math.random() - 0.5) * 1.6, 0.8 + Math.random() * 1.2, (Math.random() - 0.5) * 1.6);
      s.mesh.position.copy(pos);
      s.mesh.position.x += (Math.random() - 0.5) * 0.4 * scale;
      s.mesh.position.z += (Math.random() - 0.5) * 0.4 * scale;
      s.mesh.scale.setScalar(s.size * 0.4);
      s.mesh.material.opacity = 0.8;
      s.mesh.visible = true;
    }
  }

  update(dt) {
    for (const p of this.solids) {
      if (!p.active) continue;
      p.life -= dt;
      if (p.life <= 0) {
        p.active = false;
        p.mesh.visible = false;
        continue;
      }
      p.vel.y -= p.gravity * dt;
      const pos = p.mesh.position;
      pos.addScaledVector(p.vel, dt);
      if (pos.y < p.size * 0.5) { // cheap floor bounce
        pos.y = p.size * 0.5;
        p.vel.y *= -0.35;
        p.vel.x *= 0.7;
        p.vel.z *= 0.7;
      }
      p.mesh.rotation.x += p.spin.x * dt;
      p.mesh.rotation.y += p.spin.y * dt;
      p.mesh.rotation.z += p.spin.z * dt;
      // Shrink out over the last 30% of life instead of fading (no transparency sorting).
      p.mesh.scale.setScalar(p.size * Math.min(1, p.life / (p.maxLife * 0.3)));
    }
    for (const s of this.smokes) {
      if (!s.active) continue;
      s.life -= dt;
      if (s.life <= 0) {
        s.active = false;
        s.mesh.visible = false;
        continue;
      }
      const t = 1 - s.life / s.maxLife;
      s.mesh.position.addScaledVector(s.vel, dt);
      s.mesh.scale.setScalar(s.size * (0.4 + t * 1.1));
      s.mesh.material.opacity = 0.8 * (1 - t);
    }
  }
}

/* ------------------------------------------------------------------ *
 *  Tracers: a short bright streak that travels from muzzle to impact
 * ------------------------------------------------------------------ */

export class TracerPool {
  constructor(scene, count = 24) {
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    this.items = [];
    for (let i = 0; i < count; i++) {
      const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color: 0xfff27a }));
      mesh.visible = false;
      mesh.frustumCulled = false;
      scene.add(mesh);
      this.items.push({
        mesh, active: false, age: 0, duration: 0.1, distance: 1, width: 0.02,
        from: new THREE.Vector3(), dir: new THREE.Vector3(),
      });
    }
    this.cursor = 0;
  }

  spawn(from, to, color = 0xfff27a, speed = 260, width = 0.02) {
    const t = this.items[this.cursor];
    this.cursor = (this.cursor + 1) % this.items.length;
    t.from.copy(from);
    t.dir.subVectors(to, from);
    t.distance = t.dir.length();
    if (t.distance < 0.5) return;
    t.dir.divideScalar(t.distance);
    t.duration = Math.max(0.04, t.distance / speed);
    t.age = 0;
    t.active = true;
    t.width = width;
    t.mesh.material.color.setHex(color);
    t.mesh.visible = true;
    t.mesh.lookAt(to);
    this._place(t, 0);
  }

  _place(t, progress) {
    const streak = Math.min(3, t.distance);
    const head = progress * (t.distance + streak);
    const tail = Math.max(0, head - streak);
    const headClamped = Math.min(head, t.distance);
    const length = Math.max(0.01, headClamped - tail);
    const mid = (headClamped + tail) / 2;
    t.mesh.position.copy(t.from).addScaledVector(t.dir, mid);
    t.mesh.scale.set(t.width, t.width, length);
  }

  update(dt) {
    for (const t of this.items) {
      if (!t.active) continue;
      t.age += dt;
      if (t.age >= t.duration) {
        t.active = false;
        t.mesh.visible = false;
        continue;
      }
      this._place(t, t.age / t.duration);
    }
  }
}

/* ------------------------------------------------------------------ *
 *  Comic speech bubbles ("PLEASE HOLD") as pooled canvas sprites.
 *  These stay cartoony on purpose: thick ink outline, Impact lettering.
 * ------------------------------------------------------------------ */

const BUBBLE_W = 384;
const BUBBLE_H = 128;

export class BubblePool {
  constructor(scene, count = 10) {
    this.items = [];
    for (let i = 0; i < count; i++) {
      const canvas = document.createElement('canvas');
      canvas.width = BUBBLE_W;
      canvas.height = BUBBLE_H;
      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      const spriteMaterial = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false, depthWrite: false, fog: false });
      const sprite = new THREE.Sprite(spriteMaterial);
      sprite.visible = false;
      sprite.renderOrder = 20;
      scene.add(sprite);
      this.items.push({ sprite, ctx: canvas.getContext('2d'), texture, active: false, age: 0, life: 1.1, scale: 1 });
    }
    this.cursor = 0;
  }

  spawn(text, x, y, z, scale = 1) {
    const b = this.items[this.cursor];
    this.cursor = (this.cursor + 1) % this.items.length;
    this._draw(b, text);
    b.active = true;
    b.age = 0;
    b.scale = scale;
    b.sprite.position.set(x, y, z);
    b.sprite.visible = true;
    b.sprite.material.opacity = 1;
  }

  _draw(b, text) {
    const ctx = b.ctx;
    ctx.clearRect(0, 0, BUBBLE_W, BUBBLE_H);
    ctx.lineJoin = 'round';
    ctx.lineWidth = 9;
    ctx.strokeStyle = '#000000';
    ctx.fillStyle = '#fff6d6';
    // Tail first, then body, then a patch to hide the body's stroke across the tail joint.
    ctx.beginPath();
    ctx.moveTo(150, 86);
    ctx.lineTo(170, 124);
    ctx.lineTo(210, 86);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    roundRectPath(ctx, 8, 8, BUBBLE_W - 16, 82, 22);
    ctx.fill();
    ctx.stroke();
    ctx.fillRect(156, 82, 50, 12);
    // Text, shrunk to fit.
    let size = 46;
    ctx.font = `${size}px ${COMIC_FONT}`;
    const maxWidth = BUBBLE_W - 56;
    const width = ctx.measureText(text).width;
    if (width > maxWidth) {
      size = Math.floor((size * maxWidth) / width);
      ctx.font = `${size}px ${COMIC_FONT}`;
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#111111';
    ctx.fillText(text, BUBBLE_W / 2, 52);
    b.texture.needsUpdate = true;
  }

  update(dt) {
    for (const b of this.items) {
      if (!b.active) continue;
      b.age += dt;
      if (b.age >= b.life) {
        b.active = false;
        b.sprite.visible = false;
        continue;
      }
      const pop = easeOutBack(Math.min(1, b.age / 0.2));
      const k = b.scale * pop;
      b.sprite.scale.set(1.8 * k, 0.6 * k, 1);
      b.sprite.position.y += 0.5 * dt;
      b.sprite.material.opacity = Math.min(1, (b.life - b.age) / 0.25);
    }
  }
}

/* ------------------------------------------------------------------ *
 *  Muzzle flash: additive sprite + point light, parented to the barrel tip
 * ------------------------------------------------------------------ */

export class MuzzleFlash {
  constructor() {
    this.group = new THREE.Group();
    this.sprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: makeGlowTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    this.sprite.visible = false;
    // Constant light count (intensity 0 when idle) so shaders never recompile.
    this.light = new THREE.PointLight(0xffb23d, 0, 3, 1);
    this.group.add(this.sprite, this.light);
    this.time = 0;
  }

  /** Tint the sprite and its light (the raygun flashes green, guns orange). */
  setColor(spriteHex, lightHex) {
    this.sprite.material.color.setHex(spriteHex);
    this.light.color.setHex(lightHex);
  }

  fire(size = 0.3, intensity = 6) {
    this.sprite.visible = true;
    this.sprite.scale.setScalar(size * (0.8 + Math.random() * 0.5));
    this.sprite.material.rotation = Math.random() * Math.PI * 2;
    this.light.intensity = intensity;
    this.time = 0.055;
  }

  update(dt) {
    if (this.time <= 0) return;
    this.time -= dt;
    if (this.time <= 0) {
      this.sprite.visible = false;
      this.light.intensity = 0;
    }
  }
}

/** All pooled world-space effects, bundled so modules receive one object. */
export function createEffects(scene) {
  const particles = new ParticlePool(scene);
  const tracers = new TracerPool(scene, 48);
  const bubbles = new BubblePool(scene);
  return {
    particles,
    tracers,
    bubbles,
    update(dt) {
      particles.update(dt);
      tracers.update(dt);
      bubbles.update(dt);
    },
  };
}
