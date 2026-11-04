// @ts-check
// The picture being drawn, and every way to change it. Each change goes
// into the undo tree (history.js) as plain data, so all of it can be taken
// back: strokes, fills, frames, layers, the palette, the size, the title.
//
// A picture is square, `size` cells a side. It has 1–64 frames, each shown
// for 1–8 ticks of the card's one delay (`holds`), and 1–8 layers: a frame
// is a stack of cels, one per layer, bottom first, of one byte a cell — an
// index into `colors`, or T for an empty (transparent) cell, through which
// the layer below shows. Layers and holds are the editor's own: the card
// has neither. When signed (`toCard`) each frame is its visible layers
// pressed into one and repeated for its holds; the palette is then cut down
// to the colours used, or kept as a built-in one, which costs nothing.
//
// No DOM here: runs under node for tests.

import { createHistory } from './history.js';
import { nearest } from './color.js';

/** An empty cell. */
export const T = 255;
export const SIZES = /** @type {const} */ ([16, 24, 32, 48, 64]);
/** Frames of the card, holds counted: what the format carries. */
export const MAX_FRAMES = 64;
/** Ticks one frame may last: enough for a pause or a slow beat; longer
 * waits are the delay's to make (up to 5 s a tick). */
export const MAX_HOLD = 8;
export const MAX_LAYERS = 8;
export const MAX_COLORS = 32;
export const DELAY = { min: 20, max: 5000, start: 160 };

/**
 * @typedef {{n: number, hidden: boolean}} Layer n: its number, for its name ("Layer n"), kept when layers move
 * @typedef {{
 *   size: number, frames: Uint8Array[][], layers: Layer[], holds: number[],
 *   colors: number[], builtin: number|null, title: string, shade: number, delay: number,
 * }} Doc
 * frames[f][l]: frame f's cel on layer l; holds[f]: ticks frame f lasts.
 * colors: 0xRRGGBB, at most 32; builtin: the built-in palette `colors`
 * still is, unchanged, or null.
 */

/**
 * A change, as data. px: cells of one cel (indices, before, after);
 * cels: every cel of one layer, before and after; frames: every cel of
 * every frame; addFrame / addLayer: one inserted (or, undone, taken out);
 * dropFrame / dropLayer: the other way round; moveFrame / moveLayer;
 * set: one field; group: several.
 * @typedef {{k: 'px', f: number, l: number, i: number[], b: number[], a: number[]}
 *   | {k: 'cels', l: number, b: number[][], a: number[][]}
 *   | {k: 'frames', b: number[][][], a: number[][][]}
 *   | {k: 'addFrame'|'dropFrame', f: number, cels: number[][], hold: number}
 *   | {k: 'addLayer'|'dropLayer', l: number, layer: Layer, cels: number[][]}
 *   | {k: 'moveFrame'|'moveLayer', from: number, to: number}
 *   | {k: 'set', key: 'size'|'colors'|'builtin'|'title'|'shade'|'delay'|'holds'|'layers', b: any, a: any}
 *   | {k: 'group', items: Entry[]}} Entry
 */

/** @param {number} size @param {{colors: number[], id: number|null}} palette @returns {Doc} */
export function blank(size, palette) {
  return {
    size, frames: [[new Uint8Array(size * size).fill(T)]], layers: [{ n: 1, hidden: false }], holds: [1],
    colors: [...palette.colors], builtin: palette.id, title: '', shade: 0, delay: DELAY.start,
  };
}

/**
 * A frame as it shows: its visible layers, each over the ones below.
 * @param {Doc} doc @param {number} f @returns {Uint8Array}
 */
export function composite(doc, f) {
  const cels = doc.frames[f];
  if (cels.length === 1) return doc.layers[0].hidden ? new Uint8Array(cels[0].length).fill(T) : cels[0];
  const out = new Uint8Array(doc.size * doc.size).fill(T);
  cels.forEach((c, l) => {
    if (doc.layers[l].hidden) return;
    for (let i = 0; i < c.length; i++) if (c[i] !== T) out[i] = c[i];
  });
  return out;
}

/** Card frames the picture makes: each frame as many times as it lasts. @param {Doc} doc */
export const ticks = (doc) => doc.holds.reduce((s, n) => s + n, 0);

/** @param {Doc} d @returns {number[][][]} */
const snapshot = (d) => d.frames.map((f) => f.map((c) => Array.from(c)));
/** @param {number[][]} cels */
const unpack = (cels) => cels.map((c) => Uint8Array.from(c));

/** @param {Doc} doc @param {Entry} e @param {1|-1} dir */
function applyEntry(doc, e, dir) {
  const fwd = dir > 0;
  switch (e.k) {
    case 'px': {
      const buf = doc.frames[e.f][e.l], v = fwd ? e.a : e.b;
      for (let k = 0; k < e.i.length; k++) buf[e.i[k]] = v[k];
      return;
    }
    case 'cels': {
      const v = fwd ? e.a : e.b;
      doc.frames.forEach((f, k) => { f[e.l] = Uint8Array.from(v[k]); });
      return;
    }
    case 'frames':
      doc.frames = (fwd ? e.a : e.b).map(unpack);
      return;
    case 'addFrame': case 'dropFrame':
      if (fwd === (e.k === 'addFrame')) {
        doc.frames.splice(e.f, 0, unpack(e.cels));
        doc.holds.splice(e.f, 0, e.hold);
      } else {
        doc.frames.splice(e.f, 1);
        doc.holds.splice(e.f, 1);
      }
      return;
    case 'addLayer': case 'dropLayer':
      if (fwd === (e.k === 'addLayer')) {
        doc.layers.splice(e.l, 0, { ...e.layer });
        doc.frames.forEach((f, k) => f.splice(e.l, 0, Uint8Array.from(e.cels[k])));
      } else {
        doc.layers.splice(e.l, 1);
        for (const f of doc.frames) f.splice(e.l, 1);
      }
      return;
    case 'moveFrame': case 'moveLayer': {
      const [from, to] = fwd ? [e.from, e.to] : [e.to, e.from];
      /** @param {any[]} a */
      const move = (a) => a.splice(to, 0, ...a.splice(from, 1));
      if (e.k === 'moveFrame') { move(doc.frames); move(doc.holds); } else { move(doc.layers); for (const f of doc.frames) move(f); }
      return;
    }
    case 'set': {
      const v = fwd ? e.a : e.b;
      /** @type {any} */ (doc)[e.key] = Array.isArray(v) ? v.map((x) => (typeof x === 'object' ? { ...x } : x)) : v;
      return;
    }
    case 'group': {
      const items = fwd ? e.items : [...e.items].reverse();
      for (const it of items) applyEntry(doc, it, dir);
    }
  }
}

/** @param {number[][]} cels */
const weight = (cels) => cels.reduce((s, c) => s + c.length, 0);
/** @param {Entry} e @returns {number} */
function sizeOf(e) {
  switch (e.k) {
    case 'px': return 24 + e.i.length * 6;
    case 'cels': return 32 + weight(e.a) + weight(e.b);
    case 'frames': return 32 + [...e.a, ...e.b].reduce((s, f) => s + weight(f), 0);
    case 'addFrame': case 'dropFrame': case 'addLayer': case 'dropLayer': return 48 + weight(e.cels);
    case 'moveFrame': case 'moveLayer': return 32;
    case 'set': return 64 + (Array.isArray(e.a) ? e.a.length * 8 : String(e.a).length);
    case 'group': return e.items.reduce((s, it) => s + sizeOf(it), 16);
  }
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
 * A draft kept before layers and holds (version 1: `frames` of one cel
 * each, steps without a layer), as it is now. Pure: the draft as stored is
 * left alone. @param {any} d `{v, doc, history, ...}` @returns {any}
 */
export function upgradeDraft(d) {
  if (d?.v !== 1) return d;
  /** @param {any} e @returns {any} */
  const step = (e) => {
    if (!e) return e;
    if (e.k === 'px') return { ...e, l: 0 };
    if (e.k === 'frames') return { k: 'frames', b: e.b.map((/** @type {number[]} */ f) => [f]), a: e.a.map((/** @type {number[]} */ f) => [f]) };
    if (e.k === 'group') return { k: 'group', items: e.items.map(step) };
    return e;
  };
  /** @param {any} n @returns {any} */
  const node = (n) => ({ ...n, e: step(n.e), k: n.k.map(node) });
  const frames = d.doc.frames.map((/** @type {any} */ f) => [f]);
  return {
    ...d, v: 2,
    doc: { ...d.doc, frames, layers: [{ n: 1, hidden: false }], holds: frames.map(() => 1) },
    history: d.history && { ...d.history, tree: node(d.history.tree) },
  };
}

/**
 * @param {Doc} doc changed in place; listeners hear of every change
 * @param {{limit?: number, now?: () => number}} [opts]
 */
export function createModel(doc, opts = {}) {
  /** @type {Set<(c: {frame: number, cells?: number[], whole?: boolean, live?: boolean}) => void>} */
  const listeners = new Set();
  const history = createHistory({ apply: (e, dir) => applyEntry(doc, e, dir), sizeOf, join, ...opts });

  /** @param {{frame: number, cells?: number[], whole?: boolean, live?: boolean}} c */
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
  /** @param {'size'|'colors'|'builtin'|'title'|'shade'|'delay'|'holds'|'layers'} key @param {any} value @returns {Entry} */
  const set = (key, value) => ({ k: 'set', key, b: structuredClone(/** @type {any} */ (doc)[key]), a: value });
  /** Every cel, through `fn`. @param {(c: Uint8Array) => number[]} fn @returns {number[][][]} */
  const mapCels = (fn) => doc.frames.map((f) => f.map(fn));
  const empty = () => new Array(doc.size * doc.size).fill(T);

  /** Undo, redo and going to a step: the step tells which frame it was on. @param {any} n */
  const moved = (n) => {
    if (n) changed({ frame: n.frame, whole: n.entry?.k !== 'px', cells: n.entry?.k === 'px' ? n.entry.i : undefined });
    return n;
  };

  const api = {
    doc, history,
    /** @param {(c: {frame: number, cells?: number[], whole?: boolean, live?: boolean}) => void} fn */
    listen(fn) { listeners.add(fn); return () => listeners.delete(fn); },

    /** The cells of one layer in one frame. @param {number} f @param {number} l */
    cel: (f, l) => doc.frames[f][l],

    /**
     * A change of cells in one cel, seen as it is made and recorded as
     * one step at the end: a stroke, a shape being dragged, a fill.
     * @param {number} f the frame @param {number} l the layer
     */
    stroke(f, l) {
      const buf = doc.frames[f][l];
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
        /** Shows the stroke so far (live: not yet a step of the history). */
        show() { changed({ frame: f, cells: [...before.keys()], live: true }); },
        /** Records it as one step (nothing, if nothing changed). @param {string} label */
        commit(label) {
          const i = [...before.keys()].filter((k) => buf[k] !== before.get(k));
          if (!i.length) return s.cancel();
          record({ k: 'px', f, l, i, b: i.map((k) => /** @type {number} */ (before.get(k))), a: i.map((k) => buf[k]) }, { label, frame: f });
        },
        /** Takes it back, unrecorded: a second finger came, or a long press picked a colour. */
        cancel() {
          s.reset();
          changed({ frame: f, cells: [...before.keys()], live: true });
          before.clear();
        },
      };
      return s;
    },

    // ------------------------------------------------------------ frames --
    /** Card frames the picture makes, holds counted. */
    ticks: () => ticks(doc),
    /** A copy of frame `f` (every layer, and how long it lasts), right after it. @param {number} f */
    addFrame(f) {
      if (ticks(doc) + doc.holds[f] > MAX_FRAMES) return false;
      make({ k: 'addFrame', f: f + 1, cels: doc.frames[f].map((c) => Array.from(c)), hold: doc.holds[f] }, { label: 'ed.h.frame-add', frame: f + 1 });
      return true;
    },
    /** @param {number} f */
    removeFrame(f) {
      if (doc.frames.length < 2) return false;
      make({ k: 'dropFrame', f, cels: doc.frames[f].map((c) => Array.from(c)), hold: doc.holds[f] }, { label: 'ed.h.frame-remove', frame: Math.min(f, doc.frames.length - 2) });
      return true;
    },
    /** @param {number} from @param {number} to */
    moveFrame(from, to) {
      if (to < 0 || to >= doc.frames.length || to === from) return false;
      make({ k: 'moveFrame', from, to }, { label: 'ed.h.frame-move', frame: to });
      return true;
    },
    /** Empties one layer of a frame. @param {number} f @param {number} l */
    clearFrame(f, l) {
      const s = api.stroke(f, l);
      for (let i = 0; i < doc.size * doc.size; i++) s.set(i, T);
      s.commit('ed.h.clear');
    },
    /** How many ticks frame `f` lasts: 1 to MAX_HOLD, within the card's frames. @param {number} f @param {number} n */
    canHold: (f, n) => n >= 1 && n <= MAX_HOLD && ticks(doc) - doc.holds[f] + n <= MAX_FRAMES,
    /** @param {number} f @param {number} n */
    setHold(f, n) {
      if (n === doc.holds[f] || !api.canHold(f, n)) return false;
      const holds = [...doc.holds];
      holds[f] = n;
      make(set('holds', holds), { label: 'ed.h.hold', frame: f, merge: `hold:${f}` });
      return true;
    },

    // ------------------------------------------------------------ layers --
    /** A new empty layer right above `l`; its index, or -1 when full. @param {number} l */
    addLayer(l) {
      if (doc.layers.length >= MAX_LAYERS) return -1;
      const n = Math.max(...doc.layers.map((x) => x.n)) + 1;
      make({ k: 'addLayer', l: l + 1, layer: { n, hidden: false }, cels: doc.frames.map(empty) }, { label: 'ed.h.layer-add' });
      return l + 1;
    },
    /** @param {number} l */
    removeLayer(l) {
      if (doc.layers.length < 2) return false;
      make({ k: 'dropLayer', l, layer: { ...doc.layers[l] }, cels: doc.frames.map((f) => Array.from(f[l])) }, { label: 'ed.h.layer-remove' });
      return true;
    },
    /** @param {number} from @param {number} to */
    moveLayer(from, to) {
      if (to < 0 || to >= doc.layers.length || to === from) return false;
      make({ k: 'moveLayer', from, to }, { label: 'ed.h.layer-move' });
      return true;
    },
    /** Shown or hidden: a hidden layer is left out of the card too. @param {number} l @param {boolean} hidden */
    setHidden(l, hidden) {
      if (doc.layers[l].hidden === hidden) return;
      make(set('layers', doc.layers.map((x, k) => (k === l ? { ...x, hidden } : { ...x }))), { label: hidden ? 'ed.h.layer-hide' : 'ed.h.layer-show' });
    },
    /** Whether layer `l` can go down into the one below: both there and shown. @param {number} l */
    canMerge: (l) => l > 0 && !doc.layers[l].hidden && !doc.layers[l - 1].hidden,
    /** Layer `l` pressed into the one below it, in every frame. @param {number} l */
    mergeDown(l) {
      if (!api.canMerge(l)) return false;
      const b = doc.frames.map((f) => Array.from(f[l - 1]));
      const a = doc.frames.map((f) => Array.from(f[l - 1], (v, i) => (f[l][i] === T ? v : f[l][i])));
      make({ k: 'group', items: [{ k: 'cels', l: l - 1, b, a }, { k: 'dropLayer', l, layer: { ...doc.layers[l] }, cels: doc.frames.map((f) => Array.from(f[l])) }] }, { label: 'ed.h.layer-merge' });
      return true;
    },

    // ----------------------------------------------------------- canvas --
    /** A new size, keeping the middle of the picture. @param {number} size */
    resize(size) {
      if (size === doc.size) return;
      const off = Math.floor((size - doc.size) / 2);
      const a = mapCels((c) => {
        const out = new Array(size * size).fill(T);
        for (let y = 0; y < size; y++) {
          for (let x = 0; x < size; x++) {
            const sx = x - off, sy = y - off;
            if (sx >= 0 && sy >= 0 && sx < doc.size && sy < doc.size) out[y * size + x] = c[sy * doc.size + sx];
          }
        }
        return out;
      });
      make({ k: 'group', items: [set('size', size), { k: 'frames', b: snapshot(doc), a }] }, { label: 'ed.h.size' });
    },
    /** Whether a new size would cut something off, on any layer. @param {number} size */
    cropsAt(size) {
      if (size >= doc.size) return false;
      const off = Math.floor((doc.size - size) / 2);
      return doc.frames.some((f) => f.some((c) => c.some((v, i) => {
        const x = i % doc.size, y = (i - x) / doc.size;
        return v !== T && (x < off || y < off || x >= off + size || y >= off + size);
      })));
    },

    // ----------------------------------------------------------- colours --
    /**
     * Another palette: every cell takes its nearest colour there.
     * @param {number[]} colors @param {number|null} id built-in id, or null
     */
    setPalette(colors, id) {
      const map = doc.colors.map((c) => nearest(c, colors));
      const a = mapCels((c) => Array.from(c, (v) => (v === T ? T : map[v] ?? 0)));
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
    /** Whether any cell of any layer of any frame uses colour `i`. @param {number} i */
    uses(i) { return doc.frames.some((f) => f.some((c) => c.includes(i))); },

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
      const keys = /** @type {const} */ (['size', 'colors', 'builtin', 'title', 'shade', 'delay', 'holds', 'layers']);
      make({ k: 'group', items: [...keys.map((key) => set(key, structuredClone(/** @type {any} */ (fresh)[key]))), { k: 'frames', b: snapshot(doc), a: snapshot(fresh) }] }, { label: 'ed.h.new', frame: 0 });
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
    /** @param {any} n a step of history.line() @returns {boolean} whether it was still there to go to */
    goTo(n) {
      if (!history.goTo(n)) return false;
      changed({ frame: n.frame, whole: true });
      return true;
    },
  };
  return api;
}
