/*
 * The stage: renderer, scene, camera, sky and image-based lighting, set up the way a first-person
 * game wants them. Returns the pieces; the game adds its own objects to the scene.
 */

import * as THREE from 'three';
import { createEnvironment, createSkyDome } from '../graphics/materials.js';

/**
 * @param options {
 *   canvas, fov, exposure (tone mapping), fogColor, fog: { near, far }, maxPixelRatio,
 *   skyRadius, environmentIntensity, cameraFar
 * }
 */
export function createStage({
  canvas, fov, exposure, fogColor, fog, maxPixelRatio, skyRadius = 250, environmentIntensity = 0.7, cameraFar = 320,
}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, maxPixelRatio));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.autoClear = false; // the game clears once, then draws the world and the viewmodel layers
  renderer.toneMapping = THREE.ACESFilmicToneMapping; // filmic highlight roll-off: the biggest single step toward "realistic"
  renderer.toneMappingExposure = exposure;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  // Everything that casts shadows is static (the level), so render the shadow map once and again
  // only when the level changes (set renderer.shadowMap.needsUpdate).
  renderer.shadowMap.autoUpdate = false;
  renderer.shadowMap.needsUpdate = true;

  const scene = new THREE.Scene();
  const envMap = createEnvironment(renderer); // sky-lit reflections and ambient light for all PBR materials
  scene.environment = envMap;
  scene.environmentIntensity = environmentIntensity;
  const skyDome = createSkyDome(skyRadius); // follows the camera so the far plane can never clip it
  scene.add(skyDome);
  scene.fog = new THREE.Fog(fogColor, fog.near, fog.far);

  const camera = new THREE.PerspectiveCamera(fov, window.innerWidth / window.innerHeight, 0.1, cameraFar);

  /** Match the renderer and camera to the window; returns the new aspect ratio. */
  function resize() {
    renderer.setSize(window.innerWidth, window.innerHeight);
    const aspect = window.innerWidth / window.innerHeight;
    camera.aspect = aspect;
    camera.updateProjectionMatrix();
    return aspect;
  }

  return { renderer, scene, camera, skyDome, envMap, resize };
}
