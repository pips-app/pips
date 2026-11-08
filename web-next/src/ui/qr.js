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
