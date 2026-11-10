import * as THREE from 'three';

/*
 * Materials, procedural canvas textures, sky dome and image-based lighting.
 * Nothing here knows about a particular game.
 */

/** Standard PBR material. Defaults to a rough dielectric. */
export function material(color, { roughness = 0.75, metalness = 0, ...extra } = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness, ...extra });
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

