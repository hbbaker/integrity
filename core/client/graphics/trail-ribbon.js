import * as THREE from 'three';

/*
 * TRAIL RIBBON: a flat strip laid along a path, one piece at a time: a track in snow, a skid mark. Each piece
 * joins the last pair of edge points to a new pair. The ribbon holds a fixed number of pieces: when it is
 * full, a new piece takes the place of the oldest. All buffers are made once.
 */

const CORNERS = 4; // corners of one piece: the last left and right points, then the new ones
const COORDINATES = 3;
const PIECE_SIZE = CORNERS * COORDINATES;
const PIECE_INDICES = [0, 1, 2, 2, 1, 3]; // two triangles, wound to face up when the path runs away from the viewer
const MAX_PIECES = Math.floor(65536 / CORNERS); // a 16-bit index reaches no further

export class TrailRibbon {
  /** @param options { pieces (how many the ribbon holds), material } */
  constructor({ pieces, material }) {
    if (!Number.isInteger(pieces) || pieces < 1 || pieces > MAX_PIECES) {
      throw new Error(`a trail ribbon holds 1 to ${MAX_PIECES} pieces, got ${pieces}`);
    }
    this.pieces = pieces;
    this.next = 0; // the piece that the next add() writes
    this.count = 0; // pieces written so far, up to `pieces`
    this.joined = false; // the last pair of points is there to join on to
    this._left = new THREE.Vector3();
    this._right = new THREE.Vector3();

    const indices = new Uint16Array(pieces * PIECE_INDICES.length);
    for (let piece = 0; piece < pieces; piece++) {
      PIECE_INDICES.forEach((corner, i) => { indices[piece * PIECE_INDICES.length + i] = piece * CORNERS + corner; });
    }
    this.positions = new THREE.BufferAttribute(new Float32Array(pieces * PIECE_SIZE), COORDINATES);
    this.positions.setUsage(THREE.DynamicDrawUsage);
    const geometry = new THREE.BufferGeometry();
    geometry.setIndex(new THREE.BufferAttribute(indices, 1));
    geometry.setAttribute('position', this.positions);
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.frustumCulled = false; // the ribbon grows all the time, and a piece that is not written has no area
  }

  /** Lay the ribbon on to a new pair of edge points (each { x, y, z }, world). The first pair after a break only starts a line. */
  add(left, right) {
    if (this.joined) {
      const start = this.next * PIECE_SIZE;
      const array = this.positions.array;
      this._left.toArray(array, start);
      this._right.toArray(array, start + COORDINATES);
      array[start + 6] = left.x;
      array[start + 7] = left.y;
      array[start + 8] = left.z;
      array[start + 9] = right.x;
      array[start + 10] = right.y;
      array[start + 11] = right.z;
      this.positions.addUpdateRange(start, PIECE_SIZE);
      this.positions.needsUpdate = true;
      this.next = (this.next + 1) % this.pieces;
      this.count = Math.min(this.count + 1, this.pieces);
    }
    this._left.copy(left);
    this._right.copy(right);
    this.joined = true;
  }

  /** End the line here: the next add() starts a new one (the thing that leaves the trail left the ground). */
  breakLine() {
    this.joined = false;
  }

  /**
   * The ground moved inside a rectangle: put every corner in it at `height(x, z) + lift` again.
   * Returns how many corners moved.
   */
  settle(minX, maxX, minZ, maxZ, height, lift) {
    const array = this.positions.array;
    let moved = 0;
    for (let corner = 0; corner < this.count * CORNERS; corner++) {
      const at = corner * COORDINATES;
      const x = array[at];
      const z = array[at + 2];
      if (x < minX || x > maxX || z < minZ || z > maxZ) continue;
      const y = height(x, z) + lift;
      if (y === array[at + 1]) continue;
      array[at + 1] = y;
      moved += 1;
    }
    if (moved > 0) {
      this.positions.addUpdateRange(0, this.count * PIECE_SIZE);
      this.positions.needsUpdate = true;
    }
    return moved;
  }

  /** Take the whole ribbon away. */
  clear() {
    this.positions.array.fill(0);
    this.positions.clearUpdateRanges(); // the whole buffer goes up again
    this.positions.needsUpdate = true;
    this.next = 0;
    this.count = 0;
    this.joined = false;
  }

  /** Free the GPU buffers. The material belongs to the caller. */
  dispose() {
    this.mesh.geometry.dispose();
    this.mesh.removeFromParent();
  }
}
