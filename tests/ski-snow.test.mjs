/*
 * The snow of the mountain mode: ground that is pressed down, the track ribbons, and what a ride, a landing
 * and a fallen body do to it (docs/adr/0005 and 0014).
 */
import { load, installDomStubs } from './support/modules.mjs';

installDomStubs();
const THREE = await import('three');
const { Heightfield } = await load('heightfield');
const { DeformableTerrain } = await load('deformable-terrain');
const { TrailRibbon } = await load('trail-ribbon');
const { SnowTracks } = await load('ski-snow-tracks');
const { CONFIG } = await load('game/config');

let fails = 0;
const check = (ok, msg) => { console.log(`${ok ? 'ok  ' : 'FAIL'}: ${msg}`); if (!ok) fails++; };
const near = (a, b, tolerance = 1e-5) => Math.abs(a - b) <= tolerance;
const STEP = 1 / 60;

/* ---------------------------- pressed ground ---------------------------- */
const LEVEL = 10;
const makeField = () => {
  const field = new Heightfield({ minX: -40, minZ: -80, cell: 1, columns: 80, rows: 160 });
  field.fill(() => LEVEL);
  return field;
};
const field = makeField();
check(field.stamp(0, 0, 2, 0.5) === true, 'should say the ground moved when a stamp reaches a grid point');
check(near(field.heightAt(0, 0), LEVEL - 0.5), 'should press the ground down by the whole depth at the middle of a stamp');
check(field.heightAt(1, 0) < LEVEL && field.heightAt(1, 0) > LEVEL - 0.5, 'should press less toward the edge of a stamp');
check(field.heightAt(2, 0) === LEVEL && field.heightAt(3, 3) === LEVEL, 'should leave the ground alone at the radius and beyond it');
check(near(field.baseHeightOf(40, 80), LEVEL) && near(field.heightOf(40, 80), LEVEL - 0.5), 'should keep the base height of a point that is pressed down');
check(field.stamp(0, 0, 2, 0.5) === false && near(field.heightAt(0, 0), LEVEL - 0.5), 'should not dig deeper when the same stamp comes again');
check(field.stamp(0, 0, 2, 0.8) === true && near(field.heightAt(0, 0), LEVEL - 0.8), 'should go down to the new depth when a deeper stamp comes');
check(field.stamp(0.5, 0.5, 0.4, 1) === false, 'should move nothing when a stamp is too small to reach a grid point');
field.liftPressed();
check(field.heightAt(0, 0) === LEVEL && field.heightAt(1, 0) === LEVEL && field.pressed.every((depth) => depth === 0), 'should be the base ground again when the pressed ground is lifted');

/* ------------------------------ trail ribbon ---------------------------- */
const ribbon = new TrailRibbon({ pieces: 3, material: new THREE.MeshBasicMaterial() });
const pair = (z) => [{ x: -1, y: 5, z }, { x: 1, y: 5, z }];
ribbon.add(...pair(0));
check(ribbon.count === 0, 'should only start a line with the first pair of points');
ribbon.add(...pair(-1));
const corners = ribbon.positions.array;
check(ribbon.count === 1 && corners[2] === 0 && corners[8] === -1 && corners[0] === -1 && corners[3] === 1, 'should lay one piece from the last pair of points to the new pair');
const index = ribbon.mesh.geometry.index;
const corner = (i) => new THREE.Vector3().fromBufferAttribute(ribbon.positions, index.getX(i));
check(new THREE.Vector3().crossVectors(corner(1).sub(corner(0)), corner(2).sub(corner(0))).y > 0, 'should face up when the path runs toward -Z');
ribbon.breakLine();
ribbon.add(...pair(-5));
check(ribbon.count === 1, 'should not join across a break in the line');
ribbon.add(...pair(-6));
ribbon.add(...pair(-7));
ribbon.add(...pair(-8));
check(ribbon.count === 3 && corners[2] === -7 && corners[8] === -8, 'should put a new piece in the place of the oldest when it is full');
const settled = ribbon.settle(-2, 2, -6.5, -4, () => 3, 0.5);
check(settled === 6 && corners[12 + 1] === 3.5 && corners[12 + 7] === 3.5 && corners[24 + 7] === 5, 'should put only the corners inside the rectangle back on the ground');
ribbon.clear();
check(ribbon.count === 0 && corners.every((value) => value === 0), 'should be empty when it is cleared');
const throws = (make) => { try { make(); return false; } catch { return true; } };
check(throws(() => new TrailRibbon({ pieces: 0, material: null })) && throws(() => new TrailRibbon({ pieces: 20000, material: null })), 'should refuse a size that it cannot hold');

/* ------------------------------ snow tracks ----------------------------- */
const config = CONFIG.ski.snow;
const terrainOptions = { chunkCells: 40, material: new THREE.MeshBasicMaterial(), textureTile: 8, flatColor: 0xffffff, steepColor: 0, steepStart: 0.72, steepFull: 0.55 };
const makeSnow = (ride, lines) => {
  const snowField = makeField();
  const terrain = new DeformableTerrain({ heightfield: snowField, ...terrainOptions });
  const group = new THREE.Group();
  const particles = { spawned: 0, bursts: 0, spawn() { this.spawned += 1; }, burst() { this.bursts += 1; } };
  const snow = new SnowTracks({ heightfield: snowField, terrain, group, config, ride, lines, particles });
  return { snow, snowField, terrain, group, particles };
};
// A rider as the snow reads it: it runs straight down -Z at a steady speed.
const makeRider = (speed) => ({
  pos: new THREE.Vector3(0.3, LEVEL, 60), vel: new THREE.Vector3(0, 0, -speed), speed, heading: 0, travelYaw: 0,
  edge: 0, grounded: true, controls: { brake: 0 },
});
const run = (snow, rider, seconds) => {
  for (let t = 0; t < seconds; t += STEP) {
    rider.pos.addScaledVector(rider.vel, STEP);
    snow.ride(STEP, rider);
  }
};

const skis = makeSnow('skis', [-0.14, 0.14]);
check(skis.snow.ribbons.length === 2 && skis.group.children.length === 2, 'should draw one line for each ski');
const skier = makeRider(15);
run(skis.snow, skier, 2);
const [leftLine, rightLine] = skis.snow.ribbons;
check(leftLine.count > 40 && leftLine.count === rightLine.count, 'should lay both lines while the ride is on the snow');
const laid = leftLine.positions.array;
check(near(laid[3] - laid[0], 2 * config.tracks.halfWidth.skis) && near((laid[0] + laid[3]) / 2, 0.3 - 0.14), 'should make a line as wide as a flat ski, under the ski');
check(near(laid[1], LEVEL + config.tracks.lift), 'should lay a line on the snow');
check(skis.snowField.heightAt(0.3, 50) < LEVEL, 'should press a trough into the snow behind the rider');
const underRider = [];
for (let row = 0; row <= skis.snowField.rows; row++) {
  for (let column = 0; column <= skis.snowField.columns; column++) {
    if (Math.hypot(skis.snowField.pointX(column) - skier.pos.x, skis.snowField.pointZ(row) - skier.pos.z) < config.clearance) underRider.push(skis.snowField.pressed[row * skis.snowField.stride + column]);
  }
}
check(underRider.length > 0 && underRider.every((depth) => depth === 0), 'should leave the snow near the rider alone until the rider is clear of it');
check(skis.particles.spawned === 0, 'should throw no spray when the ride runs flat with no brake');

const before = skis.terrain.chunks.map((chunk) => chunk.mesh.geometry.attributes.position.version);
skis.snow.update();
const redrawn = skis.terrain.chunks.filter((chunk, i) => chunk.mesh.geometry.attributes.position.version !== before[i]).length;
check(redrawn >= 1 && redrawn < skis.terrain.chunks.length, 'should redraw only the chunks where the snow moved');
skis.snow.update();
check(skis.terrain.chunks.filter((chunk, i) => chunk.mesh.geometry.attributes.position.version !== before[i]).length === redrawn, 'should redraw nothing when no snow moved since the last frame');
const troughPoint = (() => { // a corner of a line that lies in the trough
  for (let at = 0; at < leftLine.count * 12; at += 3) if (skis.snowField.heightAt(laid[at], laid[at + 2]) < LEVEL - 0.01) return at;
  return -1;
})();
check(troughPoint >= 0 && near(laid[troughPoint + 1], skis.snowField.heightAt(laid[troughPoint], laid[troughPoint + 2]) + config.tracks.lift), 'should lay the track down into the trough when the snow under it went down');

// in the air, and after it
const piecesBefore = leftLine.count;
skier.grounded = false;
run(skis.snow, skier, 0.5);
check(leftLine.count === piecesBefore, 'should lay no track while the ride is in the air');
skier.grounded = true;
run(skis.snow, skier, 4 * STEP);
const newest = (leftLine.next - 1) * 12;
check(Math.abs(laid[newest + 2] - laid[newest + 8]) < 1, 'should start a new line after the air, with no piece across the gap');

// a landing
const landing = skis.snowField.heightAt(skier.pos.x, skier.pos.z);
skis.snow.land(skier.pos, 1);
const landedAt = skier.pos.clone();
check(skis.snowField.heightAt(landedAt.x, landedAt.z) === landing && skis.particles.bursts === 1, 'should puff at a landing, and leave the snow under the rider for later');
run(skis.snow, skier, 1);
const hardDent = landing - skis.snowField.heightAt(landedAt.x, landedAt.z);
check(hardDent > config.trough.hardDepth, `should leave a dent where the rider landed hard, once the rider is clear (${hardDent.toFixed(2)} m)`);
skis.snow.land(skier.pos, 0);
const softAt = skier.pos.clone();
run(skis.snow, skier, 1);
check(landing - skis.snowField.heightAt(softAt.x, softAt.z) < hardDent, 'should leave a shallower dent for a softer landing');

// carving and braking
const carver = makeRider(20);
carver.pos.z = 0;
carver.edge = 1;
run(skis.snow, carver, 0.5);
const carved = (leftLine.next - 1) * 12;
check(near(laid[carved + 9] - laid[carved + 6], 2 * config.tracks.edgeHalfWidth, 1e-4), 'should make a thin line when the ski is on its edge');
check(skis.particles.spawned > 5, 'should throw spray in a carve at speed');
carver.edge = 0;
carver.controls.brake = 1;
const sprayBefore = skis.particles.spawned;
run(skis.snow, carver, 0.5);
const skidded = (leftLine.next - 1) * 12;
check(near(laid[skidded + 9] - laid[skidded + 6], 2 * config.tracks.skidHalfWidth, 1e-4), 'should make a wide mark in a full brake');
check(skis.particles.spawned - sprayBefore > 20, 'should throw more spray in a brake');
const slow = makeRider(2);
slow.controls.brake = 1;
const sprayAtSlow = skis.particles.spawned;
run(skis.snow, slow, 0.5);
check(skis.particles.spawned === sprayAtSlow, 'should throw no spray when the ride is slow');

// a board
const board = makeSnow('board', [0]);
const boarder = makeRider(15);
boarder.edge = 1;
run(board.snow, boarder, 0.5);
const boardLine = board.snow.ribbons[0];
const boardLaid = boardLine.positions.array;
const last = (boardLine.next - 1) * 12;
check(board.snow.ribbons.length === 1, 'should draw one line for a board');
check((boardLaid[last + 6] + boardLaid[last + 9]) / 2 > boarder.pos.x + 0.05, 'should move a board\'s line toward the edge it carves on');
boarder.heading = Math.PI; // tail first
run(board.snow, boarder, 0.5);
const switchLast = (boardLine.next - 1) * 12;
check((boardLaid[switchLast + 6] + boardLaid[switchLast + 9]) / 2 < boarder.pos.x - 0.05, 'should move the line to the other side of the path when the board rides switch');

// a fallen body
const crash = makeSnow('skis', [-0.14, 0.14]);
const faller = makeRider(15);
run(crash.snow, faller, 1);
const underFaller = crash.snowField.heightAt(faller.pos.x, faller.pos.z);
crash.snow.fall();
check(crash.snowField.heightAt(faller.pos.x, faller.pos.z) < underFaller, 'should press the snow that waited, at once, when the rider goes down');
const part = new THREE.Vector3(10, LEVEL + 3, 10);
check(crash.snow.pressBody('pelvis', part, 0.13, 12) === false && crash.snowField.heightAt(10, 10) === LEVEL, 'should leave the snow alone when the body is in the air');
part.y = LEVEL + 0.13;
check(crash.snow.pressBody('pelvis', part, 0.13, 12) === true, 'should press the snow when the body touches it');
const hardCrater = LEVEL - crash.snowField.heightAt(10, 10);
check(near(hardCrater, config.crater.hardDepth), 'should make a deep crater when the body hits fast');
check(crash.particles.bursts === 1, 'should puff where the body hits');
part.x += config.crater.spacing / 2;
check(crash.snow.pressBody('pelvis', part, 0.13, 12) === false, 'should not press again until the body has moved on');
check(crash.snow.pressBody('chest', part, 0.15, 12) === true, 'should count each part of the body on its own');
part.set(20, LEVEL + 0.13, 20);
crash.snow.pressBody('pelvis', part, 0.13, 0.5);
check(LEVEL - crash.snowField.heightAt(20, 20) < hardCrater / 2, 'should make only a shallow trench when the body slides slowly');

// a new run
crash.snow.reset();
check(crash.snowField.pressed.every((depth) => depth === 0) && crash.snowField.heightAt(10, 10) === LEVEL, 'should be fresh snow when a new run starts');
check(crash.snow.ribbons.every((line) => line.count === 0), 'should have no tracks when a new run starts');
const vertex = crash.terrain.chunks.flatMap((chunk) => {
  const position = chunk.mesh.geometry.attributes.position;
  const heights = [];
  for (let i = 0; i < position.count; i++) heights.push(position.getY(i));
  return heights;
});
check(vertex.every((height) => height === LEVEL), 'should draw the fresh snow when a new run starts');

// no particle pool
const quiet = new SnowTracks({ heightfield: makeField(), terrain: crash.terrain, group: new THREE.Group(), config, ride: 'board', lines: [0], particles: null });
const braker = makeRider(20);
braker.controls.brake = 1;
run(quiet, braker, 0.3);
quiet.land(braker.pos, 1);
check(quiet.ribbons[0].count > 0, 'should still lay tracks when there is no particle pool for the spray');

crash.snow.dispose();
check(crash.group.children.length === 0, 'should take the tracks out of the scene when it is disposed');

console.log(fails ? `${fails} FAILED` : 'ALL OK');
process.exit(fails ? 1 : 0);
