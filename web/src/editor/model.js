// @ts-check
// The picture being drawn, and every way to change it. Each change goes
// into the undo tree (history.js) as plain data, so all of it can be taken
// back: strokes, fills, frames, the palette, the size, even the title.
//
// A picture is square, `size` cells a side, with 1–64 frames of one byte a
// cell: an index into `colors`, or T for an empty (transparent) cell. It
// becomes a card only when signed (`toCard`): the palette is then cut down
// to the colours used, or kept as a built-in one, which costs nothing.
//
// No DOM here: runs under node for tests.

import { createHistory } from './history.js';
import { nearest } from './color.js';

/** An empty cell. */
export const T = 255;
export const SIZES = /** @type {const} */ ([16, 24, 32, 48, 64]);
export const MAX_FRAMES = 64;
export const MAX_COLORS = 32;
export const DELAY = { min: 20, max: 5000, start: 160 };

/**
 * @typedef {{
 *   size: number, frames: Uint8Array[], colors: number[], builtin: number|null,
 *   title: string, shade: number, delay: number,
 * }} Doc
 * colors: 0xRRGGBB, at most 32; builtin: the built-in palette `colors` still
 * is, unchanged, or null.
 */

/**
 * A change, as data. px: cells of one frame (indices, before, after);
 * frames: every frame before and after; set: one field; group: several.
 * @typedef {{k: 'px', f: number, i: number[], b: number[], a: number[]}
 *   | {k: 'frames', b: number[][], a: number[][]}
 *   | {k: 'set', key: 'size'|'colors'|'builtin'|'title'|'shade'|'delay', b: any, a: any}
 *   | {k: 'group', items: Entry[]}} Entry
 */

/** @param {number} size @param {{colors: number[], id: number|null}} palette @returns {Doc} */
export function blank(size, palette) {
  return {
    size, frames: [new Uint8Array(size * size).fill(T)], colors: [...palette.colors], builtin: palette.id,
    title: '', shade: 0, delay: DELAY.start,
  };
}

/** @param {Doc} d */
const snapshot = (d) => d.frames.map((f) => Array.from(f));

/** @param {Doc} doc @param {Entry} e @param {1|-1} dir */
function applyEntry(doc, e, dir) {
  if (e.k === 'px') {
    const buf = doc.frames[e.f], v = dir > 0 ? e.a : e.b;
    for (let k = 0; k < e.i.length; k++) buf[e.i[k]] = v[k];
  } else if (e.k === 'frames') {
    doc.frames = (dir > 0 ? e.a : e.b).map((f) => Uint8Array.from(f));
  } else if (e.k === 'set') {
    const v = dir > 0 ? e.a : e.b;
    /** @type {any} */ (doc)[e.key] = Array.isArray(v) ? [...v] : v;
  } else {
    const items = dir > 0 ? e.items : [...e.items].reverse();
    for (const it of items) applyEntry(doc, it, dir);
  }
}

/** @param {Entry} e @returns {number} */
function sizeOf(e) {
  if (e.k === 'px') return 24 + e.i.length * 6;
  if (e.k === 'frames') return 32 + [...e.a, ...e.b].reduce((s, f) => s + f.length, 0);
  if (e.k === 'set') return 64 + (Array.isArray(e.a) ? e.a.length * 8 : String(e.a).length);
  return e.items.reduce((s, it) => s + sizeOf(it), 16);
}

/** Two steps of one field in a row as one. @param {Entry} a @param {Entry} b @returns {Entry} */
function join(a, b) {
  if (a.k === 'set' && b.k === 'set' && a.key === b.key) return { ...a, a: b.a };
  if (a.k === 'group' && b.k === 'group' && a.items.length === b.items.length && a.items.every((x, i) => x.k === 'set' && b.items[i].k === 'set')) {
    return { k: 'group', items: a.items.map((x, i) => join(x, b.items[i])) };
  }
  return { k: 'group', items: [a, b] };
}

/**
 * @param {Doc} doc changed in place; listeners hear of every change
 * @param {{limit?: number, now?: () => number}} [opts]
 */
export function createModel(doc, opts = {}) {
  /** @type {Set<(c: {frame: number, cells?: number[], whole?: boolean}) => void>} */
  const listeners = new Set();
  const history = createHistory({ apply: (e, dir) => applyEntry(doc, e, dir), sizeOf, join, ...opts });

  /** @param {{frame: number, cells?: number[], whole?: boolean}} c */
  const changed = (c) => { for (const f of listeners) f(c); };

  /** Records a change made already, and says so. @param {Entry} e @param {{label: string, frame?: number, merge?: string}} meta */
  function record(e, meta) {
    history.push(e, meta);
    changed({ frame: meta.frame ?? -1, whole: e.k !== 'px', cells: e.k === 'px' ? e.i : undefined });
  }
  /** Makes a change and records it. @param {Entry} e @param {{label: string, frame?: number, merge?: string}} meta */
  function make(e, meta) {
    applyEntry(doc, e, 1);
    record(e, meta);
  }
  /** @param {'size'|'colors'|'builtin'|'title'|'shade'|'delay'} key @param {any} value @returns {Entry} */
  const set = (key, value) => ({ k: 'set', key, b: /** @type {any} */ (doc)[key], a: value });

  /** Undo, redo and going to a step: the step tells which frame it was on. @param {any} n */
  const moved = (n) => {
    if (n) changed({ frame: n.frame, whole: n.entry?.k !== 'px', cells: n.entry?.k === 'px' ? n.entry.i : undefined });
    return n;
  };

  const api = {
    doc, history,
    /** @param {(c: {frame: number, cells?: number[], whole?: boolean}) => void} fn */
    listen(fn) { listeners.add(fn); return () => listeners.delete(fn); },

    /**
     * A change of cells in one frame, seen as it is made and recorded as
     * one step at the end: a stroke, a shape being dragged, a fill.
     * @param {number} f the frame
     */
    stroke(f) {
      const buf = doc.frames[f];
      /** @type {Map<number, number>} cell → value before */
      const before = new Map();
      const s = {
        /** @param {number} i @param {number} v */
        set(i, v) {
          if (!before.has(i)) before.set(i, buf[i]);
          buf[i] = v;
        },
        /** Back to how the cell was before this stroke. @param {number} i */
        restore(i) {
          const b = before.get(i);
          if (b != null) buf[i] = b;
        },
        /** Every cell back, to draw a shape anew. */
        reset() { for (const [i, b] of before) buf[i] = b; },
        /** Shows the stroke so far. */
        show() { changed({ frame: f, cells: [...before.keys()] }); },
        /** Records it as one step (nothing, if nothing changed). @param {string} label */
        commit(label) {
          const i = [...before.keys()].filter((k) => buf[k] !== before.get(k));
          if (!i.length) return s.cancel();
          record({ k: 'px', f, i, b: i.map((k) => /** @type {number} */ (before.get(k))), a: i.map((k) => buf[k]) }, { label, frame: f });
        },
        /** Takes it back, unrecorded: a second finger came, or a long press picked a colour. */
        cancel() {
          s.reset();
          changed({ frame: f, cells: [...before.keys()] });
          before.clear();
        },
      };
      return s;
    },

    // ------------------------------------------------------------ frames --
    /** A copy of frame `f`, right after it. @param {number} f */
    addFrame(f) {
      if (doc.frames.length >= MAX_FRAMES) return false;
      const a = snapshot(doc);
      a.splice(f + 1, 0, Array.from(doc.frames[f]));
      make({ k: 'frames', b: snapshot(doc), a }, { label: 'ed.h.frame-add', frame: f + 1 });
      return true;
    },
    /** @param {number} f */
    removeFrame(f) {
      if (doc.frames.length < 2) return false;
      const a = snapshot(doc);
      a.splice(f, 1);
      make({ k: 'frames', b: snapshot(doc), a }, { label: 'ed.h.frame-remove', frame: Math.min(f, a.length - 1) });
      return true;
    },
    /** @param {number} from @param {number} to */
    moveFrame(from, to) {
      if (to < 0 || to >= doc.frames.length || to === from) return false;
      const a = snapshot(doc);
      a.splice(to, 0, ...a.splice(from, 1));
      make({ k: 'frames', b: snapshot(doc), a }, { label: 'ed.h.frame-move', frame: to });
      return true;
    },
    /** Empties every cell of a frame. @param {number} f */
    clearFrame(f) {
      const s = api.stroke(f);
      for (let i = 0; i < doc.size * doc.size; i++) s.set(i, T);
      s.commit('ed.h.clear');
    },

    // ----------------------------------------------------------- canvas --
    /** A new size, keeping the middle of the picture. @param {number} size */
    resize(size) {
      if (size === doc.size) return;
      const off = Math.floor((size - doc.size) / 2);
      const a = doc.frames.map((f) => {
        const out = new Array(size * size).fill(T);
        for (let y = 0; y < size; y++) {
          for (let x = 0; x < size; x++) {
            const sx = x - off, sy = y - off;
            if (sx >= 0 && sy >= 0 && sx < doc.size && sy < doc.size) out[y * size + x] = f[sy * doc.size + sx];
          }
        }
        return out;
      });
      make({ k: 'group', items: [set('size', size), { k: 'frames', b: snapshot(doc), a }] }, { label: 'ed.h.size' });
    },
    /** Whether a new size would cut something off. @param {number} size */
    cropsAt(size) {
      if (size >= doc.size) return false;
      const off = Math.floor((doc.size - size) / 2);
      return doc.frames.some((f) => f.some((v, i) => {
        const x = i % doc.size, y = (i - x) / doc.size;
        return v !== T && (x < off || y < off || x >= off + size || y >= off + size);
      }));
    },

    // ----------------------------------------------------------- colours --
    /**
     * Another palette: every cell takes its nearest colour there.
     * @param {number[]} colors @param {number|null} id built-in id, or null
     */
    setPalette(colors, id) {
      const map = doc.colors.map((c) => nearest(c, colors));
      const a = doc.frames.map((f) => Array.from(f, (v) => (v === T ? T : map[v] ?? 0)));
      make({ k: 'group', items: [set('colors', [...colors]), set('builtin', id), { k: 'frames', b: snapshot(doc), a }] }, { label: 'ed.h.palette' });
    },
    /**
     * Changes colour `i`: every cell of it changes with it. Dragging a
     * colour picker makes many calls; they become one step.
     * @param {number} i @param {number} c
     */
    setColor(i, c) {
      if (doc.colors[i] === c) return;
      const colors = [...doc.colors];
      colors[i] = c;
      make({ k: 'group', items: [set('colors', colors), set('builtin', null)] }, { label: 'ed.h.color', merge: `color:${i}` });
    },
    /** Adds a colour at the end; returns its index, or -1 when full. @param {number} c */
    addColor(c) {
      if (doc.colors.length >= MAX_COLORS) return -1;
      make({ k: 'group', items: [set('colors', [...doc.colors, c]), set('builtin', null)] }, { label: 'ed.h.color-add' });
      return doc.colors.length - 1;
    },
    /** Adds several colours as one step, as many as fit. @param {number[]} cs */
    addColors(cs) {
      const room = MAX_COLORS - doc.colors.length;
      if (room <= 0) return 0;
      const add = cs.filter((c) => !doc.colors.includes(c)).slice(0, room);
      if (add.length) make({ k: 'group', items: [set('colors', [...doc.colors, ...add]), set('builtin', null)] }, { label: 'ed.h.color-add' });
      return add.length;
    },
    /** Whether any cell of any frame uses colour `i`. @param {number} i */
    uses(i) { return doc.frames.some((f) => f.includes(i)); },

    // -------------------------------------------------------------- card --
    /** Typing the title: one step per pause. @param {string} v */
    setTitle(v) { if (v !== doc.title) make(set('title', v), { label: 'ed.h.title', merge: 'title' }); },
    /** @param {number} v */
    setShade(v) { if (v !== doc.shade) make(set('shade', v), { label: 'ed.h.shade', merge: 'shade' }); },
    /** @param {number} v */
    setDelay(v) {
      v = Math.max(DELAY.min, Math.min(DELAY.max, Math.round(v)));
      if (v !== doc.delay) make(set('delay', v), { label: 'ed.h.delay', merge: 'delay' });
    },
    /** Starts over, as a step of its own: undo brings the picture back.
     * @param {Doc} fresh */
    replace(fresh) {
      const keys = /** @type {const} */ (['size', 'colors', 'builtin', 'title', 'shade', 'delay']);
      make({ k: 'group', items: [...keys.map((key) => set(key, /** @type {any} */ (fresh)[key])), { k: 'frames', b: snapshot(doc), a: fresh.frames.map((f) => Array.from(f)) }] }, { label: 'ed.h.new', frame: 0 });
    },

    /**
     * Another picture in the same model — a draft taken up again, or a
     * fresh canvas after signing — with its history, or none.
     * @param {Doc} fresh @param {any} [saved] a history from `history.save()`
     */
    reset(fresh, saved) {
      Object.assign(doc, fresh);
      if (saved) history.load(saved);
      else history.clear();
      changed({ frame: -1, whole: true });
    },

    // -------------------------------------------------------------- undo --
    undo: () => moved(history.undo()),
    redo: () => moved(history.redo()),
    /** @param {any} n a step of history.line() */
    goTo(n) {
      history.goTo(n);
      changed({ frame: n.frame, whole: true });
    },
  };
  return api;
}
