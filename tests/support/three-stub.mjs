/* Real Three.js, except the parts that need a GPU. Used by the boot test through three-hooks.mjs. */
import { Texture } from '../../node_modules/three/build/three.module.js';

export * from '../../node_modules/three/build/three.module.js';

const noop = () => {};

export class WebGLRenderer {
  constructor() {
    this.shadowMap = { enabled: false, type: 0, autoUpdate: true, needsUpdate: false };
    this.domElement = {};
    this.renders = 0;
  }

  setPixelRatio = noop;
  setSize = noop;
  clear = noop;
  clearDepth = noop;
  render() { this.renders += 1; }
}

export class PMREMGenerator {
  fromScene() { return { texture: new Texture() }; }
  dispose = noop;
}
