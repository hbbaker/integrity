import * as THREE from 'three';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { MTLLoader } from 'three/addons/loaders/MTLLoader.js';

/*
 * Loads the 3D model of an armor piece and fits it to the body.
 *
 * The file is loaded once per piece and cached. The result is a group whose origin is the
 * middle of the model's base, scaled to `model.height` metres, turned by `model.turn` and
 * lifted by `model.lift`. Callers put a clone of it on the body: clones share the geometry
 * and materials, so nothing here may be disposed.
 */

const modelCache = new Map(); // piece id -> Promise<THREE.Group>

/** Centre the object on its base, scale it to `height` metres, and wrap it so that turn and lift act on the fitted result. */
export function fitModel(object, { height, lift, turn }) {
  const box = new THREE.Box3().setFromObject(object);
  const size = box.getSize(new THREE.Vector3());
  if (!(size.y > 0)) throw new Error('Armor model has no height');
  const centre = box.getCenter(new THREE.Vector3());
  const scale = height / size.y;

  const fitted = new THREE.Group();
  object.position.set(-centre.x * scale, -box.min.y * scale, -centre.z * scale);
  object.scale.setScalar(scale);
  fitted.add(object);
  fitted.rotation.y = turn;
  fitted.position.y = lift;
  return fitted;
}

async function loadModel(piece) {
  const { folder, obj, mtl } = piece.model;
  const materials = await new MTLLoader().setPath(folder).loadAsync(mtl);
  materials.preload();
  const object = await new OBJLoader().setMaterials(materials).setPath(folder).loadAsync(obj);
  object.traverse((node) => {
    if (node.material?.map) node.material.map.colorSpace = THREE.SRGBColorSpace;
  });
  return fitModel(object, piece.model);
}

/** @returns {Promise<THREE.Group>} a fresh copy of the fitted model for `piece` (an entry of ARMOR_PARTS). */
export async function loadArmorModel(piece) {
  if (!modelCache.has(piece.id)) {
    const loading = loadModel(piece);
    modelCache.set(piece.id, loading);
    loading.catch(() => modelCache.delete(piece.id)); // let a later call try again
  }
  return (await modelCache.get(piece.id)).clone();
}
