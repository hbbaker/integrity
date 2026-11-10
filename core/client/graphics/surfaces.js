/*
 * Procedural surface materials: for each surface three canvas images are drawn together, so they line up:
 *   colour    the paint, grain and wear
 *   height    a grey height map (white = raised, black = a groove). Used as a bump map, so lighting catches panel
 *             seams, rivets, brushed grain and weave as real relief instead of a flat picture
 *   glow      light that shines by itself (circuit traces, seam lights, LEDs); black where nothing glows
 * Nothing is loaded from disk: every pattern is drawn with canvas strokes, deterministically (the same call always
 * draws the same pattern), and the textures are cached and shared between materials.
 *
 * Kinds:
 *   brushed   machined metal with fine directional grain
 *   plate     armour plating: panel seams, rivets, scuffs, seam lights and LEDs
 *   circuit   a printed circuit: raised traces and chips that glow in several colours
 *   weave     carbon-fibre / technical fabric
 *   rubber    a stippled rubber grip
 */

import * as THREE from 'three';

const DEFAULT_GLOW_COLORS = ['#00f0ff', '#ff2bd6', '#3dff9a', '#8a4dff']; // fibre-optic cyan, magenta, lime, violet
const GRAIN_STREAKS = 340;
const STIPPLE_DOTS = 1100;
const cache = new Map();

/** A small deterministic random generator, seeded from text. */
function seededRandom(text) {
  let seed = 2166136261;
  for (let i = 0; i < text.length; i++) seed = Math.imul(seed ^ text.charCodeAt(i), 16777619);
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeCanvas(size) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  return { canvas, ctx: canvas.getContext('2d') };
}

const grey = (level) => `rgb(${level}, ${level}, ${level})`;

/** One layer of a surface: its canvas and context, with helpers that draw the same shape in all three images. */
function createLayers(size, baseColor) {
  const colour = makeCanvas(size);
  const height = makeCanvas(size);
  const glow = makeCanvas(size);
  colour.ctx.fillStyle = baseColor;
  colour.ctx.fillRect(0, 0, size, size);
  height.ctx.fillStyle = grey(128);
  height.ctx.fillRect(0, 0, size, size);
  glow.ctx.fillStyle = '#000';
  glow.ctx.fillRect(0, 0, size, size);
  return { colour, height, glow, size, hasGlow: false };
}

/** Draw a line on a layer's canvas. */
function line(layer, x1, y1, x2, y2, style, width, alpha = 1) {
  const { ctx } = layer;
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = style;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
  ctx.globalAlpha = 1;
}

function rect(layer, x, y, w, h, style, alpha = 1) {
  const { ctx } = layer;
  ctx.globalAlpha = alpha;
  ctx.fillStyle = style;
  ctx.fillRect(x, y, w, h);
  ctx.globalAlpha = 1;
}

function dot(layer, x, y, radius, style, alpha = 1) {
  const { ctx } = layer;
  ctx.globalAlpha = alpha;
  ctx.fillStyle = style;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
}

/** A glowing mark: a soft wide halo under a bright core, so it reads as light and not paint. */
function glowLine(layer, x1, y1, x2, y2, color, width) {
  line(layer.glow, x1, y1, x2, y2, color, width * 3, 0.35);
  line(layer.glow, x1, y1, x2, y2, color, width, 1);
  layer.hasGlow = true;
}

function glowDot(layer, x, y, radius, color) {
  dot(layer.glow, x, y, radius * 2.4, color, 0.35);
  dot(layer.glow, x, y, radius, color, 1);
  layer.hasGlow = true;
}

/* -------------------------------- patterns -------------------------------- */

function drawBrushed(layers, rand) {
  const { size } = layers;
  for (let i = 0; i < GRAIN_STREAKS; i++) {
    const y = rand() * size;
    const x = rand() * size;
    const length = 30 + rand() * size * 0.6;
    const light = rand() > 0.5;
    line(layers.colour, x, y, x + length, y, light ? '#fff' : '#000', 1, 0.05 + rand() * 0.1);
    line(layers.height, x, y, x + length, y, grey(light ? 190 : 70), 1, 0.35);
  }
  for (let i = 0; i < 18; i++) { // a few deeper scratches
    const x = rand() * size;
    const y = rand() * size;
    const angle = (rand() - 0.5) * 0.6;
    const length = 20 + rand() * 60;
    line(layers.colour, x, y, x + Math.cos(angle) * length, y + Math.sin(angle) * length, '#fff', 1, 0.25);
    line(layers.height, x, y, x + Math.cos(angle) * length, y + Math.sin(angle) * length, grey(30), 1, 0.8);
  }
}

function drawPlate(layers, rand, glowColors) {
  const { size } = layers;
  const half = size / 2;
  // Panel seams: a groove in the height map, a dark line in the colour, and a light running inside some of them.
  for (const at of [0, half, size]) {
    for (const [x1, y1, x2, y2] of [[at, 0, at, size], [0, at, size, at]]) {
      line(layers.height, x1, y1, x2, y2, grey(8), 7);
      line(layers.colour, x1, y1, x2, y2, '#000', 5, 0.55);
    }
  }
  const seamLight = glowColors[0];
  for (const [x1, y1, x2, y2] of [[10, half + 6, half - 24, half + 6], [half + 24, half - 6, size - 10, half - 6], [half - 6, 20, half - 6, half - 28], [half + 6, half + 30, half + 6, size - 14]]) {
    glowLine(layers, x1, y1, x2, y2, seamLight, 2);
  }
  // Rivets round every panel.
  for (const cx of [0, half, size]) {
    for (const cy of [0, half, size]) {
      for (const [ox, oy] of [[16, 16], [-16, 16], [16, -16], [-16, -16]]) {
        const x = cx + ox;
        const y = cy + oy;
        if (x < 4 || y < 4 || x > size - 4 || y > size - 4) continue;
        dot(layers.height, x, y, 4.5, grey(245));
        dot(layers.colour, x, y, 4.5, '#fff', 0.3);
        dot(layers.colour, x + 1, y + 1, 2.5, '#000', 0.35);
      }
    }
  }
  // Scuffs and a few LEDs.
  for (let i = 0; i < 40; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const angle = rand() * Math.PI;
    const length = 6 + rand() * 22;
    line(layers.colour, x, y, x + Math.cos(angle) * length, y + Math.sin(angle) * length, '#fff', 1, 0.2);
    line(layers.height, x, y, x + Math.cos(angle) * length, y + Math.sin(angle) * length, grey(60), 1, 0.5);
  }
  for (let i = 0; i < 5; i++) {
    const x = 28 + rand() * (size - 56);
    const y = 28 + rand() * (size - 56);
    glowDot(layers, x, y, 3, glowColors[1 + (i % (glowColors.length - 1))]);
    dot(layers.height, x, y, 4, grey(220));
  }
}

function drawCircuit(layers, rand, glowColors) {
  const { size } = layers;
  const grid = 16;
  const cells = size / grid;
  for (let i = 0; i < 38; i++) { // traces: an orthogonal run with one bend and a pad at each end
    const color = glowColors[Math.floor(rand() * glowColors.length)];
    const x = Math.floor(rand() * cells) * grid + grid / 2;
    const y = Math.floor(rand() * cells) * grid + grid / 2;
    const bendX = x + (Math.floor(rand() * 9) - 4) * grid;
    const endY = y + (Math.floor(rand() * 9) - 4) * grid;
    const points = [[x, y], [bendX, y], [bendX, endY]];
    for (let p = 0; p < points.length - 1; p++) {
      const [x1, y1] = points[p];
      const [x2, y2] = points[p + 1];
      line(layers.height, x1, y1, x2, y2, grey(235), 4);
      line(layers.colour, x1, y1, x2, y2, '#fff', 3, 0.18);
      glowLine(layers, x1, y1, x2, y2, color, 1.6);
    }
    for (const [px, py] of [points[0], points[2]]) {
      dot(layers.height, px, py, 5, grey(255));
      glowDot(layers, px, py, 2.4, color);
    }
  }
  for (let i = 0; i < 5; i++) { // chips
    const w = 28 + rand() * 24;
    const h = 20 + rand() * 20;
    const x = rand() * (size - w);
    const y = rand() * (size - h);
    rect(layers.height, x, y, w, h, grey(250));
    rect(layers.colour, x, y, w, h, '#000', 0.55);
    for (let leg = 0; leg < w; leg += 6) {
      line(layers.height, x + leg + 2, y - 3, x + leg + 2, y, grey(220), 2);
      line(layers.height, x + leg + 2, y + h, x + leg + 2, y + h + 3, grey(220), 2);
    }
    glowDot(layers, x + 5, y + 5, 2, glowColors[i % glowColors.length]);
  }
}

function drawWeave(layers) {
  const { size } = layers;
  const cell = 8;
  for (let gy = 0; gy < size / cell; gy++) {
    for (let gx = 0; gx < size / cell; gx++) {
      const over = (gx + gy) % 2 === 0; // alternating over and under threads
      const x = gx * cell;
      const y = gy * cell;
      rect(layers.height, x, y, cell, cell, grey(over ? 190 : 80));
      rect(layers.colour, x, y, cell, cell, over ? '#fff' : '#000', over ? 0.1 : 0.22);
      line(layers.height, over ? x : x + cell / 2, over ? y + cell / 2 : y, over ? x + cell : x + cell / 2, over ? y + cell / 2 : y + cell, grey(over ? 230 : 40), 1, 0.7);
    }
  }
}

function drawRubber(layers, rand) {
  const { size } = layers;
  for (let i = 0; i < STIPPLE_DOTS; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const radius = 1 + rand() * 1.8;
    const raised = rand() > 0.35;
    dot(layers.height, x, y, radius, grey(raised ? 235 : 40), 0.8);
    dot(layers.colour, x, y, radius, raised ? '#fff' : '#000', raised ? 0.06 : 0.2);
  }
}

const PATTERNS = { brushed: drawBrushed, plate: drawPlate, circuit: drawCircuit, weave: drawWeave, rubber: drawRubber };

/* ------------------------------- textures -------------------------------- */

function toTexture(canvas, { colour, repeat }) {
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(repeat, repeat);
  if (colour) texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * The textures of one surface: { map, bump, emissive }. `emissive` is null when the pattern has nothing that glows.
 * Cached by every option, so the same surface is drawn once.
 */
export function surfaceTextures(kind, { color = '#808890', glow = DEFAULT_GLOW_COLORS, size = 256, repeat = 1 } = {}) {
  const glowColors = Array.isArray(glow) ? glow : [glow, ...DEFAULT_GLOW_COLORS.filter((entry) => entry !== glow)];
  const key = `${kind}|${color}|${glowColors.join(',')}|${size}|${repeat}`;
  if (cache.has(key)) return cache.get(key);
  const pattern = PATTERNS[kind];
  if (!pattern) throw new Error(`unknown surface kind "${kind}"`);
  const layers = createLayers(size, color);
  pattern(layers, seededRandom(`${kind}${color}`), glowColors);
  const textures = {
    map: toTexture(layers.colour.canvas, { colour: true, repeat }),
    bump: toTexture(layers.height.canvas, { colour: false, repeat }),
    emissive: layers.hasGlow ? toTexture(layers.glow.canvas, { colour: true, repeat }) : null,
  };
  cache.set(key, textures);
  return textures;
}

/**
 * A new standard material with a surface's colour, height (bump) and glow maps. The textures are shared; the material
 * is yours (a game may flash its emissive colour on a hit, so pass `glowing: false` for those: a glow map would
 * limit the flash to the glowing marks).
 *
 * @param options { color, glow (a css colour or a list of them), size, repeat, roughness, metalness,
 *                  bumpScale (how deep the height map reads), emissiveIntensity, glowing }
 */
export function surfaceMaterial(kind, {
  color = '#808890', glow, size = 256, repeat = 1, roughness = 0.5, metalness = 0.5, bumpScale = 2, emissiveIntensity = 1.4, glowing = true,
} = {}) {
  const textures = surfaceTextures(kind, { color, glow, size, repeat });
  const material = new THREE.MeshStandardMaterial({ map: textures.map, bumpMap: textures.bump, bumpScale, roughness, metalness });
  if (glowing && textures.emissive) {
    material.emissive = new THREE.Color(0xffffff);
    material.emissiveMap = textures.emissive;
    material.emissiveIntensity = emissiveIntensity;
  }
  return material;
}

/** A css colour string from a three.js style hex number (0xf2c200 -> "#f2c200"). */
export function cssColor(hex) {
  return `#${hex.toString(16).padStart(6, '0')}`;
}
