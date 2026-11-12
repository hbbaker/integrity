/*
 * The stage: renderer, scene, camera and sky, set up the way a first-person game wants them,
 * with an original-Xbox look (about 480p, no tone mapping, hard-edged shadows, short fog). Returns the pieces; the game adds its own objects to the scene.
 */

import * as THREE from 'three';
import { createSkyDome } from '../graphics/materials.js';

/**
 * @param options {
 *   canvas, fov, fogColor, fog: { near, far }, internalHeight (render height in pixels; the canvas is scaled up to the window),
 *   skyRadius, cameraFar
 * }
 */
export function createStage({
  canvas, fov, fogColor, fog, internalHeight, skyRadius = 250, cameraFar = 320,
}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(1);
  setInternalSize();
  renderer.autoClear = false; // the game clears once, then draws the world and the viewmodel layers
  renderer.toneMapping = THREE.NoToneMapping; // a 2001 console shows the colours as they are
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.BasicShadowMap;
  // Everything that casts shadows is static (the level), so render the shadow map once and again
  // only when the level changes (set renderer.shadowMap.needsUpdate).
  renderer.shadowMap.autoUpdate = false;
  renderer.shadowMap.needsUpdate = true;

  const scene = new THREE.Scene();
  const skyDome = createSkyDome(skyRadius); // follows the camera so the far plane can never clip it
  scene.add(skyDome);
  scene.fog = new THREE.Fog(fogColor, fog.near, fog.far);

  const camera = new THREE.PerspectiveCamera(fov, window.innerWidth / window.innerHeight, 0.1, cameraFar);

  /** Render at a fixed low height with the window's aspect ratio; CSS stretches the canvas over the window. */
  function setInternalSize() {
    const height = Math.min(internalHeight, window.innerHeight);
    const width = Math.round(height * (window.innerWidth / window.innerHeight));
    renderer.setSize(width, height, false);
  }

  /** Match the renderer and camera to the window; returns the new aspect ratio. */
  function resize() {
    setInternalSize();
    const aspect = window.innerWidth / window.innerHeight;
    camera.aspect = aspect;
    camera.updateProjectionMatrix();
    return aspect;
  }

  return { renderer, scene, camera, skyDome, resize };
}
