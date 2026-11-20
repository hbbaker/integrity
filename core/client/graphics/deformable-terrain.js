import * as THREE from 'three';
import { clamp } from '../engine/math.js';

/*
 * DEFORMABLE TERRAIN: draws a Heightfield (core/client/engine/heightfield.js) as a grid of chunk meshes,
 * and redraws only the chunks that a change touches. Pressing the ground down in one place is then cheap.
 *
 * Every chunk has the same number of cells, so all chunks share one index buffer and one UV buffer. For
 * the shared UVs to tile without a seam, a chunk must be a whole number of texture tiles wide.
 * Vertices are coloured by steepness: `flatColor` on gentle ground, blending to `steepColor` between the
 * `steepStart` and `steepFull` values of the normal's upward part (1 = level ground, 0 = a wall).
 */

const POSITION_SIZE = 3;
const TILE_TOLERANCE = 1e-6; // metres a chunk may differ from a whole number of texture tiles

export class DeformableTerrain {
  /**
   * @param options {
   *   heightfield, chunkCells (cells along one side of a chunk), material (with vertexColors on),
   *   textureTile (metres one texture repeat covers), flatColor, steepColor, steepStart, steepFull
   * }
   */
  constructor({ heightfield, chunkCells, material, textureTile, flatColor, steepColor, steepStart, steepFull }) {
    if (heightfield.columns % chunkCells !== 0 || heightfield.rows % chunkCells !== 0) {
      throw new Error(`the heightfield (${heightfield.columns} x ${heightfield.rows} cells) is not a whole number of ${chunkCells}-cell chunks`);
    }
    const tilesPerChunk = (chunkCells * heightfield.cell) / textureTile;
    if (Math.abs(tilesPerChunk - Math.round(tilesPerChunk)) > TILE_TOLERANCE) {
      throw new Error(`a chunk (${chunkCells * heightfield.cell} m) is not a whole number of ${textureTile} m texture tiles`);
    }
    this.heightfield = heightfield;
    this.chunkCells = chunkCells;
    this.flatColor = new THREE.Color(flatColor);
    this.steepColor = new THREE.Color(steepColor);
    this.steepStart = steepStart;
    this.steepFull = steepFull;
    this.group = new THREE.Group();
    this.chunks = [];
    this._normal = { x: 0, y: 1, z: 0 };

    const index = this._buildIndex();
    const uv = this._buildUvs(textureTile);
    const side = chunkCells + 1;
    for (let row = 0; row < heightfield.rows; row += chunkCells) {
      for (let column = 0; column < heightfield.columns; column += chunkCells) {
        const geometry = new THREE.BufferGeometry();
        geometry.setIndex(index);
        geometry.setAttribute('uv', uv);
        for (const name of ['position', 'normal', 'color']) {
          geometry.setAttribute(name, new THREE.BufferAttribute(new Float32Array(side * side * POSITION_SIZE), POSITION_SIZE));
        }
        const mesh = new THREE.Mesh(geometry, material);
        mesh.receiveShadow = true;
        const chunk = { mesh, column, row };
        this._fill(chunk);
        this.chunks.push(chunk);
        this.group.add(mesh);
      }
    }
  }

  /** Two triangles per cell, split the way Heightfield.heightAt reads them, and wound to face up. */
  _buildIndex() {
    const cells = this.chunkCells;
    const side = cells + 1;
    const indices = new Uint16Array(cells * cells * 6);
    let next = 0;
    for (let row = 0; row < cells; row++) {
      for (let column = 0; column < cells; column++) {
        const corner = row * side + column;
        indices[next++] = corner;
        indices[next++] = corner + side;
        indices[next++] = corner + 1;
        indices[next++] = corner + 1;
        indices[next++] = corner + side;
        indices[next++] = corner + side + 1;
      }
    }
    return new THREE.BufferAttribute(indices, 1);
  }

  _buildUvs(textureTile) {
    const side = this.chunkCells + 1;
    const perCell = this.heightfield.cell / textureTile;
    const uvs = new Float32Array(side * side * 2);
    for (let row = 0; row < side; row++) {
      for (let column = 0; column < side; column++) {
        const vertex = (row * side + column) * 2;
        uvs[vertex] = column * perCell;
        uvs[vertex + 1] = row * perCell;
      }
    }
    return new THREE.BufferAttribute(uvs, 2);
  }

  /** Write one chunk's vertex positions, normals and colours from the heightfield. */
  _fill(chunk) {
    const field = this.heightfield;
    const side = this.chunkCells + 1;
    const { position, normal, color } = chunk.mesh.geometry.attributes;
    const steepSpan = this.steepStart - this.steepFull;
    const flat = this.flatColor;
    const steep = this.steepColor;
    for (let localRow = 0; localRow < side; localRow++) {
      const row = chunk.row + localRow;
      const z = field.pointZ(row);
      for (let localColumn = 0; localColumn < side; localColumn++) {
        const column = chunk.column + localColumn;
        const x = field.pointX(column);
        const vertex = localRow * side + localColumn;
        position.setXYZ(vertex, x, field.heightOf(column, row), z);
        const facing = field.normalAt(x, z, this._normal);
        normal.setXYZ(vertex, facing.x, facing.y, facing.z);
        const steepness = clamp((this.steepStart - facing.y) / steepSpan, 0, 1);
        color.setXYZ(
          vertex,
          flat.r + (steep.r - flat.r) * steepness, flat.g + (steep.g - flat.g) * steepness, flat.b + (steep.b - flat.b) * steepness,
        );
      }
    }
    position.needsUpdate = true;
    normal.needsUpdate = true;
    color.needsUpdate = true;
    chunk.mesh.geometry.computeBoundingSphere(); // frustum culling reads it
  }

  /**
   * Redraw the chunks that the rectangle touches, after the heightfield changed inside it.
   * Returns how many chunks were redrawn.
   */
  redraw(minX, maxX, minZ, maxZ) {
    const field = this.heightfield;
    const span = this.chunkCells * field.cell;
    const reach = field.cell; // a normal reads the heights one cell each way, so the neighbours of a change move too
    let redrawn = 0;
    for (const chunk of this.chunks) {
      const chunkMinX = field.pointX(chunk.column);
      const chunkMinZ = field.pointZ(chunk.row);
      if (maxX + reach < chunkMinX || minX - reach > chunkMinX + span) continue;
      if (maxZ + reach < chunkMinZ || minZ - reach > chunkMinZ + span) continue;
      this._fill(chunk);
      redrawn += 1;
    }
    return redrawn;
  }

  /** Free the GPU buffers. The material belongs to the caller. */
  dispose() {
    for (const chunk of this.chunks) chunk.mesh.geometry.dispose();
    this.group.removeFromParent();
  }
}
