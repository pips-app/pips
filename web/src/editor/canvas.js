// @ts-check
// The drawing surface: the picture over a checkerboard of its own cells,
// the previous frame faintly beneath it (the onion skin), the grid, and
// where the next pixel would go. It does not know about tools — it draws
// what it is given and tells which cell a point of the page is over.
//
// Zooming brings the whole card closer, paper and all, like a card lifted
// to the eye: the card is scaled and moved inside its viewport, which clips
// it. What is drawn over the card's art — the checks, the cells, the onion,
// the grid, the cursor, the light of an undo — is drawn on one canvas over
// the viewport, at the screen's resolution, every cell edge on the same
// whole device pixel as the grid line beside it. Left to the browser (a
// small canvas scaled up), a cell edge falls where its rounding puts it,
// which at most sizes and screens is a pixel off the grid. The card keeps
// three small canvases of its own for its layout and the tests' eyes.

import { h } from '../dom.js';
import { T } from './model.js';
import { rgb, toHsv, fromHsv } from './color.js';
import { clamp } from '../kit/motion.js';

const ONION = [91, 127, 192]; // cool blue, so the previous frame never reads as paint
const GRID_MIN = 7; // px a cell needs on screen to show the grid
const CELL_MAX = 48; // px a cell may grow to

export function createCanvas() {
  const checker = /** @type {HTMLCanvasElement} */ (h('canvas', { class: 'ed-layer' }));
  const onion = /** @type {HTMLCanvasElement} */ (h('canvas', { class: 'ed-layer ed-onion' }));
  const pix = /** @type {HTMLCanvasElement} */ (h('canvas', { class: 'ed-layer' }));
  const lines = /** @type {HTMLCanvasElement} */ (h('canvas', { class: 'ed-lines', 'aria-hidden': 'true' }));
  const el = h('div', { class: 'ed-art', role: 'img' }, checker, onion, pix);
  /** @type {HTMLElement} */
  let viewport = el, target = el;

  let size = 0, zoom = 1, tx = 0, ty = 0, paper = 0xf6f3eb;
  /** What the screen layer draws: the frame, its colours, the onion frame, the checks' two tones. */
  const shown = { buf: /** @type {Uint8Array|null} */ (null), colors: /** @type {number[]} */ ([]), onion: /** @type {Uint8Array|null} */ (null), checks: ['#000', '#000'] };
  /** @type {{cursor: {x: number, y: number}|null, grid: boolean, flash: {cells: number[], until: number}|null, box: import('./raster.js').Rect|null}} */
  const marks = { cursor: null, grid: true, flash: null, box: null };

  /** The card's place in the viewport before any zoom, and the art's in the card. */
  const base = () => ({ x: target.offsetLeft, y: target.offsetTop, w: target.offsetWidth, h: target.offsetHeight, aw: el.offsetWidth });
  /** Where the art is now, in viewport pixels. */
  function art() {
    const b = base(), off = offsetIn(el, target);
    return { x: b.x + tx + off.x * zoom, y: b.y + ty + off.y * zoom, w: b.aw * zoom };
  }
  const maxZoom = () => Math.max(1, (CELL_MAX * size) / (el.offsetWidth || 1));

  /** Keeps the card on screen: centred while it fits, else covering the viewport. */
  function place() {
    const b = base(), W = viewport.clientWidth, H = viewport.clientHeight;
    zoom = clamp(zoom, 1, maxZoom());
    const fit = (/** @type {number} */ at, /** @type {number} */ t, /** @type {number} */ len, /** @type {number} */ room) => {
      const span = len * zoom;
      const x0 = span <= room ? at - (span - len) / 2 : clamp(at + t, room - span, 0);
      return x0 - at;
    };
    tx = zoom === 1 ? 0 : fit(b.x, tx, b.w, W);
    ty = zoom === 1 ? 0 : fit(b.y, ty, b.h, H);
    target.style.transform = zoom === 1 ? '' : `translate(${tx}px,${ty}px) scale(${zoom})`;
    target.classList.toggle('lifted', zoom > 1);
    drawLines();
  }

  /** The checks: two tones of the frame's paper, one check per cell. */
  function drawChecker() {
    const { h: hu, s, v } = toHsv(paper);
    const a = fromHsv(hu, s, v * 0.9), b = fromHsv(hu, s, v * 0.85);
    shown.checks = [a, b].map((c) => `rgb(${rgb(c).join(',')})`);
    const g = /** @type {CanvasRenderingContext2D} */ (checker.getContext('2d'));
    const img = g.createImageData(size, size);
    for (let i = 0; i < size * size; i++) {
      const x = i % size, y = (i - x) / size, [r, gg, bb] = rgb((x + y) % 2 ? a : b);
      img.data.set([r, gg, bb, 255], i * 4);
    }
    g.putImageData(img, 0, 0);
  }

  /** The thin things, over the viewport, at the screen's resolution. */
  function drawLines() {
    const dpr = devicePixelRatio || 1;
    // One canvas pixel to one device pixel, exactly: the canvas covers the
    // viewport from a place and with a size that are whole CSS pixels and
    // whole device pixels at once — otherwise the browser resamples it, and
    // the edges blur off the grid.
    const r = viewport.getBoundingClientRect(), q = step(dpr);
    const left = Math.floor(r.left / q) * q, top = Math.floor(r.top / q) * q; // in page CSS pixels
    const cw = Math.ceil((r.right - left) / q) * q, chh = Math.ceil((r.bottom - top) / q) * q;
    const ox = Math.round(left * dpr), oy = Math.round(top * dpr), pw = Math.round(cw * dpr), ph = Math.round(chh * dpr);
    if (lines.width !== pw || lines.height !== ph) {
      lines.width = pw;
      lines.height = ph;
      Object.assign(lines.style, { width: `${cw}px`, height: `${chh}px` });
    }
    Object.assign(lines.style, { left: `${left - r.left}px`, top: `${top - r.top}px` });
    const g = /** @type {CanvasRenderingContext2D} */ (lines.getContext('2d'));
    g.clearRect(0, 0, pw, ph);
    if (!size) return;
    const a = art(), cell = a.w / size;
    /** A cell edge on the device's pixel grid, in the canvas's pixels. */
    const X = (/** @type {number} */ k) => Math.round((r.left + a.x + k * cell) * dpr) - ox, Y = (/** @type {number} */ k) => Math.round((r.top + a.y + k * cell) * dpr) - oy;
    g.save();
    g.beginPath();
    g.rect(X(0), Y(0), X(size) - X(0), Y(size) - Y(0));
    g.clip(); // nothing over the paper
    // The checks, then the onion, then the cells: each cell from one whole
    // device pixel to the next, exactly where the grid's lines are.
    g.fillStyle = shown.checks[1];
    g.fillRect(X(0), Y(0), X(size) - X(0), Y(size) - Y(0));
    g.fillStyle = shown.checks[0];
    for (let y = 0; y < size; y++) for (let x = (y + 1) % 2; x < size; x += 2) g.fillRect(X(x), Y(y), X(x + 1) - X(x), Y(y + 1) - Y(y));
    if (shown.onion) {
      g.globalAlpha = 0.45;
      g.fillStyle = `rgb(${ONION.join(',')})`;
      cells(g, shown.onion, X, Y, () => g.fillStyle);
      g.globalAlpha = 1;
    }
    if (shown.buf) cells(g, shown.buf, X, Y, (v) => `rgb(${rgb(shown.colors[v] ?? 0).join(',')})`);
    if (marks.grid && cell >= GRID_MIN) {
      g.strokeStyle = 'rgba(0,0,0,.2)';
      g.lineWidth = 1;
      g.beginPath();
      for (let k = 1; k < size; k++) {
        g.moveTo(X(k) + 0.5, Y(0)); g.lineTo(X(k) + 0.5, Y(size));
        g.moveTo(X(0), Y(k) + 0.5); g.lineTo(X(size), Y(k) + 0.5);
      }
      g.stroke();
    }
    const now = performance.now();
    if (marks.flash && marks.flash.until > now) {
      g.fillStyle = `rgba(109,143,214,${0.55 * ((marks.flash.until - now) / 600)})`;
      for (const i of marks.flash.cells) {
        const x = i % size, y = (i - x) / size;
        g.fillRect(X(x), Y(y), X(x + 1) - X(x), Y(y + 1) - Y(y));
      }
    } else marks.flash = null;
    g.restore();
    if (marks.box) {
      // The selection: a dashed line, dark and light, so it shows on any colour.
      const b = marks.box, x0 = X(b.x0) + 0.5, y0 = Y(b.y0) + 0.5, w = X(b.x1 + 1) - X(b.x0) - 1, hh = Y(b.y1 + 1) - Y(b.y0) - 1, dash = 4 * dpr;
      g.lineWidth = Math.max(1, Math.round(dpr));
      g.setLineDash([dash, dash]);
      g.strokeStyle = '#ffffff';
      g.strokeRect(x0, y0, w, hh);
      g.lineDashOffset = dash;
      g.strokeStyle = '#1a1b21';
      g.strokeRect(x0, y0, w, hh);
      g.setLineDash([]);
      g.lineDashOffset = 0;
    }
    if (marks.cursor && marks.cursor.x >= 0 && marks.cursor.y >= 0 && marks.cursor.x < size && marks.cursor.y < size) {
      const { x, y } = marks.cursor, x0 = X(x), y0 = Y(y), s = X(x + 1) - x0, lw = Math.max(1, Math.round(dpr));
      g.lineWidth = lw;
      g.strokeStyle = '#1a1b21';
      g.strokeRect(x0 + lw / 2, y0 + lw / 2, s - lw, s - lw);
      g.strokeStyle = '#ffffff';
      g.strokeRect(x0 + lw * 1.5, y0 + lw * 1.5, s - lw * 3, s - lw * 3);
    }
  }

  /**
   * The cells of a frame on the screen layer, one colour run at a time.
   * @param {CanvasRenderingContext2D} g @param {Uint8Array} buf
   * @param {(k: number) => number} X @param {(k: number) => number} Y @param {(v: number) => string|CanvasGradient|CanvasPattern} paint
   */
  function cells(g, buf, X, Y, paint) {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const v = buf[y * size + x];
        if (v === T) continue;
        let e = x + 1; // a run of one colour is one rectangle
        while (e < size && buf[y * size + e] === v) e++;
        g.fillStyle = paint(v);
        g.fillRect(X(x), Y(y), X(e) - X(x), Y(y + 1) - Y(y));
        x = e - 1;
      }
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

  /** A point of the page in viewport pixels. @param {{x: number, y: number}} p */
  const local = (p) => {
    const r = viewport.getBoundingClientRect();
    return { x: p.x - r.left, y: p.y - r.top };
  };

  return {
    el,
    /**
     * Where the canvas lives: `viewport` clips and holds the thin lines,
     * `target` (the card around the art) is what zooming moves.
     * @param {HTMLElement} v @param {HTMLElement} t
     */
    mount(v, t) {
      viewport = v;
      target = t;
      v.append(lines);
      // The lines are drawn from the card's place in the layout, so they
      // follow any change of it — not only the window's: the title's font
      // arriving, the palette or the frames below growing, the editor
      // opening into its final size. Otherwise the grid sits off the cells.
      const follow = new ResizeObserver(() => place());
      for (const e of [v, t, el]) follow.observe(e);
    },
    /**
     * Draws a frame. @param {import('./model.js').Doc} doc @param {number} f
     * @param {{onion: number|null, paper: number}} o onion: the frame beneath, or null
     */
    paint(doc, f, o) {
      if (doc.size !== size || o.paper !== paper) {
        if (doc.size !== size) zoom = 1;
        size = doc.size;
        paper = o.paper;
        for (const cv of [checker, onion, pix]) { cv.width = size; cv.height = size; }
        drawChecker();
      }
      drawCells(pix, doc.frames[f], doc.colors, null);
      drawCells(onion, o.onion == null ? null : doc.frames[o.onion], doc.colors, ONION);
      shown.buf = doc.frames[f];
      shown.colors = doc.colors;
      shown.onion = o.onion == null ? null : doc.frames[o.onion];
      place();
    },
    /** The cell under a point of the page (it may lie outside). @param {{x: number, y: number}} p */
    cellAt(p) {
      const q = local(p), a = art(), cell = a.w / size;
      return { x: Math.floor((q.x - a.x) / cell), y: Math.floor((q.y - a.y) / cell) };
    },
    /** Where the next pixel would go, or nothing. @param {{x: number, y: number}|null} c */
    cursor(c) {
      if (c?.x === marks.cursor?.x && c?.y === marks.cursor?.y) return;
      marks.cursor = c;
      drawLines();
    },
    /** @param {boolean} on */
    grid(on) { marks.grid = on; drawLines(); },
    /** The selection's box, or none. @param {import('./raster.js').Rect|null} b */
    box(b) { marks.box = b; drawLines(); },
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
        start(m, d) { z0 = zoom; x0 = tx; y0 = ty; d0 = d; m0 = local(m); },
        /** @param {{x: number, y: number}} m @param {number} d */
        move(m, d) {
          const q = local(m), b = base();
          zoom = clamp(d0 > 0 && d > 0 ? z0 * (d / d0) : z0, 1, maxZoom());
          // The point of the card first under the fingers stays under them.
          const ux = (m0.x - b.x - x0) / z0, uy = (m0.y - b.y - y0) / z0;
          tx = q.x - b.x - ux * zoom;
          ty = q.y - b.y - uy * zoom;
          place();
        },
        end() {},
      };
    },
    /** Zooms by a factor around a point of the page. @param {number} f @param {{x: number, y: number}} at */
    zoomBy(f, at) {
      const q = local(at), b = base(), z = clamp(zoom * f, 1, maxZoom());
      const ux = (q.x - b.x - tx) / zoom, uy = (q.y - b.y - ty) / zoom;
      zoom = z;
      tx = q.x - b.x - ux * zoom;
      ty = q.y - b.y - uy * zoom;
      place();
    },
    /** @param {number} dx @param {number} dy */
    panBy(dx, dy) { tx -= dx; ty -= dy; place(); },
    /** The whole card in view. */
    fit() { zoom = 1; place(); },
    /** Moves a zoomed view just enough that a cell (and a cell around it) is in sight. @param {{x: number, y: number}} c */
    reveal(c) {
      if (zoom <= 1 || !size) return;
      const a = art(), cell = a.w / size, W = viewport.clientWidth, H = viewport.clientHeight, m = cell * 1.5;
      const x0 = a.x + c.x * cell, y0 = a.y + c.y * cell;
      if (x0 < m) tx += m - x0; else if (x0 + cell > W - m) tx -= x0 + cell - (W - m);
      if (y0 < m) ty += m - y0; else if (y0 + cell > H - m) ty -= y0 + cell - (H - m);
      place();
    },
    /** After the page's layout changed. */
    relayout: () => place(),
    get zoomed() { return zoom > 1.01; },
  };
}

/**
 * The fewest whole CSS pixels that are also whole device pixels. Browsers
 * put a canvas on whole CSS pixels (Chrome rounds its place and size), so
 * at 2.625 only every 8th one starts a device pixel: a canvas anywhere
 * else is resampled, and every line on it blurs over two pixels.
 * @param {number} dpr
 */
function step(dpr) {
  for (let q = 1; q <= 64; q++) if (Math.abs(q * dpr - Math.round(q * dpr)) < 1e-6) return q;
  return 1;
}

/** Where `el` sits inside `outer`, before transforms. @param {HTMLElement} el @param {HTMLElement} outer */
function offsetIn(el, outer) {
  let x = 0, y = 0;
  for (let n = /** @type {HTMLElement|null} */ (el); n && n !== outer; n = /** @type {HTMLElement|null} */ (n.offsetParent)) {
    x += n.offsetLeft;
    y += n.offsetTop;
  }
  return { x, y };
}
