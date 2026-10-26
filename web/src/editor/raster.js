// @ts-check
// Where the tools put pixels: lines, rectangles, ellipses, flood fill,
// mirroring, and the "pixel-perfect" rule for hand-drawn lines. Cells are
// {x, y}; a canvas is `size` cells square. Plain arithmetic: runs under
// node for tests.

/** @typedef {{x: number, y: number}} Cell */

/** Every cell of a line, end points included (Bresenham). @param {Cell} a @param {Cell} b @returns {Cell[]} */
export function line(a, b) {
  const out = [];
  let { x, y } = a;
  const dx = Math.abs(b.x - x), dy = -Math.abs(b.y - y), sx = x < b.x ? 1 : -1, sy = y < b.y ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    out.push({ x, y });
    if (x === b.x && y === b.y) return out;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x += sx; }
    if (e2 <= dx) { err += dx; y += sy; }
  }
}

/** The corners as a box. @param {Cell} a @param {Cell} b */
const box = (a, b) => ({ x0: Math.min(a.x, b.x), y0: Math.min(a.y, b.y), x1: Math.max(a.x, b.x), y1: Math.max(a.y, b.y) });

/** @param {Cell} a @param {Cell} b @param {boolean} filled @returns {Cell[]} */
export function rect(a, b, filled) {
  const { x0, y0, x1, y1 } = box(a, b), out = [];
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (filled || y === y0 || y === y1 || x === x0 || x === x1) out.push({ x, y });
    }
  }
  return out;
}

/**
 * The ellipse inscribed in the box of `a` and `b`. Filled: the cells whose
 * centres lie inside; outline: those of them with a side neighbour
 * outside. Symmetric by construction, also for even sizes.
 * @param {Cell} a @param {Cell} b @param {boolean} filled @returns {Cell[]}
 */
export function ellipse(a, b, filled) {
  const { x0, y0, x1, y1 } = box(a, b);
  const cx = (x0 + x1 + 1) / 2, cy = (y0 + y1 + 1) / 2, rx = (x1 - x0 + 1) / 2, ry = (y1 - y0 + 1) / 2;
  const inside = (/** @type {number} */ x, /** @type {number} */ y) => {
    if (x < x0 || x > x1 || y < y0 || y > y1) return false;
    const u = (x + 0.5 - cx) / rx, v = (y + 0.5 - cy) / ry;
    return u * u + v * v <= 1.0001;
  };
  // Thin boxes: the formula above would leave gaps; a line is the ellipse.
  if (x1 - x0 < 2 || y1 - y0 < 2) return rect(a, b, true);
  const out = [];
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (!inside(x, y)) continue;
      if (filled || !inside(x - 1, y) || !inside(x + 1, y) || !inside(x, y - 1) || !inside(x, y + 1)) out.push({ x, y });
    }
  }
  return out;
}

/**
 * The cells a flood fill from `start` changes: the 4-connected area of the
 * same value. @param {Uint8Array} buf @param {number} size @param {Cell} start @returns {number[]} indices
 */
export function fill(buf, size, start) {
  const from = buf[start.y * size + start.x], seen = new Uint8Array(size * size), out = [];
  const stack = [start.y * size + start.x];
  seen[stack[0]] = 1;
  while (stack.length) {
    const i = /** @type {number} */ (stack.pop());
    out.push(i);
    const x = i % size, y = (i - x) / size;
    for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
      if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
      const j = ny * size + nx;
      if (!seen[j] && buf[j] === from) { seen[j] = 1; stack.push(j); }
    }
  }
  return out;
}

/**
 * A cell and its mirror images across the canvas' middle lines.
 * @param {Cell} c @param {number} size @param {{x: boolean, y: boolean}} axes
 * x: mirrored left to right; y: top to bottom. @returns {Cell[]}
 */
export function mirror(c, size, axes) {
  const out = [c];
  if (axes.x) out.push({ x: size - 1 - c.x, y: c.y });
  if (axes.y) out.push({ x: c.x, y: size - 1 - c.y });
  if (axes.x && axes.y) out.push({ x: size - 1 - c.x, y: size - 1 - c.y });
  return out;
}

/**
 * Pixel-perfect: in a hand-drawn line, a cell that only turns a corner
 * between two diagonal neighbours is one pixel too many ("L" corners). Given
 * the last three cells drawn, says whether the middle one should go.
 * @param {Cell} a @param {Cell} b @param {Cell} c
 */
export function corner(a, b, c) {
  const diag = Math.abs(a.x - c.x) === 1 && Math.abs(a.y - c.y) === 1;
  const touches = (/** @type {Cell} */ p) => Math.abs(p.x - b.x) + Math.abs(p.y - b.y) === 1;
  return diag && touches(a) && touches(c);
}

/** Within the canvas. @param {Cell} c @param {number} size */
export const inside = (c, size) => c.x >= 0 && c.y >= 0 && c.x < size && c.y < size;
