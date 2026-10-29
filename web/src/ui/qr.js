// @ts-check
// Showing bytes as QR codes: one code, or a carousel that cycles.

import { h } from '../dom.js';
import { app } from '../state.js';

const QUIET = 4;
const FRAME_MS = 220;

/**
 * Draws text as a QR symbol with whole pixels of the screen per module —
 * not CSS pixels: a phone has two or three of those to each, so the step
 * is fine, and a code of any size nearly fills its square.
 * @param {HTMLCanvasElement} cv @param {string} text @param {number} maxPx
 */
function draw(cv, text, maxPx) {
  const m = app.core.qrMatrix(text);
  const side = m.size + QUIET * 2, dpr = devicePixelRatio || 1;
  const scale = Math.max(1, Math.floor((maxPx * dpr) / side)); // device pixels a module
  cv.width = side;
  cv.height = side;
  cv.style.width = cv.style.height = `${(side * scale) / dpr}px`;
  const g = /** @type {CanvasRenderingContext2D} */ (cv.getContext('2d'));
  const img = g.createImageData(side, side);
  img.data.fill(255);
  for (let y = 0; y < m.size; y++) {
    for (let x = 0; x < m.size; x++) {
      if (!m.modules[y * m.size + x]) continue;
      const o = ((y + QUIET) * side + x + QUIET) * 4;
      img.data[o] = img.data[o + 1] = img.data[o + 2] = 0x17;
    }
  }
  g.putImageData(img, 0, 0);
}

/**
 * The side of a code on screen: as large as is comfortable for another
 * phone's camera, while the rest of the sheet still fits around it.
 */
export const codeSize = () => Math.max(200, Math.min(340, innerWidth - 96, innerHeight * 0.44));

/**
 * A QR display for `bytes`; returns the element, how it is shown, and a stop
 * function for carousels.
 * @param {Uint8Array} bytes @param {number} maxPx
 */
export function qrFor(bytes, maxPx) {
  const cv = /** @type {HTMLCanvasElement} */ (h('canvas', { 'aria-label': 'QR' }));
  const plan = app.core.qrPlan(bytes);
  let timer = 0;
  if (plan.kind === 'single') {
    draw(cv, plan.text, maxPx);
  } else {
    const carousel = new app.core.Carousel(bytes);
    let seq = 0;
    const next = () => draw(cv, carousel.frameText(seq++), maxPx);
    next();
    timer = window.setInterval(next, FRAME_MS);
  }
  return { el: box(cv, maxPx), plan, stop: () => clearInterval(timer) };
}

/**
 * The white square a code lies on: always `side` across, whatever the code.
 * Each module takes whole pixels of the screen, so a code may come out a
 * hair smaller than the square; the square itself does not, and nothing around it moves when
 * one code gives way to another. @param {HTMLCanvasElement} cv @param {number} side
 */
function box(cv, side) {
  const el = h('div', { class: 'qr-box' }, cv);
  el.style.width = el.style.height = `${side}px`;
  return el;
}

/** A QR display for text that is already in the QR alphabet (a paper key,
 * a recipient code). @param {string} text @param {number} maxPx */
export function qrText(text, maxPx) {
  const cv = /** @type {HTMLCanvasElement} */ (h('canvas', { 'aria-label': 'QR' }));
  draw(cv, text, maxPx);
  return box(cv, maxPx);
}

/**
 * Keeps the screen on while a code is shown, where the browser allows it.
 * The browser lets go of the lock whenever the page is hidden; coming back
 * to the code takes it again. Returns the function that lets go for good —
 * callable at once, even before the lock was granted.
 * @returns {Promise<() => void>}
 */
export async function keepAwake() {
  const wl = /** @type {any} */ (navigator).wakeLock;
  if (!wl) return () => {};
  /** @type {any} */
  let lock = null;
  let done = false;
  const take = async () => {
    try {
      const l = await wl.request('screen');
      if (done) l.release(); else lock = l;
    } catch { /* refused (battery saver, hidden page): the screen may dim */ }
  };
  const again = () => { if (document.visibilityState === 'visible' && !done && (!lock || lock.released)) take(); };
  document.addEventListener('visibilitychange', again);
  await take();
  return () => {
    done = true;
    document.removeEventListener('visibilitychange', again);
    lock?.release();
    lock = null;
  };
}
