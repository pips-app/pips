// @ts-check
// The drawing surface: the picture over a checkerboard of its own cells,
// the previous frame faintly beneath it (the onion skin), the grid, and
// where the next pixel would go. It can be zoomed and moved; it does not
// know about tools — it draws what it is given and tells which cell a point
// of the page is over.
//
// Three small canvases at the picture's own resolution, scaled up with
// pixelated sampling, so cells, checks and onion line up exactly whatever
// the zoom; one more, at the screen's resolution, for the thin lines.

import { h } from '../dom.js';
import { T } from './model.js';
import { rgb, toHsv, fromHsv } from './color.js';
import { clamp } from '../kit/motion.js';

const ONION = [91, 127, 192]; // cool blue, so the previous frame never reads as paint
const GRID_MIN = 7; // px a cell needs on screen to show the grid

export function createCanvas() {
  const checker = /** @type {HTMLCanvasElement} */ (h('canvas', { class: 'ed-layer' }));
  const onion = /** @type {HTMLCanvasElement} */ (h('canvas', { class: 'ed-layer ed-onion' }));
  const pix = /** @type {HTMLCanvasElement} */ (h('canvas', { class: 'ed-layer' }));
  const lines = /** @type {HTMLCanvasElement} */ (h('canvas', { class: 'ed-lines', 'aria-hidden': 'true' }));
  const stage = h('div', { class: 'ed-stage' }, checker, onion, pix);
  const el = h('div', { class: 'ed-art', role: 'img' }, stage, lines);

  let size = 0, zoom = 1, tx = 0, ty = 0, paper = 0xf6f3eb;
  /** @type {{cursor: {x: number, y: number}|null, grid: boolean, flash: {cells: number[], until: number}|null}} */
  const marks = { cursor: null, grid: true, flash: null };

  const side = () => el.clientWidth || 1;
  const maxZoom = () => Math.max(1, (48 * size) / side()); // a cell up to ~48 px
  function place() {
    const w = side();
    zoom = clamp(zoom, 1, maxZoom());
    tx = clamp(tx, w - w * zoom, 0);
    ty = clamp(ty, w - w * zoom, 0);
    stage.style.transform = `translate(${tx}px,${ty}px) scale(${zoom})`;
    drawLines();
  }

  /** The checks: two tones of the frame's paper, one check per cell. */
  function drawChecker() {
    const { h: hu, s, v } = toHsv(paper);
    const a = fromHsv(hu, s, v * 0.9), b = fromHsv(hu, s, v * 0.85);
    const g = /** @type {CanvasRenderingContext2D} */ (checker.getContext('2d'));
    const img = g.createImageData(size, size);
    for (let i = 0; i < size * size; i++) {
      const x = i % size, y = (i - x) / size, [r, gg, bb] = rgb((x + y) % 2 ? a : b);
      img.data.set([r, gg, bb, 255], i * 4);
    }
    g.putImageData(img, 0, 0);
  }

  /** The thin things, at the screen's resolution. */
  function drawLines() {
    const w = side(), dpr = devicePixelRatio || 1, px = Math.round(w * dpr);
    if (lines.width !== px) { lines.width = px; lines.height = px; }
    const g = /** @type {CanvasRenderingContext2D} */ (lines.getContext('2d'));
    g.clearRect(0, 0, px, px);
    if (!size) return;
    const cell = (w * zoom) / size;
    const at = (/** @type {number} */ k, /** @type {number} */ t) => Math.round((t + k * cell) * dpr) + 0.5;
    if (marks.grid && cell >= GRID_MIN) {
      g.strokeStyle = 'rgba(0,0,0,.2)';
      g.lineWidth = 1;
      g.beginPath();
      for (let k = 1; k < size; k++) {
        g.moveTo(at(k, tx), 0); g.lineTo(at(k, tx), px);
        g.moveTo(0, at(k, ty)); g.lineTo(px, at(k, ty));
      }
      g.stroke();
    }
    const now = performance.now();
    if (marks.flash && marks.flash.until > now) {
      g.fillStyle = `rgba(109,143,214,${0.55 * ((marks.flash.until - now) / 600)})`;
      for (const i of marks.flash.cells) {
        const x = i % size, y = (i - x) / size;
        g.fillRect((tx + x * cell) * dpr, (ty + y * cell) * dpr, cell * dpr, cell * dpr);
      }
    } else marks.flash = null;
    if (marks.cursor) {
      const { x, y } = marks.cursor, s = cell * dpr, X = (tx + x * cell) * dpr, Y = (ty + y * cell) * dpr;
      g.lineWidth = Math.max(1, dpr);
      g.strokeStyle = '#1a1b21';
      g.strokeRect(X + 0.5, Y + 0.5, s - 1, s - 1);
      g.strokeStyle = '#ffffff';
      g.strokeRect(X + 0.5 + dpr, Y + 0.5 + dpr, s - 1 - 2 * dpr, s - 1 - 2 * dpr);
    }
  }

  /** @param {HTMLCanvasElement} cv @param {Uint8Array|null} buf @param {number[]} colors @param {number[]|null} tint */
  function drawCells(cv, buf, colors, tint) {
    const g = /** @type {CanvasRenderingContext2D} */ (cv.getContext('2d'));
    const img = g.createImageData(size, size);
    if (buf) {
      for (let i = 0; i < buf.length; i++) {
        const v = buf[i];
        if (v === T) continue;
        const [r, gg, b] = tint ?? rgb(colors[v] ?? 0);
        img.data[i * 4] = r; img.data[i * 4 + 1] = gg; img.data[i * 4 + 2] = b; img.data[i * 4 + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
  }

  return {
    el,
    /**
     * Draws a frame. @param {import('./model.js').Doc} doc @param {number} f
     * @param {{onion: number|null, paper: number}} o onion: the frame beneath, or null
     */
    paint(doc, f, o) {
      if (doc.size !== size || o.paper !== paper) {
        if (doc.size !== size) { zoom = 1; tx = ty = 0; }
        size = doc.size;
        paper = o.paper;
        for (const cv of [checker, onion, pix]) { cv.width = size; cv.height = size; }
        drawChecker();
      }
      drawCells(pix, doc.frames[f], doc.colors, null);
      drawCells(onion, o.onion == null ? null : doc.frames[o.onion], doc.colors, ONION);
      place();
    },
    /** The cell under a point of the page (it may lie outside). @param {{x: number, y: number}} p */
    cellAt(p) {
      const r = el.getBoundingClientRect(), cell = (r.width * zoom) / size;
      return { x: Math.floor((p.x - r.left - tx) / cell), y: Math.floor((p.y - r.top - ty) / cell) };
    },
    /** @param {{x: number, y: number}|null} c */
    cursor(c) {
      if (c?.x === marks.cursor?.x && c?.y === marks.cursor?.y) return;
      marks.cursor = c;
      drawLines();
    },
    /** @param {boolean} on */
    grid(on) { marks.grid = on; drawLines(); },
    /** Lights up cells for a moment: what an undo just changed. @param {number[]} cells */
    flash(cells) {
      marks.flash = { cells, until: performance.now() + 600 };
      const tick = () => { drawLines(); if (marks.flash) requestAnimationFrame(tick); };
      requestAnimationFrame(tick);
    },
    /** Moving and zooming with fingers (or the middle button). */
    view() {
      let z0 = 1, x0 = 0, y0 = 0, d0 = 0, m0 = { x: 0, y: 0 };
      return {
        /** @param {{x: number, y: number}} m @param {number} d */
        start(m, d) { z0 = zoom; x0 = tx; y0 = ty; d0 = d; m0 = m; },
        /** @param {{x: number, y: number}} m @param {number} d */
        move(m, d) {
          const r = el.getBoundingClientRect();
          zoom = clamp(d0 > 0 && d > 0 ? z0 * (d / d0) : z0, 1, maxZoom());
          // The point of the picture first under the fingers stays under them.
          const px = (m0.x - r.left - x0) / z0, py = (m0.y - r.top - y0) / z0;
          tx = m.x - r.left - px * zoom;
          ty = m.y - r.top - py * zoom;
          place();
        },
        end() {},
      };
    },
    /** Zooms by a factor around a point of the page. @param {number} f @param {{x: number, y: number}} at */
    zoomBy(f, at) {
      const r = el.getBoundingClientRect(), z = clamp(zoom * f, 1, maxZoom());
      const px = (at.x - r.left - tx) / zoom, py = (at.y - r.top - ty) / zoom;
      zoom = z;
      tx = at.x - r.left - px * zoom;
      ty = at.y - r.top - py * zoom;
      place();
    },
    /** @param {number} dx @param {number} dy */
    panBy(dx, dy) { tx -= dx; ty -= dy; place(); },
    /** Whole picture in view. */
    fit() { zoom = 1; tx = ty = 0; place(); },
    /** After the page's layout changed. */
    relayout: () => place(),
    get zoomed() { return zoom > 1.01; },
  };
}
