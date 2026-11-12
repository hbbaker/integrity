import * as THREE from 'three';
import { BodyRig } from '../assets/body-rig.js';
import { HUMANOID_KIT, HUMANOID_MATERIALS } from '../assets/humanoid.js';
import { createSuitBody, setSuitPart } from '../assets/mech-suit.js';
import { YBotSkin, loadYBot } from '../assets/y-bot.js';

/*
 * The turntable in the middle of the character screen: the grey human or the mech suit,
 * on its own small renderer so the main game view is never touched. The renderer is made
 * on first open and drawn only while the screen is open. Drag to turn the figure; it also
 * turns slowly by itself.
 */

const CAMERA_FOV = 32;
const CAMERA_DISTANCE = 5.6;
const LOOK_HEIGHT = 1.05;
const AUTO_TURN = 0.45; // radians per second
const DRAG_TURN = 0.012; // radians per pixel dragged
const BACKGROUND = 0x0a0d18;

export class CharacterPreview {
  /** @param {{ canvas: HTMLCanvasElement, suitScale: number, selection: Record<string, string>, skinLoader?: Function }} options */
  constructor({ canvas, suitScale, selection, skinLoader = loadYBot }) {
    this.canvas = canvas;
    this.suitScale = suitScale;
    this.renderer = null;
    this.frame = 0;
    this.spin = Math.PI * 0.12;
    this.dragging = false;
    this.lastTime = 0;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(BACKGROUND);
    this.scene.add(new THREE.HemisphereLight(0xcfe8ff, 0x202833, 1.5));
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(2.5, 4, 3);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0x00f0ff, 1.6);
    rim.position.set(-3, 2, -3);
    this.scene.add(rim);
    const floor = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.2, 0.05, 32), new THREE.MeshStandardMaterial({ color: 0x1b2230, metalness: 0.5, roughness: 0.6 }));
    floor.position.y = -0.03;
    this.scene.add(floor);

    this.turntable = new THREE.Group();
    this.scene.add(this.turntable);

    this.human = new BodyRig(HUMANOID_MATERIALS);
    this.human.setKit(HUMANOID_KIT, HUMANOID_MATERIALS);
    this.humanSkin = new YBotSkin(this.human, { load: skinLoader });
    this.turntable.add(this.human.root);

    this.suit = createSuitBody(selection);
    this.suit.root.scale.setScalar(suitScale);
    this.turntable.add(this.suit.root);

    this.camera = new THREE.PerspectiveCamera(CAMERA_FOV, 1, 0.1, 50);

    this.showSuit(false);
    this._bindDrag();
  }

  /** Show the suit (true) or the human (false) on the turntable. */
  showSuit(showSuit) {
    this.suit.root.visible = showSuit;
    this.human.root.visible = !showSuit;
    const scale = showSuit ? this.suitScale : 1; // frame the bigger suit from further back
    this.camera.position.set(0, (LOOK_HEIGHT + 0.3) * scale, CAMERA_DISTANCE * scale);
    this.camera.lookAt(0, LOOK_HEIGHT * scale, 0);
  }

  setPart(slot, id) {
    setSuitPart(this.suit, slot, id);
  }

  /** Start drawing into the canvas. The renderer is made once: a canvas cannot get a new GL context after losing one. */
  start() {
    if (!this.renderer) {
      this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true });
      this.renderer.setPixelRatio(Math.min(2, globalThis.devicePixelRatio || 1));
    }
    cancelAnimationFrame(this.frame);
    this.lastTime = performance.now();
    this._tick(this.lastTime);
  }

  /** Stop drawing (the renderer stays, ready for the next open). */
  stop() {
    cancelAnimationFrame(this.frame);
  }

  render(dt) {
    if (!this.renderer) return;
    const width = this.canvas.clientWidth || 1;
    const height = this.canvas.clientHeight || 1;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    if (!this.dragging) this.spin += AUTO_TURN * dt;
    this.turntable.rotation.y = this.spin;
    this.renderer.render(this.scene, this.camera);
  }

  _tick = (now) => {
    const dt = Math.min(0.1, (now - this.lastTime) / 1000);
    this.lastTime = now;
    this.render(dt);
    this.frame = requestAnimationFrame(this._tick);
  };

  _bindDrag() {
    let lastX = 0;
    this.canvas.addEventListener('pointerdown', (event) => {
      this.dragging = true;
      lastX = event.clientX;
      this.canvas.setPointerCapture?.(event.pointerId);
    });
    this.canvas.addEventListener('pointermove', (event) => {
      if (!this.dragging) return;
      this.spin += (event.clientX - lastX) * DRAG_TURN;
      lastX = event.clientX;
    });
    const release = () => { this.dragging = false; };
    this.canvas.addEventListener('pointerup', release);
    this.canvas.addEventListener('pointercancel', release);
  }
}
