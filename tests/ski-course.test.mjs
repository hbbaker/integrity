/*
 * The FREERIDE course: the ground, the start and the finish, and the trees and rocks, built from the course definition.
 */
import { load, loadConfig } from './support/modules.mjs';

const { buildCourse, DOWNHILL_YAW } = await load('ski-course');
const { FREERIDE_COURSE } = await load('ski-course-freeride');

let fails = 0;
const check = (ok, msg) => { console.log(`${ok ? 'ok  ' : 'FAIL'}: ${msg}`); if (!ok) fails++; };

const CONFIG = await loadConfig();
const { cell, chunkCells } = CONFIG.ski.terrain;
const definition = FREERIDE_COURSE;
const course = buildCourse(definition, cell);
const again = buildCourse(definition, cell);
const field = course.heightfield;
const distanceOf = (point) => field.maxZ - point.z;
const upwardAt = (point) => field.normalAt(point.x, point.z, { x: 0, y: 0, z: 0 }).y;
const trees = course.obstacles.filter((obstacle) => obstacle.kind === 'tree');
const rocks = course.obstacles.filter((obstacle) => obstacle.kind === 'rock');

check(field.columns * cell === definition.width && field.rows * cell === definition.length, 'should make a grid of the size in the definition');
check(field.columns % chunkCells === 0 && field.rows % chunkCells === 0, 'should be a whole number of terrain chunks, so the terrain mesh accepts it');
check(course.heightfield.heights.every((height, index) => height === again.heightfield.heights[index]) && JSON.stringify(course.obstacles) === JSON.stringify(again.obstacles), 'should build the same ground, trees and rocks when it is built twice');

check(course.start.yaw === DOWNHILL_YAW && course.start.z > course.finish.z, 'should run down toward -Z, the way the rider faces at the start');
check(course.start.y - course.finish.y > 400, 'should drop more than 400 m from the start to the finish');
check(course.start.y === field.heightAt(course.start.x, course.start.z), 'should put the start on the ground');
check(upwardAt(course.start) > Math.cos(8 * Math.PI / 180), 'should give the rider a bench of less than 8 degrees to stand on at the start');
check(upwardAt(course.finish) > Math.cos(8 * Math.PI / 180), 'should make the finish flat');
check(field.heights.every((height) => height > 0), 'should keep all ground above zero');

const bigDrop = definition.drops.reduce((big, drop) => (drop.height > big.height ? drop : big));
const dropFall = field.heightAt(bigDrop.x, field.maxZ - (bigDrop.distance - 1)) - field.heightAt(bigDrop.x, field.maxZ - (bigDrop.distance + 4));
check(dropFall > bigDrop.height, `should fall more than ${bigDrop.height} m over the face of the biggest cliff band (it falls ${dropFall.toFixed(1)} m)`);
const beside = bigDrop.x + bigDrop.width / 2 + 15;
const besideFall = field.heightAt(beside, field.maxZ - (bigDrop.distance - 1)) - field.heightAt(beside, field.maxZ - (bigDrop.distance + 4));
check(besideFall < bigDrop.height / 2, 'should leave a way round when the rider goes past the side of a cliff band');

check(course.markers.length === definition.markers.length && course.markers.every((marker, index) => index === 0 || marker.y < course.markers[index - 1].y), 'should place the markers in order down the hill');
check(course.markers[0].x === course.start.x && course.markers[0].z === course.start.z, 'should make the first marker the start');

check(trees.length > 500 && rocks.length > 50, `should grow a forest and scatter rocks (${trees.length} trees, ${rocks.length} rocks)`);
check(course.obstacles.every((obstacle) => obstacle.y === field.heightAt(obstacle.x, obstacle.z)), 'should stand every tree and rock on the ground');
check(course.obstacles.every((obstacle) => Math.abs(obstacle.x) < definition.width / 2 && distanceOf(obstacle) > 0 && distanceOf(obstacle) < definition.length), 'should keep every tree and rock inside the course');
check(course.obstacles.every((obstacle) => Math.hypot(obstacle.x - course.start.x, obstacle.z - course.start.z) >= definition.start.clearRadius), 'should keep the start clear of trees and rocks');
check(course.obstacles.every((obstacle) => !(distanceOf(obstacle) > definition.finish.distance - definition.finish.clearLength && Math.abs(obstacle.x) < definition.banks.flatHalfWidth)), 'should keep the finish stretch clear of trees and rocks');
const inLanding = (obstacle) => definition.drops.some((drop) => distanceOf(obstacle) > drop.distance && distanceOf(obstacle) < drop.distance + 14 && Math.abs(obstacle.x - drop.x) < drop.width / 2);
check(!course.obstacles.some(inLanding), 'should keep the landing of every drop clear of trees and rocks');
check(trees.every((tree) => upwardAt(tree) >= definition.trees.minUpward), 'should grow no tree on ground that is too steep');
let closest = Infinity;
for (let i = 0; i < trees.length; i++) {
  for (let j = i + 1; j < trees.length; j++) closest = Math.min(closest, Math.hypot(trees[i].x - trees[j].x, trees[i].z - trees[j].z));
}
check(closest >= definition.trees.spacing, `should keep trees at least ${definition.trees.spacing} m apart (closest pair: ${closest.toFixed(2)} m)`);
const onRun = trees.filter((tree) => Math.abs(tree.x) < definition.banks.flatHalfWidth - definition.trees.bankBlend);
const inGlade = (tree) => definition.trees.glades.some((glade) => distanceOf(tree) >= glade.from && distanceOf(tree) <= glade.to);
check(onRun.filter(inGlade).length > onRun.length / 2, 'should grow most of the trees on the run inside the glades');
check(trees.every((tree) => tree.height >= definition.trees.minHeight && tree.height <= definition.trees.maxHeight && tree.radius >= definition.trees.minTrunkRadius && tree.radius <= definition.trees.maxTrunkRadius), 'should size every tree inside the limits of the definition');

console.log(fails ? `${fails} FAILED` : 'ALL OK');
process.exit(fails ? 1 : 0);
