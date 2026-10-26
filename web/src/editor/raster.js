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

// ------------------------------------------------------------ selections --

/** A box of cells, both corners included. @typedef {{x0: number, y0: number, x1: number, y1: number}} Rect */
/** Cells lifted out of a frame: w×h values, row by row. @typedef {{w: number, h: number, cells: Uint8Array}} Piece */

/** The box spanned by two cells, kept on the canvas. @param {Cell} a @param {Cell} b @param {number} size @returns {Rect} */
export function span(a, b, size) {
  const c = (/** @type {number} */ v) => Math.max(0, Math.min(size - 1, v));
  return { x0: c(Math.min(a.x, b.x)), y0: c(Math.min(a.y, b.y)), x1: c(Math.max(a.x, b.x)), y1: c(Math.max(a.y, b.y)) };
}

/** @param {Rect} r @param {Cell} c */
export const within = (r, c) => c.x >= r.x0 && c.x <= r.x1 && c.y >= r.y0 && c.y <= r.y1;

/** The cells of a box. @param {Uint8Array} buf @param {number} size @param {Rect} r @returns {Piece} */
export function lift(buf, size, r) {
  const w = r.x1 - r.x0 + 1, h = r.y1 - r.y0 + 1, cells = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) cells[y * w + x] = buf[(r.y0 + y) * size + r.x0 + x];
  return { w, h, cells };
}

/** Mirrored left to right ('x') or top to bottom ('y'). @param {Piece} p @param {'x'|'y'} axis @returns {Piece} */
export function flip(p, axis) {
  const cells = new Uint8Array(p.cells.length);
  for (let y = 0; y < p.h; y++) {
    for (let x = 0; x < p.w; x++) {
      cells[y * p.w + x] = axis === 'x' ? p.cells[y * p.w + (p.w - 1 - x)] : p.cells[(p.h - 1 - y) * p.w + x];
    }
  }
  return { w: p.w, h: p.h, cells };
}

/** A quarter turn clockwise. @param {Piece} p @returns {Piece} */
export function turn(p) {
  const w = p.h, h = p.w, cells = new Uint8Array(p.cells.length);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) cells[y * w + x] = p.cells[(p.h - 1 - x) * p.w + y];
  return { w, h, cells };
}

/**
 * Where a piece puts its cells with its corner at (x, y): its empty cells
 * leave what is beneath, and what falls off the canvas is lost.
 * @param {Piece} p @param {number} x @param {number} y @param {number} size @param {number} empty
 * @returns {{i: number, v: number}[]}
 */
export function place(p, x, y, size, empty) {
  const out = [];
  for (let py = 0; py < p.h; py++) {
    for (let px = 0; px < p.w; px++) {
      const v = p.cells[py * p.w + px], cx = x + px, cy = y + py;
      if (v !== empty && cx >= 0 && cy >= 0 && cx < size && cy < size) out.push({ i: cy * size + cx, v });
    }
  }
  return out;
}

/** The checks of a dithering brush: every other cell, like a chessboard. @param {Cell} c */
export const dithered = (c) => (c.x + c.y) % 2 === 0;
