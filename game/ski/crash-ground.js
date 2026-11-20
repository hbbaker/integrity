import * as THREE from 'three';

/*
 * CRASH GROUND: the snow, trees and rocks that a crash can hit, in the physics world. A course is far too
 * big to put into the physics world whole, so this keeps a square patch of it around a point and moves the
 * patch when that point comes near its edge. The triangles are the same ones the heightfield draws and
 * the rider stands on, at the height of the base ground: snow that is pressed down (tracks, craters) does not
 * move the physics ground (docs/adr/0005).
 */

const TREE_COLLIDER_HEIGHT = 4; // metres of trunk that count (a body never flies higher than that into a tree)

export class CrashGround {
  /**
   * @param deps { physics (a PhysicsWorld), course (from buildCourse), config (CONFIG.ski.crash.ground),
   *   layer, hits (the collision layer of the ground and the layers that hit it) }
   */
  constructor({ physics, course, config, layer, hits }) {
    this.physics = physics;
    this.course = course;
    this.config = config;
    this.surface = { friction: config.friction, layer, hits };
    this.statics = [];
    this.centre = null; // { column, row } of the grid point in the middle of the patch
    this._base = new THREE.Vector3();
  }

  /** Make sure the ground is there around (x, z). Cheap when the patch still covers it. */
  follow(x, z) {
    const field = this.course.heightfield;
    const column = Math.round((x - field.minX) / field.cell);
    const row = Math.round((z - field.minZ) / field.cell);
    const { halfCells, marginCells } = this.config;
    if (this.centre && Math.abs(column - this.centre.column) <= halfCells - marginCells && Math.abs(row - this.centre.row) <= halfCells - marginCells) return;
    this._clear();
    this.centre = { column, row };
    this._build(Math.max(0, column - halfCells), Math.min(field.columns, column + halfCells), Math.max(0, row - halfCells), Math.min(field.rows, row + halfCells));
  }

  _build(fromColumn, toColumn, fromRow, toRow) {
    const field = this.course.heightfield;
    const side = toColumn - fromColumn + 1;
    const positions = new Float32Array(side * (toRow - fromRow + 1) * 3);
    const indices = new Uint32Array((toColumn - fromColumn) * (toRow - fromRow) * 6);
    let next = 0;
    for (let row = fromRow; row <= toRow; row++) {
      for (let column = fromColumn; column <= toColumn; column++) {
        positions[next++] = field.pointX(column);
        positions[next++] = field.baseHeightOf(column, row);
        positions[next++] = field.pointZ(row);
      }
    }
    next = 0;
    for (let row = 0; row < toRow - fromRow; row++) {
      for (let column = 0; column < toColumn - fromColumn; column++) { // split like Heightfield.heightAt, wound to face up
        const corner = row * side + column;
        indices[next++] = corner;
        indices[next++] = corner + side;
        indices[next++] = corner + 1;
        indices[next++] = corner + 1;
        indices[next++] = corner + side;
        indices[next++] = corner + side + 1;
      }
    }
    const { physics, surface } = this;
    this.statics.push(physics.addGround({ positions, indices, ...surface }));

    const minX = field.pointX(fromColumn);
    const maxX = field.pointX(toColumn);
    const minZ = field.pointZ(fromRow);
    const maxZ = field.pointZ(toRow);
    for (const obstacle of this.course.obstacles) {
      if (obstacle.x < minX || obstacle.x > maxX || obstacle.z < minZ || obstacle.z > maxZ) continue;
      if (obstacle.kind === 'tree') {
        this.statics.push(physics.addPillar({ base: this._base.set(obstacle.x, obstacle.y, obstacle.z), radius: obstacle.radius, height: TREE_COLLIDER_HEIGHT, ...surface }));
      } else {
        this.statics.push(physics.addBoulder({ centre: this._base.set(obstacle.x, obstacle.y, obstacle.z), radius: obstacle.radius, ...surface }));
      }
    }
  }

  _clear() {
    for (const collider of this.statics) this.physics.removeStatic(collider);
    this.statics.length = 0;
  }

  /** Take the ground out of the physics world. */
  dispose() {
    this._clear();
    this.centre = null;
  }
}
