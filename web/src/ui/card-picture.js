// @ts-check
// A card as one picture to post or send: the card on its paper — the
// drawing, its name, its artist — and, when the card fits one code, that
// code beside the name. The same envelope also goes inside the PNG
// (png-card.js). So the picture opens in Pips as the card itself: from the
// file as it was sent, or, after a messenger has re-encoded it or someone
// took a screenshot, by scanning the code on it ("From picture").

import { app } from '../state.js';
import { FRAME_SHADES, cardTitle } from './card.js';
import { withEnvelope } from '../png-card.js';
import { t } from '../i18n.js';

const W = 1080, H = 1440, PAD = 60;
const ART = W - 2 * PAD; // the drawing's square
const QR = 320; // the code's square, quiet zone included
const QUIET = 4;

/**
 * @param {any} card @param {Uint8Array} envelope what a code of this card carries
 * @returns {Promise<Blob>} a PNG
 */
export async function cardPicture(card, envelope) {
  await Promise.all(['600 64px Literata', '500 32px "IBM Plex Sans"', '400 26px "IBM Plex Sans"'].map((f) => document.fonts.load(f).catch(() => {})));
  const shade = FRAME_SHADES[card.frame] ?? FRAME_SHADES[0];
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const g = /** @type {CanvasRenderingContext2D} */ (cv.getContext('2d'));
  g.fillStyle = shade.paper;
  g.fillRect(0, 0, W, H);

  // The drawing, a whole number of picture pixels to each of its cells.
  const r = app.core.render(card, 0);
  const cell = Math.floor(ART / Math.max(r.width, r.height));
  const aw = r.width * cell, ah = r.height * cell;
  const src = document.createElement('canvas');
  src.width = r.width;
  src.height = r.height;
  /** @type {CanvasRenderingContext2D} */ (src.getContext('2d')).putImageData(new ImageData(new Uint8ClampedArray(r.rgba), r.width, r.height), 0, 0);
  g.imageSmoothingEnabled = false;
  g.drawImage(src, PAD + (ART - aw) / 2, PAD + (ART - ah) / 2, aw, ah);

  // The code, bottom right, when one code holds the card.
  const plan = app.core.qrPlan(envelope);
  const top = PAD + ART + 44;
  const textRight = plan.kind === 'single' ? W - PAD - QR - 32 : W - PAD;
  if (plan.kind === 'single') drawQr(g, plan.text, W - PAD - QR, H - PAD - QR, QR);

  // The name and the artist, as on the card.
  g.textBaseline = 'top';
  g.fillStyle = shade.ink;
  g.font = '600 64px Literata, Georgia, serif';
  const lines = wrap(g, cardTitle(card), textRight - PAD, 2);
  lines.forEach((l, i) => g.fillText(l, PAD, top + i * 74));
  g.fillStyle = shade.dim;
  g.font = '500 32px "IBM Plex Sans", system-ui, sans-serif';
  g.fillText(card.author ? `@${card.author}` : '—', PAD, top + lines.length * 74 + 12);
  g.font = '400 26px "IBM Plex Sans", system-ui, sans-serif';
  g.fillText(t(plan.kind === 'single' ? 'picture.scan' : 'picture.file'), PAD, H - PAD - 26);

  const png = await new Promise((ok, fail) => cv.toBlob((b) => (b ? ok(b) : fail(new Error('the picture could not be made'))), 'image/png'));
  return new Blob([withEnvelope(new Uint8Array(await /** @type {Blob} */ (png).arrayBuffer()), envelope)], { type: 'image/png' });
}

/** A code with whole pixels to each module, dark on white. @param {CanvasRenderingContext2D} g @param {string} text @param {number} x @param {number} y @param {number} side */
function drawQr(g, text, x, y, side) {
  const m = app.core.qrMatrix(text);
  const n = m.size + 2 * QUIET, px = Math.floor(side / n), s = n * px;
  const ox = x + side - s, oy = y + side - s; // flush with the corner
  g.fillStyle = '#ffffff';
  g.fillRect(ox, oy, s, s);
  g.fillStyle = '#17151f';
  for (let r = 0; r < m.size; r++) {
    for (let c = 0; c < m.size; c++) if (m.modules[r * m.size + c]) g.fillRect(ox + (c + QUIET) * px, oy + (r + QUIET) * px, px, px);
  }
}

/** The text in at most `max` lines of `width`, the last cut with an ellipsis. @param {CanvasRenderingContext2D} g @param {string} text @param {number} width @param {number} max */
function wrap(g, text, width, max) {
  const words = text.split(/\s+/), lines = [];
  let line = '';
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (g.measureText(next).width <= width || !line) line = next;
    else { lines.push(line); line = w; }
  }
  if (line) lines.push(line);
  if (lines.length > max) {
    lines.length = max;
    let last = lines[max - 1];
    while (last && g.measureText(`${last}…`).width > width) last = last.slice(0, -1);
    lines[max - 1] = `${last}…`;
  }
  // A single word longer than the room is cut too.
  return lines.map((l) => {
    if (g.measureText(l).width <= width) return l;
    let s = l;
    while (s && g.measureText(`${s}…`).width > width) s = s.slice(0, -1);
    return `${s}…`;
  });
}
