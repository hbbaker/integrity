/*
 * The heightfield: ground heights on a grid, the height between grid points, and the ground normal.
 */
import { load } from './support/modules.mjs';

const { Heightfield } = await load('heightfield');

let fails = 0;
const check = (ok, msg) => { console.log(`${ok ? 'ok  ' : 'FAIL'}: ${msg}`); if (!ok) fails++; };
const near = (a, b, tolerance = 1e-5) => Math.abs(a - b) <= tolerance;

// One 2 m cell at (10, 20) with four different corner heights.
const cell = new Heightfield({ minX: 10, minZ: 20, cell: 2, columns: 1, rows: 1 });
cell.heights.set([0, 1, 2, 10]); // (column 0, row 0), (1, 0), (0, 1), (1, 1)

check(cell.maxX === 12 && cell.maxZ === 22, 'should span columns x cell and rows x cell when it is built');
check(cell.heightAt(10, 20) === 0 && cell.heightAt(12, 20) === 1 && cell.heightAt(10, 22) === 2 && cell.heightAt(12, 22) === 10, 'should return the stored height when the point is a grid point');
check(near(cell.heightAt(10.5, 20.5), 0.75), 'should read the triangle at the near corner when the point is in the near half of a cell');
check(near(cell.heightAt(11.5, 21.5), 5.75), 'should read the triangle at the far corner when the point is in the far half of a cell');
check(near(cell.heightAt(11, 21), 1.5), 'should give the middle of the shared edge when the point is on the diagonal');
check(cell.heightAt(-50, 20) === 0 && cell.heightAt(99, 99) === 10, 'should use the nearest edge when the point is outside the grid');

// A plane that rises 0.5 m per metre along +X.
const plane = new Heightfield({ minX: -10, minZ: -10, cell: 1, columns: 20, rows: 20 });
plane.fill((x) => 0.5 * x);
const normal = plane.normalAt(0.3, 1.7, { x: 0, y: 0, z: 0 });
const length = Math.hypot(0.5, 1);
check(near(plane.heightAt(3.25, -4.5), 1.625), 'should follow the plane exactly when every grid point is on one plane');
check(near(normal.x, -0.5 / length) && near(normal.y, 1 / length) && near(normal.z, 0), 'should give the normal of the plane when the ground is a plane');
check(near(Math.hypot(normal.x, normal.y, normal.z), 1), 'should give a unit normal');
const facet = plane.facetNormalAt(0.3, 1.7, { x: 0, y: 0, z: 0 });
check(near(facet.x, normal.x) && near(facet.y, normal.y) && near(facet.z, normal.z), 'should give the same normal for the triangle under a point when the ground is a plane');
const step = new Heightfield({ minX: 0, minZ: 0, cell: 1, columns: 4, rows: 1 });
step.fill((x) => (x >= 2 ? 0 : 5)); // a 5 m step down between x = 1 and x = 2
const beforeEdge = step.facetNormalAt(0.9, 0.2, { x: 0, y: 0, z: 0 });
const onFace = step.facetNormalAt(1.5, 0.2, { x: 0, y: 0, z: 0 });
check(beforeEdge.y === 1 && onFace.x > 0.9, 'should keep an edge sharp: level right up to it, steep on the face');
check(step.normalAt(0.9, 0.2, { x: 0, y: 0, z: 0 }).y < 0.99, 'should round the same edge off in the smooth normal');
check(plane.heightOf(20, 0) === 5 && plane.pointX(20) === 10 && plane.pointZ(0) === -10, 'should fill every grid point from the height function, the last column included');

const throws = (make) => { try { make(); return false; } catch { return true; } };
check(throws(() => new Heightfield({ minX: 0, minZ: 0, cell: 1, columns: 2.5, rows: 2 })), 'should refuse a grid when the number of cells is not whole');
check(throws(() => new Heightfield({ minX: 0, minZ: 0, cell: 0, columns: 2, rows: 2 })), 'should refuse a grid when the cell size is not above zero');

console.log(fails ? `${fails} FAILED` : 'ALL OK');
process.exit(fails ? 1 : 0);
