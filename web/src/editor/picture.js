// @ts-check
// A picture from a file, onto the editor's canvas: PNG or Aseprite pixel
// art as it is, any other picture (a photo, a screenshot) through a square
// crop. The file never leaves the device; the core does the conversion
// (pips-raster) and this sheet shows what it did and passes the options
// back. Each change re-runs it from the original, so options never
// compound. What lands on the canvas is a picture like any other: named,
// framed and signed in the editor, and undone there with one step.
//
// Pixel art that is square and fits the editor goes straight to the
// canvas sheet's preview. Anything else is cropped: a square over the
// picture, moved with a finger and sized by its corners (or the wheel).
// Pixel art is cropped on its own pixel grid and keeps every pixel;
// a photo is scaled down to the chosen size and fitted to a palette.

import { h, replace } from '../dom.js';
import { t, reason } from '../i18n.js';
import { app } from '../state.js';
import { fullSheet } from '../kit/full-sheet.js';
import { segmented } from '../kit/segmented.js';
import { toast } from '../ui/shell.js';
import { caught } from '../diagnostics.js';
import { issuable } from '../budget.js';
import { fromCard } from './from-card.js';
import { isPng, envelopeIn } from '../png-card.js';
import { peek, arrive } from '../ui/arrival.js';
import { SIZES } from './model.js';

const ACCEPT = 'image/*,.png,.aseprite,.ase';
const MAX_FILE = 32 * 1024 * 1024;
/** A crop is never smaller than this, in pixels of the source. */
const MIN_CROP = 4;
const CORNER = 28; // px of screen around a corner that take it

/** @type {HTMLInputElement|null} */
let input = null;

/**
 * Asks for a file (call it from a tap), then shows what it becomes; `done`
 * gets the picture for the canvas. @param {(doc: import('./model.js').Doc) => void} done
 */
export function pickPicture(done) {
  input?.remove();
  input = /** @type {HTMLInputElement} */ (h('input', { type: 'file', accept: ACCEPT, hidden: true }));
  input.addEventListener('change', () => {
    const f = input?.files?.[0];
    input?.remove();
    input = null;
    if (f) openPicture(f, done).catch((e) => { caught(e, 'picture'); toast(t('err.generic')); });
  });
  document.body.append(input);
  input.click();
}

/** @param {File} file @param {(doc: import('./model.js').Doc) => void} done */
export async function openPicture(file, done) {
  if (file.size > MAX_FILE) return toast(t('import.err.too_large'));
  const bytes = new Uint8Array(await file.arrayBuffer());
  const aseprite = /\.(aseprite|ase)$/i.test(file.name);
  const sourceUrl = aseprite ? null : URL.createObjectURL(file);

  /** @type {() => void} */
  let stopPlay = () => {};
  const sheet = fullSheet(t('pic.title'), () => {
    stopPlay();
    if (sourceUrl) URL.revokeObjectURL(sourceUrl);
  });
  // A picture of a card from Pips holds the card itself: offered first —
  // it is most likely what the person meant — the drawing still below.
  const inside = isPng(bytes) ? envelopeIn(bytes) : null;
  const who = inside && peek(inside);
  const carried = inside && who
    ? h('div', { class: 'pic-card' },
      h('p', {}, t('pic.has-card', who.title, who.author ? `@${who.author}` : '—')),
      h('button', { class: 'btn key wide', onclick: () => { sheet.close(); arrive(inside); } }, t('pic.add-card')))
    : '';
  const toCanvas = /** @type {HTMLButtonElement} */ (h('button', { class: 'btn key' }, t('pic.place')));
  const other = h('button', { class: 'btn', onclick: () => { sheet.close(); pickPicture(done); } }, t('pic.other'));
  replace(sheet.foot, h('div', { class: 'row-btns' }, other, toCanvas));

  /** Places a converted card on the canvas, if it is a picture the editor takes. @param {any} card */
  const place = (card) => {
    const doc = fromCard({ ...card, title: '' }, builtinColors);
    if (!doc) return;
    sheet.close();
    done(doc);
  };

  // Pixel art first: the core reads PNG and Aseprite as they are.
  /** @type {{keepScale: boolean, firstFrameOnly: boolean, palette: number|undefined, fit: number|undefined}} */
  const opts = { keepScale: false, firstFrameOnly: false, palette: undefined, fit: undefined };
  /** @type {any} */
  let result = null;
  /** @type {any} */
  let error = null;
  let autoFit = false;
  const run = () => {
    try {
      result = app.core.importPicture(bytes, { ...opts });
      error = null;
    } catch (e) {
      caught(e, 'picture');
      result = null;
      error = e;
      // Too many colours for exact: fit its own palette rather than stop.
      if (error?.code === 'too_many_colors' && opts.palette == null && opts.fit == null) {
        opts.fit = 32;
        autoFit = true;
        return run();
      }
    }
  };
  const isPicture = /\.(png|aseprite|ase)$/i.test(file.name) || file.type === 'image/png';
  if (isPicture) run();

  // Pixel art the canvas holds (up to 64 a side): as it is, centred if need be.
  if (result && fromCard(result.card, builtinColors)) return pixelView();
  // Otherwise a crop — of the pixel art itself, or of the picture as the browser shows it.
  if (aseprite) {
    replace(sheet.body, carried, h('p', { class: 'import-status bad' }, error ? explain(error) : t('pic.ase-square')));
    toCanvas.disabled = true;
    return;
  }
  const source = result && !error ? await bitmapOf(result.card) : await createImageBitmap(file).catch(() => null);
  if (!source) {
    replace(sheet.body, carried, h('p', { class: 'import-status bad' }, t('pic.unreadable')));
    toCanvas.disabled = true;
    return;
  }
  return cropView(source, !!(result && !error));

  // ------------------------------------------------------------- pixel art --
  function pixelView() {
    let original = false;
    const preview = h('button', { type: 'button', class: 'pic-tile', 'aria-label': t('import.toggle'), onclick: () => { if (sourceUrl) { original = !original; paint(); } } });
    const status = h('p', { class: 'import-status', 'aria-live': 'polite' });
    const palette = paletteSelect(opts.fit ? `fit:${opts.fit}` : '', (v) => { setPalette(v); autoFit = false; run(); paint(); });
    const extras = h('div', { class: 'group import-extras' });
    replace(sheet.body, carried, h('div', { class: 'pic-body' }, preview, status, h('div', { class: 'group' }, h('div', { class: 'field' }, h('label', {}, t('import.opt.palette')), palette)), extras));
    toCanvas.onclick = () => { if (result) place(result.card); };

    function paint() {
      stopPlay();
      const fits = !!(result && fromCard(result.card, builtinColors));
      if (result && !original) stopPlay = showCard(preview, result.card);
      else replace(preview, sourceUrl ? h('img', { class: `import-original${result ? '' : ' dim'}`, src: sourceUrl, alt: '' }) : '');
      preview.append(sourceUrl && result ? h('span', { class: 'import-chip' }, t(original ? 'import.before' : 'import.after')) : '');
      status.classList.toggle('bad', !!error || !fits);
      status.textContent = error ? explain(error) : result ? (fits ? report(result, opts, autoFit) : t('pic.not-square')) : '';
      palette.value = opts.fit ? `fit:${opts.fit}` : opts.palette != null ? String(opts.palette) : '';
      toCanvas.disabled = !fits;
      const rows = [];
      if (result?.scale > 1 || opts.keepScale) rows.push(toggle('keepScale', t('import.opt.keep-scale')));
      if ((result?.sourceFrames ?? 0) > 1 || opts.firstFrameOnly || error?.code === 'unequal_delays' || error?.code === 'too_many_frames') rows.push(toggle('firstFrameOnly', t('import.opt.first-frame')));
      extras.replaceChildren(...rows);
    }
    /** @param {'keepScale'|'firstFrameOnly'} key @param {string} label */
    function toggle(key, label) {
      const box = /** @type {HTMLInputElement} */ (h('input', { type: 'checkbox' }));
      box.checked = opts[key];
      box.addEventListener('change', () => { opts[key] = box.checked; run(); paint(); });
      return h('label', { class: 'check' }, box, h('span', {}, label));
    }
    paint();
  }

  /** @param {string} v '' exact colours, 'fit:N' own colours fitted to N, else a built-in id */
  function setPalette(v) {
    opts.fit = v.startsWith('fit:') ? Number(v.slice(4)) : undefined;
    opts.palette = v === '' || v.startsWith('fit:') ? undefined : Number(v);
  }

  // ------------------------------------------------------------------ crop --
  /**
   * @param {ImageBitmap} src @param {boolean} pixel whether it is pixel art at
   * its own size (cropped on its grid) rather than a picture to scale down
   */
  function cropView(src, pixel) {
    const W = src.width, H = src.height;
    // Pixel art keeps every pixel: its square is never larger than the canvas.
    const most = pixel ? Math.min(W, H, SIZES[SIZES.length - 1]) : Math.min(W, H);
    let s = most, x = (W - s) / 2, y = (H - s) / 2;
    let size = 32;
    const crop = { palette: pixel ? '' : 'fit:32' };
    /** @type {any} */
    let made = null;

    const view = /** @type {HTMLCanvasElement} */ (h('canvas', { class: 'pic-source', width: W, height: H }));
    /** @type {CanvasRenderingContext2D} */ (view.getContext('2d')).drawImage(src, 0, 0);
    view.classList.toggle('pixel', pixel);
    const box = h('div', { class: 'pic-crop' }, h('i', { class: 'c tl' }), h('i', { class: 'c tr' }), h('i', { class: 'c bl' }), h('i', { class: 'c br' }));
    const stage = h('div', { class: 'pic-stage', 'aria-label': t('pic.crop.label') }, view, box);
    const tile = h('div', { class: 'pic-tile small' });
    const status = h('p', { class: 'import-status', 'aria-live': 'polite' });
    const sizes = segmented({
      label: t('ed.set.size'), value: String(size), options: SIZES.map((n) => ({ value: String(n), label: String(n) })),
      onChange: (v) => { size = Number(v); remake(); },
    });
    const palette = paletteSelect(crop.palette, (v) => { crop.palette = v; remake(); });
    replace(sheet.body, carried, h('div', { class: 'pic-body' },
      h('p', { class: 'hint pic-why' }, t(pixel ? 'pic.crop.pixel' : 'pic.crop.photo')),
      stage,
      h('div', { class: 'pic-result' }, tile, status),
      pixel ? '' : h('div', { class: 'ed-set-row' }, h('h3', {}, t('ed.set.size')), sizes.el),
      h('div', { class: 'group' }, h('div', { class: 'field' }, h('label', {}, t('import.opt.palette')), palette))));
    toCanvas.onclick = () => { if (made) place(made.card); };

    /** The picture as large as the sheet allows; pixel art at a whole number of screen px a pixel. */
    const size2 = () => {
      const room = sheet.body.clientWidth - 32, tall = Math.min(innerHeight * 0.52, 460);
      let q = Math.min(room / W, tall / H);
      if (pixel && q >= 1) q = Math.floor(q);
      view.style.width = `${W * q}px`;
      view.style.height = `${H * q}px`;
    };
    /** Screen px per source px. */
    const k = () => view.getBoundingClientRect().width / W;
    const lay = () => {
      const q = k();
      Object.assign(box.style, { left: `${x * q}px`, top: `${y * q}px`, width: `${s * q}px`, height: `${s * q}px` });
    };
    /** Keeps the square whole and inside, on whole pixels for pixel art. */
    const fit = () => {
      s = Math.max(Math.min(MIN_CROP, most), Math.min(s, most));
      if (pixel) { s = Math.round(s); x = Math.round(x); y = Math.round(y); }
      x = Math.min(Math.max(0, x), W - s);
      y = Math.min(Math.max(0, y), H - s);
    };

    // A finger on the square moves it; on a corner, it sizes it from the
    // opposite one. Beside the square, nothing: the picture stays put.
    /** @type {null | {id: number, mode: 'move'|'size', px: number, py: number, x0: number, y0: number, s0: number, ax: number, ay: number}} */
    let drag = null;
    stage.addEventListener('pointerdown', (e) => {
      const r = box.getBoundingClientRect();
      const near = (/** @type {number} */ cx, /** @type {number} */ cy) => Math.abs(e.clientX - cx) < CORNER && Math.abs(e.clientY - cy) < CORNER;
      const corners = /** @type {const} */ ([[r.left, r.top, 1, 1], [r.right, r.top, 0, 1], [r.left, r.bottom, 1, 0], [r.right, r.bottom, 0, 0]]);
      const hit = corners.find(([cx, cy]) => near(cx, cy));
      const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
      if (!hit && !inside) return;
      e.preventDefault();
      try { stage.setPointerCapture(e.pointerId); } catch { /* a pointer the browser no longer has */ }
      // The anchor: the corner across from the one taken (in source px).
      const ax = hit ? x + (hit[2] ? s : 0) : 0, ay = hit ? y + (hit[3] ? s : 0) : 0;
      drag = { id: e.pointerId, mode: hit ? 'size' : 'move', px: e.clientX, py: e.clientY, x0: x, y0: y, s0: s, ax, ay };
    });
    stage.addEventListener('pointermove', (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      const q = k(), dx = (e.clientX - drag.px) / q, dy = (e.clientY - drag.py) / q;
      if (drag.mode === 'move') {
        x = drag.x0 + dx;
        y = drag.y0 + dy;
      } else {
        // The finger's point, in source px; the square spans from the anchor to it.
        const fx = drag.ax === drag.x0 ? drag.x0 + drag.s0 + dx : drag.x0 + dx;
        const fy = drag.ay === drag.y0 ? drag.y0 + drag.s0 + dy : drag.y0 + dy;
        const side = Math.max(Math.abs(fx - drag.ax), Math.abs(fy - drag.ay));
        const room = Math.min(drag.ax === drag.x0 ? W - drag.ax : drag.ax, drag.ay === drag.y0 ? H - drag.ay : drag.ay);
        s = Math.max(MIN_CROP, Math.min(side, room, most));
        x = drag.ax === drag.x0 ? drag.ax : drag.ax - s;
        y = drag.ay === drag.y0 ? drag.ay : drag.ay - s;
      }
      fit();
      lay();
      remakeSoon();
    });
    const end = (/** @type {PointerEvent} */ e) => {
      if (!drag || e.pointerId !== drag.id) return;
      drag = null;
      remake();
    };
    stage.addEventListener('pointerup', end);
    stage.addEventListener('pointercancel', end);
    // The wheel sizes the square about its middle, on a computer.
    stage.addEventListener('wheel', (e) => {
      e.preventDefault();
      const cx = x + s / 2, cy = y + s / 2;
      s *= e.deltaY > 0 ? 1.08 : 1 / 1.08;
      fit();
      x = cx - s / 2;
      y = cy - s / 2;
      fit();
      lay();
      remakeSoon();
    }, { passive: false });
    new ResizeObserver(() => { size2(); lay(); }).observe(sheet.body);

    let soon = 0;
    function remakeSoon() {
      if (soon) return;
      soon = requestAnimationFrame(() => { soon = 0; remake(); });
    }
    /** The square, at the size the canvas will have, through the core. */
    async function remake() {
      const n = pixel ? Math.min(s, 64) : size;
      const out = /** @type {HTMLCanvasElement} */ (h('canvas', { width: n, height: n }));
      const g = /** @type {CanvasRenderingContext2D} */ (out.getContext('2d'));
      g.imageSmoothingEnabled = !pixel;
      g.imageSmoothingQuality = 'high';
      g.drawImage(src, x, y, s, s, 0, 0, n, n);
      const png = await new Promise((ok) => out.toBlob(ok, 'image/png'));
      if (!png) return;
      const v = crop.palette;
      try {
        made = app.core.importPicture(new Uint8Array(await png.arrayBuffer()), {
          keepScale: true, firstFrameOnly: true,
          ...(v.startsWith('fit:') ? { fit: Number(v.slice(4)) } : v === '' ? {} : { palette: Number(v) }),
        });
        status.classList.remove('bad');
        status.textContent = report(made, { fit: v.startsWith('fit:') ? 1 : undefined }, false);
      } catch (e) {
        // Exact colours that are too many: the nearest fitted palette instead.
        if (/** @type {any} */ (e)?.code === 'too_many_colors' && v === '') {
          crop.palette = 'fit:32';
          palette.value = 'fit:32';
          return remake();
        }
        caught(e, 'picture');
        made = null;
        status.classList.add('bad');
        status.textContent = explain(/** @type {any} */ (e));
      }
      toCanvas.disabled = !made;
      stopPlay();
      if (made) stopPlay = showCard(tile, made.card);
    }
    fit();
    requestAnimationFrame(() => { size2(); lay(); remake(); });
  }
}

/** A card's picture in a tile, playing if it moves. @param {HTMLElement} tile @param {any} card @returns {() => void} */
function showCard(tile, card) {
  const images = Array.from({ length: card.frames }, (_, i) => {
    const r = app.core.render(card, i);
    return new ImageData(new Uint8ClampedArray(r.rgba), r.width, r.height);
  });
  const cv = /** @type {HTMLCanvasElement} */ (h('canvas', { width: images[0].width, height: images[0].height }));
  const g = /** @type {CanvasRenderingContext2D} */ (cv.getContext('2d'));
  g.putImageData(images[0], 0, 0);
  replace(tile, cv);
  if (images.length < 2 || matchMedia('(prefers-reduced-motion: reduce)').matches) return () => {};
  let i = 0;
  const timer = window.setInterval(() => g.putImageData(images[(i = (i + 1) % images.length)], 0, 0), Math.max(card.delay_ms, 20));
  return () => clearInterval(timer);
}

/** Pixel art's own pixels, one source pixel a pixel. @param {any} card */
async function bitmapOf(card) {
  const r = app.core.render(card, 0);
  return createImageBitmap(new ImageData(new Uint8ClampedArray(r.rgba), r.width, r.height));
}

/** @param {string} value @param {(v: string) => void} onChange */
function paletteSelect(value, onChange) {
  const sel = /** @type {HTMLSelectElement} */ (h('select', { onchange: () => onChange(sel.value) },
    h('option', { value: '' }, t('import.opt.palette.auto')),
    h('option', { value: 'fit:32' }, t('import.opt.palette.fit', 32)),
    h('option', { value: 'fit:16' }, t('import.opt.palette.fit', 16)),
    ...palettes().map((/** @type {any} */ p) => h('option', { value: String(p.id) }, paletteLabel(p)))));
  sel.value = value;
  return sel;
}

/** What the conversion did, in a line. @param {any} r @param {{fit?: number}} opts @param {boolean} autoFit */
function report(r, opts, autoFit) {
  const c = r.card;
  const bits = [];
  bits.push(r.scale > 1 ? t('import.size.scaled', r.sourceWidth, r.sourceHeight, c.width, c.height, r.scale) : t('import.size', c.width, c.height));
  if (c.frames > 1) bits.push(t('import.frames', c.frames, c.delay_ms));
  if (c.palette.builtin != null) bits.push(t('import.palette.builtin', paletteName(c.palette.builtin)));
  else if (opts.fit != null && r.changedPixels) bits.push(t('import.palette.fitted', r.colors, c.palette.inline.length - (c.opaque ? 0 : 1)));
  else bits.push(t('import.palette.own', r.colors));
  if (r.changedPixels && opts.fit == null) bits.push(t('import.changed', r.changedPixels));
  const { cost } = issuable(c, app.core.shareSize(c));
  bits.push(cost.level === 'one' ? t('import.code.single', cost.bytes) : t('import.code.carousel', cost.bytes, cost.codes, cost.seconds));
  return (autoFit ? `${t('import.fitted-auto')} ` : '') + bits.join(' · ');
}

/** "Sweetie 16" with 16 colours reads "Sweetie · 16": the count once. @param {any} p */
function paletteLabel(p) {
  const n = p.colors.length;
  const name = p.name.endsWith(` ${n}`) ? p.name.slice(0, -String(n).length - 1) : p.name;
  return `${name} · ${n}`;
}

/** @type {any[]|null} */
let paletteCache = null;
const palettes = () => (paletteCache ??= app.core.palettes());
/** @param {number} id */
const builtinColors = (id) => palettes().find((/** @type {any} */ p) => p.id === id)?.colors;

/** @param {number} id */
function paletteName(id) {
  const p = palettes().find((/** @type {any} */ x) => x.id === id);
  return p ? paletteLabel(p).replace(/ · \d+$/, '') : `#${id}`;
}

/** A translated reason, with the numbers the core attached. @param {{code: string, args?: number[], message?: string}} e */
function explain(e) {
  return reason('import.err', e, ...(e?.args ?? []));
}

