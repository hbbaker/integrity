/*
 * HEIGHTFIELD: ground heights on a regular grid, and the two questions movement asks of the ground:
 * how high is it at a point, and which way does it face?
 *
 * The grid has `columns` x `rows` square cells of `cell` metres, so (columns + 1) x (rows + 1) heights.
 * Columns run along +X from minX, rows along +Z from minZ. Each cell is two triangles, split along the
 * diagonal between its (column + 1, row) and (column, row + 1) corners. heightAt() reads those same
 * triangles, so a mesh drawn from the grid and a body that stands on it agree exactly.
 */

import { clamp } from './math.js';

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
  }

  get maxX() { return this.minX + this.columns * this.cell; }

  get maxZ() { return this.minZ + this.rows * this.cell; }

  /** World X of a grid column. */
  pointX(column) { return this.minX + column * this.cell; }

  /** World Z of a grid row. */
  pointZ(row) { return this.minZ + row * this.cell; }

  /** The height stored at one grid point. */
  heightOf(column, row) { return this.heights[row * this.stride + column]; }

  /** Set every grid height from `height(x, z)`. */
  fill(height) {
    for (let row = 0; row <= this.rows; row++) {
      const z = this.pointZ(row);
      for (let column = 0; column <= this.columns; column++) {
        this.heights[row * this.stride + column] = height(this.pointX(column), z);
      }
    }
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
