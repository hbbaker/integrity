/*
 * HEIGHTFIELD: ground heights on a regular grid, and the two questions movement asks of the ground:
 * how high is it at a point, and which way does it face?
 *
 * The grid has `columns` x `rows` square cells of `cell` metres, so (columns + 1) x (rows + 1) heights.
 * Columns run along +X from minX, rows along +Z from minZ. Each cell is two triangles, split along the
 * diagonal between its (column + 1, row) and (column, row + 1) corners. heightAt() reads those same
 * triangles, so a mesh drawn from the grid and a body that stands on it agree exactly.
 *
 * The ground can be pressed down (stamp): `heights` is then the pressed surface, and `pressed` holds how far
 * each grid point went down from the base ground it was filled with.
 */

import { clamp, smoothstep } from './math.js';

export class Heightfield {
  /** @param grid { minX, minZ, cell (metres), columns, rows (whole numbers of cells) } */
  constructor({ minX, minZ, cell, columns, rows }) {
    if (!Number.isInteger(columns) || !Number.isInteger(rows) || columns < 1 || rows < 1) {
      throw new Error(`a heightfield needs a whole number of cells each way, got ${columns} x ${rows}`);
    }
    if (!(cell > 0)) throw new Error(`a heightfield needs a cell size above 0, got ${cell}`);
    this.minX = minX;
    this.minZ = minZ;
    this.cell = cell;
    this.columns = columns;
    this.rows = rows;
    this.stride = columns + 1; // grid points in one row
    this.heights = new Float32Array(this.stride * (rows + 1));
    this.pressed = new Float32Array(this.heights.length); // metres each grid point is pressed down
    this.baseHeights = new Map(); // grid point (its place in `heights`) -> its base height, for each point that is pressed down
  }

  get maxX() { return this.minX + this.columns * this.cell; }

  get maxZ() { return this.minZ + this.rows * this.cell; }

  /** World X of a grid column. */
  pointX(column) { return this.minX + column * this.cell; }

  /** World Z of a grid row. */
  pointZ(row) { return this.minZ + row * this.cell; }

  /** The height stored at one grid point. */
  heightOf(column, row) { return this.heights[row * this.stride + column]; }

  /** The height of the base ground at one grid point: what it was before anything pressed it down. */
  baseHeightOf(column, row) {
    const index = row * this.stride + column;
    return this.baseHeights.get(index) ?? this.heights[index];
  }

  /** Set every grid height from `height(x, z)`. Nothing is pressed down after it. */
  fill(height) {
    this.pressed.fill(0);
    this.baseHeights.clear();
    for (let row = 0; row <= this.rows; row++) {
      const z = this.pointZ(row);
      for (let column = 0; column <= this.columns; column++) {
        this.heights[row * this.stride + column] = height(this.pointX(column), z);
      }
    }
  }

  /**
   * Press the ground down around (x, z): by `depth` metres at the middle, less toward `radius`, nothing beyond it.
   * A point that is already pressed deeper stays as it is, so many stamps in one place do not dig a hole.
   * Returns true when a grid point moved.
   */
  stamp(x, z, radius, depth) {
    const fromColumn = Math.max(0, Math.ceil((x - radius - this.minX) / this.cell));
    const toColumn = Math.min(this.columns, Math.floor((x + radius - this.minX) / this.cell));
    const fromRow = Math.max(0, Math.ceil((z - radius - this.minZ) / this.cell));
    const toRow = Math.min(this.rows, Math.floor((z + radius - this.minZ) / this.cell));
    let moved = false;
    for (let row = fromRow; row <= toRow; row++) {
      for (let column = fromColumn; column <= toColumn; column++) {
        const distance = Math.hypot(this.pointX(column) - x, this.pointZ(row) - z);
        const wanted = depth * (1 - smoothstep(0, radius, distance));
        const index = row * this.stride + column;
        if (wanted <= this.pressed[index]) continue;
        if (!this.baseHeights.has(index)) this.baseHeights.set(index, this.heights[index]);
        this.heights[index] = this.baseHeights.get(index) - wanted;
        this.pressed[index] = wanted;
        moved = true;
      }
    }
    return moved;
  }

  /** Bring all pressed ground back up to the base ground. */
  liftPressed() {
    for (const [index, height] of this.baseHeights) this.heights[index] = height;
    this.baseHeights.clear();
    this.pressed.fill(0);
  }

  /** Ground height at (x, z). A point outside the grid gets the height of the nearest edge. */
  heightAt(x, z) {
    const u = clamp((x - this.minX) / this.cell, 0, this.columns);
    const v = clamp((z - this.minZ) / this.cell, 0, this.rows);
    const column = Math.min(Math.floor(u), this.columns - 1);
    const row = Math.min(Math.floor(v), this.rows - 1);
    const fx = u - column;
    const fz = v - row;
    const index = row * this.stride + column;
    const heights = this.heights;
    const h10 = heights[index + 1];
    const h01 = heights[index + this.stride];
    if (fx + fz <= 1) { // the triangle at the cell's (column, row) corner
      const h00 = heights[index];
      return h00 + (h10 - h00) * fx + (h01 - h00) * fz;
    }
    const h11 = heights[index + this.stride + 1];
    return h11 + (h01 - h11) * (1 - fx) + (h10 - h11) * (1 - fz);
  }

  /**
   * The unit normal of the one flat triangle of ground under (x, z), written into `out` ({ x, y, z }). It is exact
   * for what heightAt() returns, sharp edges included: use it for contact. normalAt() is the smooth one.
   */
  facetNormalAt(x, z, out) {
    const u = clamp((x - this.minX) / this.cell, 0, this.columns);
    const v = clamp((z - this.minZ) / this.cell, 0, this.rows);
    const column = Math.min(Math.floor(u), this.columns - 1);
    const row = Math.min(Math.floor(v), this.rows - 1);
    const index = row * this.stride + column;
    const heights = this.heights;
    const h10 = heights[index + 1];
    const h01 = heights[index + this.stride];
    const nearCorner = (u - column) + (v - row) <= 1;
    const riseX = nearCorner ? h10 - heights[index] : heights[index + this.stride + 1] - h01;
    const riseZ = nearCorner ? h01 - heights[index] : heights[index + this.stride + 1] - h10;
    const length = Math.hypot(riseX, this.cell, riseZ);
    out.x = -riseX / length;
    out.y = this.cell / length;
    out.z = -riseZ / length;
    return out;
  }

  /** The unit normal of the ground at (x, z), written into `out` ({ x, y, z }). It is smoothed over one cell each way. */
  normalAt(x, z, out) {
    const reach = this.cell;
    const fallX = this.heightAt(x - reach, z) - this.heightAt(x + reach, z);
    const fallZ = this.heightAt(x, z - reach) - this.heightAt(x, z + reach);
    const up = 2 * reach;
    const length = Math.hypot(fallX, up, fallZ);
    out.x = fallX / length;
    out.y = up / length;
    out.z = fallZ / length;
    return out;
  }
}
