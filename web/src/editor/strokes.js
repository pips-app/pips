// @ts-check
// What each tool does with a finger (or the precise mode's button), from
// the cell it lands on to the cell it leaves: pixels for the pen (with the
// corners a hand leaves taken out, or every other cell when dithering),
// empty cells for the eraser, a flood for the fill, a shape dragged from
// corner to corner, the selection's box or its move. Every change goes
// through the model as one stroke, so it is one step of the undo history.

import { T } from './model.js';
import { line, rect, ellipse, fill, mirror, corner, inside, dithered } from './raster.js';

/** @typedef {import('./raster.js').Cell} Cell */
/** @typedef {{move: (c: Cell) => void, end: () => void, cancel: () => void}} Handle */

/**
 * @param {{
 *   model: ReturnType<typeof import('./model.js').createModel>,
 *   now: () => {frame: number, color: number, shape: import('./tools.js').Shape, pen: import('./tools.js').PenMode,
 *     mirror: boolean, axes: {x: boolean, y: boolean}},
 *   pick: (c: Cell) => void,
 *   selection: ReturnType<typeof import('./selection.js').createSelection>,
 * }} o now: what the tools are set to at the moment of a press
 */
export function createStrokes(o) {
  const { model } = o;

  /** @param {Cell} c */
  const index = (c) => c.y * model.doc.size + c.x;
  /** A cell and its mirror images, inside the canvas. @param {Cell} c @param {ReturnType<typeof o.now>} s */
  const spots = (c, s) => (s.mirror ? mirror(c, model.doc.size, s.axes) : [c]).filter((x) => inside(x, model.doc.size));

  /**
   * @param {Cell} c where it lands @param {import('./tools.js').Tool} tool
   * @returns {Handle|null} what follows the finger, or null for a tool that acts at once
   */
  function start(c, tool) {
    const s = o.now(), f = s.frame, size = model.doc.size;
    if (tool === 'pick') { o.pick(c); return null; }
    if (tool === 'select') return o.selection.start(c);
    if (tool === 'fill') {
      if (!inside(c, size)) return null;
      const st = model.stroke(f);
      for (const p of spots(c, s)) for (const i of fill(model.doc.frames[f], size, p)) st.set(i, s.color);
      st.commit('ed.h.fill');
      return null;
    }
    if (tool === 'shapes') {
      const st = model.stroke(f);
      const draw = (/** @type {Cell} */ b) => {
        st.reset();
        const cells = s.shape === 'line' ? line(c, b)
          : s.shape.startsWith('rect') ? rect(c, b, s.shape === 'rect-fill')
            : ellipse(c, b, s.shape === 'ellipse-fill');
        for (const p of cells) for (const q of spots(p, s)) st.set(index(q), s.color);
        st.show();
      };
      draw(c);
      return { move: draw, end: () => st.commit(`ed.h.${s.shape.replace('-fill', '')}`), cancel: () => st.cancel() };
    }
    // Pen and eraser: a line through every cell the finger passes.
    const st = model.stroke(f), v = tool === 'eraser' ? T : s.color;
    const dither = tool === 'pen' && s.pen === 'dither';
    /** @type {Cell[]} */
    const path = [];
    // How many places of the path (and their mirror images) cover each
    // cell. A corner taken out is undone only where nothing else of the
    // stroke covers it — not where the line crossed or doubled back over
    // itself, which would cut a hole in what was just drawn.
    /** @type {Map<number, number>} */
    const cover = new Map();
    const put = (/** @type {Cell} */ p) => {
      const last = path[path.length - 1];
      if (last && last.x === p.x && last.y === p.y) return;
      path.push(p);
      for (const q of spots(p, s)) {
        if (dither && !dithered(q)) continue;
        const i = index(q);
        cover.set(i, (cover.get(i) ?? 0) + 1);
        st.set(i, v);
      }
      // Pixel-perfect: the cell that only turns a corner goes (the smoothing
      // pen; the square one keeps every cell, for corners drawn on purpose).
      if (tool === 'pen' && s.pen === 'solid' && path.length >= 3 && corner(path[path.length - 3], path[path.length - 2], p)) {
        const mid = /** @type {Cell} */ (path.splice(path.length - 2, 1)[0]);
        for (const q of spots(mid, s)) {
          const i = index(q), n = (cover.get(i) ?? 1) - 1;
          cover.set(i, n);
          if (n <= 0) st.restore(i);
        }
      }
    };
    put(c);
    st.show();
    return {
      move: (b) => {
        for (const p of line(path[path.length - 1] ?? b, b)) put(p);
        st.show();
      },
      end: () => st.commit(dither ? 'ed.h.dither' : `ed.h.${tool}`),
      cancel: () => st.cancel(),
    };
  }

  return { start };
}
