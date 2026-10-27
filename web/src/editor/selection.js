// @ts-check
// The selection: a box on the open frame, and what can be done with what
// is inside — move it (or a copy of it), mirror it, turn it, empty it. A
// drag outside the box draws a new one; a drag inside moves its cells; a
// tap outside lets go. Every change is a stroke of the model, one step of
// the undo history; the box itself is not part of the picture, so it is
// let go when the picture changes under it (an undo, another frame).
//
// Empty cells of what is moved do not cover what they pass over.

import { h, icon } from '../dom.js';
import { t } from '../i18n.js';
import { T } from './model.js';
import { span, within, lift, flip, turn, place } from './raster.js';

/** @typedef {import('./raster.js').Rect} Rect */
/** @typedef {import('./raster.js').Cell} Cell */

/**
 * @param {{
 *   model: ReturnType<typeof import('./model.js').createModel>,
 *   frame: () => number,
 *   changed: () => void,
 * }} o changed: the box or its bar changed (to be drawn again)
 */
export function createSelection(o) {
  const { model } = o;
  /** @type {Rect|null} */
  let box = null;
  let copy = false;

  /** @param {any} ic @param {string} label @param {() => void} run */
  const btn = (ic, label, run) => h('button', { type: 'button', class: 'ed-sel-btn', 'aria-label': label, title: label, onclick: run }, icon(ic));
  const copyBtn = btn('copy', t('ed.sel.copy'), () => { copy = !copy; paint(); });
  const bar = h('div', { class: 'ed-sel-bar', role: 'toolbar', 'aria-label': t('ed.sel'), hidden: true },
    copyBtn,
    btn('flip-x', t('ed.sel.flip-x'), () => transform((p) => flip(p, 'x'), 'ed.h.flip')),
    btn('flip-y', t('ed.sel.flip-y'), () => transform((p) => flip(p, 'y'), 'ed.h.flip')),
    btn('rotate', t('ed.sel.turn'), () => transform(turn, 'ed.h.turn')),
    btn('eraser', t('ed.sel.erase'), () => erase()),
    btn('select-all', t('ed.sel.all'), () => api.all()),
    btn('close', t('ed.sel.drop'), () => api.clear()));

  function paint() {
    bar.hidden = !box;
    copyBtn.setAttribute('aria-pressed', String(copy));
    o.changed();
  }

  /**
   * Into a stroke: every cell of the box emptied (unless it is kept, for a
   * copy), then `writes`. @param {ReturnType<typeof model.stroke>} st
   * @param {Rect} r @param {{i: number, v: number}[]} writes @param {boolean} keep
   */
  function rewrite(st, r, writes, keep) {
    const size = model.doc.size;
    if (!keep) for (let y = r.y0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++) st.set(y * size + x, T);
    for (const w of writes) st.set(w.i, w.v);
    return st;
  }
  const fresh = () => model.stroke(o.frame());

  /** Mirrors or turns what is in the box, about its middle. @param {(p: import('./raster.js').Piece) => import('./raster.js').Piece} fn @param {string} label */
  function transform(fn, label) {
    if (!box) return;
    const size = model.doc.size, p = lift(model.doc.frames[o.frame()], size, box), q = fn(p);
    const x = box.x0 + Math.floor((p.w - q.w) / 2), y = box.y0 + Math.floor((p.h - q.h) / 2);
    const r = box;
    box = null; // the stroke's change would let it go
    rewrite(fresh(), r, place(q, x, y, size, T), false).commit(label);
    box = span({ x, y }, { x: x + q.w - 1, y: y + q.h - 1 }, size);
    paint();
  }
  function erase() {
    if (!box) return;
    const r = box;
    box = null;
    rewrite(fresh(), r, [], false).commit('ed.h.erase-sel');
    box = r;
    paint();
  }
  /** Moves the cells by (dx, dy), as one step. @param {number} dx @param {number} dy */
  function nudge(dx, dy) {
    if (!box) return;
    const size = model.doc.size, p = lift(model.doc.frames[o.frame()], size, box), r = box;
    box = null;
    rewrite(fresh(), r, place(p, r.x0 + dx, r.y0 + dy, size, T), copy).commit(copy ? 'ed.h.copy' : 'ed.h.move');
    box = span({ x: r.x0 + dx, y: r.y0 + dy }, { x: r.x1 + dx, y: r.y1 + dy }, size);
    paint();
  }

  const api = {
    bar,
    get box() { return box; },
    get copy() { return copy; },
    /** Lets go of the box. */
    clear() { if (box) { box = null; paint(); } },
    /** The whole canvas. */
    all() { box = { x0: 0, y0: 0, x1: model.doc.size - 1, y1: model.doc.size - 1 }; paint(); },
    nudge, erase,
    /** Mirrors left to right. */
    flipX: () => transform((p) => flip(p, 'x'), 'ed.h.flip'),
    /**
     * A press of the selection tool: inside the box, its cells follow the
     * finger; elsewhere, a new box is drawn (a tap lets go).
     * @param {Cell} c
     */
    start(c) {
      const size = model.doc.size;
      if (box && within(box, c)) {
        const r = box, p = lift(model.doc.frames[o.frame()], size, r), dup = copy;
        const st = fresh();
        let dx = 0, dy = 0;
        box = null;
        const move = (/** @type {Cell} */ b) => {
          dx = b.x - c.x;
          dy = b.y - c.y;
          st.reset();
          rewrite(st, r, place(p, r.x0 + dx, r.y0 + dy, size, T), dup);
          st.show();
          box = { x0: r.x0 + dx, y0: r.y0 + dy, x1: r.x1 + dx, y1: r.y1 + dy }; // may hang over the edge while dragged
          o.changed();
        };
        return {
          move,
          end: () => {
            box = null;
            st.commit(dup ? 'ed.h.copy' : 'ed.h.move');
            box = span({ x: r.x0 + dx, y: r.y0 + dy }, { x: r.x1 + dx, y: r.y1 + dy }, size);
            paint();
          },
          cancel: () => { st.cancel(); box = r; paint(); },
        };
      }
      const before = box;
      let moved = false;
      box = span(c, c, size);
      paint();
      return {
        move: (/** @type {Cell} */ b) => { moved = moved || b.x !== c.x || b.y !== c.y; box = span(c, b, size); paint(); },
        end: () => { if (!moved) { box = null; paint(); } },
        cancel: () => { box = before; paint(); },
      };
    },
  };

  // The picture changed under the box (an undo, a redo, another frame,
  // another size): the box goes. Its own strokes clear it before they
  // commit, so they do not count.
  model.listen((c) => { if (!c.live && box) { box = null; paint(); } });
  return api;
}
