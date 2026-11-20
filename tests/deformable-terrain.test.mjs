/*
 * The terrain mesh: chunks drawn from a heightfield, and a cheap redraw of only what changed.
 */
import { load, installDomStubs } from './support/modules.mjs';

installDomStubs();
const THREE = await import('three');
const { Heightfield } = await load('heightfield');
const { DeformableTerrain } = await load('deformable-terrain');

let fails = 0;
const check = (ok, msg) => { console.log(`${ok ? 'ok  ' : 'FAIL'}: ${msg}`); if (!ok) fails++; };
const near = (a, b, tolerance = 1e-4) => Math.abs(a - b) <= tolerance;

const FLAT = 0xffffff;
const STEEP = 0x000000;
const options = { chunkCells: 40, material: new THREE.MeshBasicMaterial(), textureTile: 8, flatColor: FLAT, steepColor: STEEP, steepStart: 0.72, steepFull: 0.55 };
const field = new Heightfield({ minX: -40, minZ: -60, cell: 1, columns: 80, rows: 120 });
field.fill((x, z) => Math.sin(x * 0.1) * 2 + z * 0.2);
const terrain = new DeformableTerrain({ heightfield: field, ...options });

check(terrain.chunks.length === 6 && terrain.group.children.length === 6, 'should make one mesh for each chunk when the grid is 2 x 3 chunks');

const onGround = terrain.chunks.every((chunk) => {
  const position = chunk.mesh.geometry.attributes.position;
  for (let i = 0; i < position.count; i++) {
    if (!near(position.getY(i), field.heightAt(position.getX(i), position.getZ(i)))) return false;
  }
  return true;
});
check(onGround, 'should put every vertex on the heightfield');

const first = terrain.chunks[0].mesh.geometry;
const corner = (i) => new THREE.Vector3().fromBufferAttribute(first.attributes.position, first.index.getX(i));
const face = new THREE.Vector3().crossVectors(corner(1).sub(corner(0)), corner(2).sub(corner(0)));
check(face.y > 0, 'should wind the triangles so that the ground faces up');
check(first.index === terrain.chunks[5].mesh.geometry.index && first.attributes.uv === terrain.chunks[5].mesh.geometry.attributes.uv, 'should share one index buffer and one UV buffer between all chunks');
check(first.boundingSphere !== null && first.boundingSphere.radius > 20, 'should give each chunk a bounding sphere, so a chunk out of view is not drawn');

// Press the ground down in the middle of the first chunk.
const column = 20;
const row = 20;
field.heights[row * field.stride + column] -= 3;
const x = field.pointX(column);
const z = field.pointZ(row);
const redrawn = terrain.redraw(x, x, z, z);
const moved = terrain.chunks[0].mesh.geometry.attributes.position.getY(row * 41 + column);
check(redrawn === 1, 'should redraw one chunk when the change is inside it');
check(near(moved, field.heightOf(column, row)), 'should move the vertex to the new height when its chunk is redrawn');
check(terrain.redraw(0, 0, z, z) === 2, 'should redraw both chunks when the change is on their shared edge');
check(terrain.redraw(500, 501, 500, 501) === 0, 'should redraw nothing when the change is outside the terrain');

// A wall-steep plane takes the steep colour; level ground keeps the flat colour.
const steepField = new Heightfield({ minX: 0, minZ: 0, cell: 1, columns: 40, rows: 40 });
steepField.fill((px) => px * 5);
const steepColor = new DeformableTerrain({ heightfield: steepField, ...options }).chunks[0].mesh.geometry.attributes.color;
const levelColor = new DeformableTerrain({ heightfield: new Heightfield({ minX: 0, minZ: 0, cell: 1, columns: 40, rows: 40 }), ...options }).chunks[0].mesh.geometry.attributes.color;
const middle = 20 * 41 + 20;
check(steepColor.getX(middle) === 0 && levelColor.getX(middle) === 1, 'should colour a vertex by how steep the ground is there');

const throws = (make) => { try { make(); return false; } catch { return true; } };
check(throws(() => new DeformableTerrain({ heightfield: field, ...options, chunkCells: 30 })), 'should refuse a grid when it is not a whole number of chunks');
check(throws(() => new DeformableTerrain({ heightfield: field, ...options, textureTile: 7 })), 'should refuse a chunk when it is not a whole number of texture tiles');

terrain.dispose();
check(terrain.group.parent === null, 'should leave the scene when it is disposed');

console.log(fails ? `${fails} FAILED` : 'ALL OK');
process.exit(fails ? 1 : 0);
