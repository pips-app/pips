// @ts-check
// A QR symbol on a canvas, from the core's matrix: one canvas pixel a
// module, scaled up by CSS with sharp edges, so it stays crisp at any size.

import { h } from '../dom.js';

/** The light margin a reader needs around the symbol, in modules (ISO/IEC 18004). */
const QUIET = 4;

/** @param {{ size: number, modules: Uint8Array }} m the core's qrMatrix @param {string} label what the code holds, for a screen reader */
export function qrCanvas(m, label) {
  const side = m.size + QUIET * 2;
  const cv = /** @type {HTMLCanvasElement} */ (h('canvas', { width: side, height: side, role: 'img', 'aria-label': label }));
  const g = /** @type {CanvasRenderingContext2D} */ (cv.getContext('2d'));
  const img = g.createImageData(side, side);
  img.data.fill(255);
  for (let y = 0; y < m.size; y++) {
    for (let x = 0; x < m.size; x++) {
      if (!m.modules[y * m.size + x]) continue;
      const o = ((y + QUIET) * side + x + QUIET) * 4;
      img.data[o] = img.data[o + 1] = img.data[o + 2] = 0;
    }
  }
  g.putImageData(img, 0, 0);
  return cv;
}

/** How long each code of a carousel stays: a camera reads several in that time. From web/src/ui/qr.js. */
const FRAME_MS = 220;

/**
 * Bytes shown as codes: one, or a carousel that cycles until stopped.
 * The white square keeps its size whatever the code, so nothing around it
 * moves when one code gives way to another.
 * @param {{ call(op: string, ...args: unknown[]): Promise<any> }} core
 * @param {Uint8Array} bytes @param {string} label
 * @returns {Promise<{ el: HTMLElement, plan: { kind: 'single', text: string } | { kind: 'carousel', fragments: number }, stop: () => void }>}
 */
export async function codeShow(core, bytes, label) {
  const plan = await core.call('qrPlan', bytes);
  const box = h('div', { class: 'qr-box' });
  /** @param {string} text */
  const draw = async (text) => { box.replaceChildren(qrCanvas(await core.call('qrMatrix', text), label)); };
  if (plan.kind === 'single') {
    await draw(plan.text);
    return { el: box, plan, stop: () => {} };
  }
  let seq = 0;
  let stopped = false;
  // A frame still being drawn when the next is due: that one is skipped, not queued behind it.
  let busy = false;
  await draw(await core.call('carouselFrame', bytes, seq++));
  const timer = window.setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      const text = await core.call('carouselFrame', bytes, seq++);
      if (!stopped) await draw(text);
    } catch { /* the core restarting: the next frame is drawn by the next tick */ }
    busy = false;
  }, FRAME_MS);
  return { el: box, plan, stop: () => { stopped = true; clearInterval(timer); } };
}

/**
 * Keeps the screen on while a code is shown, where the browser allows it.
 * The browser lets go of the lock whenever the page is hidden; coming back
 * to the code takes it again. Returns the function that lets go for good —
 * callable at once, even before the lock was granted. From web/src/ui/qr.js.
 * @returns {() => void}
 */
export function keepAwake() {
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
  const again = () => { if (document.visibilityState === 'visible' && !done && (!lock || lock.released)) void take(); };
  document.addEventListener('visibilitychange', again);
  void take();
  return () => {
    done = true;
    document.removeEventListener('visibilitychange', again);
    lock?.release();
    lock = null;
  };
}
