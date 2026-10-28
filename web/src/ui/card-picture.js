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
const QR = 380; // the code's square, quiet zone included: 3+ px a module
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
  if (plan.kind === 'single') drawQr(g, plan.text, W - PAD - QR, H - PAD - QR, QR, codeColours(shade));

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

/**
 * The code in the paper's own colours, on a small rounded ground of its
 * own — a label on the card, alike on every paper. On light paper the
 * ground is the paper lightened and the modules are the ink softened
 * toward the paper's grey; on dark paper — where a code light on dark
 * would not scan everywhere — the ground is the ink's light colour and the
 * modules the paper's. Always dark on light, never below a contrast every
 * reader takes (checked in the tests, after JPEG).
 * @param {{paper: string, ink: string, dim: string}} shade
 * @returns {{ground: string, modules: string}}
 */
export function codeColours(shade) {
  const paper = rgb(shade.paper), ink = rgb(shade.ink), dim = rgb(shade.dim);
  if (luma(paper) > luma(ink)) {
    const ground = mix(paper, [255, 255, 255], 0.6);
    // As far toward the grey as the contrast allows.
    let best = ink;
    for (let k = 0.05; k <= 0.6; k += 0.05) {
      const c = mix(ink, dim, k);
      if (contrast(ground, c) < MIN_CONTRAST) break;
      best = c;
    }
    return { ground: hex(ground), modules: hex(best) };
  }
  return { ground: hex(mix(ink, paper, 0.06)), modules: shade.paper };
}
const MIN_CONTRAST = 7; // with 3+ px a module: read at full size and at 3/4, after JPEG (tests)

/** A code with whole pixels to each module. @param {CanvasRenderingContext2D} g @param {string} text @param {number} x @param {number} y @param {number} side @param {{ground: string, modules: string}} c */
function drawQr(g, text, x, y, side, c) {
  const m = app.core.qrMatrix(text);
  const n = m.size + 2 * QUIET, px = Math.floor(side / n), s = n * px;
  const ox = x + side - s, oy = y + side - s; // flush with the corner
  g.fillStyle = c.ground;
  g.beginPath();
  g.roundRect(ox, oy, s, s, 14);
  g.fill();
  g.fillStyle = c.modules;
  for (let r = 0; r < m.size; r++) {
    for (let k = 0; k < m.size; k++) if (m.modules[r * m.size + k]) g.fillRect(ox + (k + QUIET) * px, oy + (r + QUIET) * px, px, px);
  }
}

/** @param {string} h '#rrggbb' */
const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
/** @param {number[]} c */
const hex = (c) => `#${c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
/** @param {number[]} a @param {number[]} b @param {number} k */
const mix = (a, b, k) => a.map((v, i) => v + (b[i] - v) * k);
/** Relative luminance (WCAG). @param {number[]} c */
const luma = (c) => {
  const [r, g, b] = c.map((v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
/** @param {number[]} a @param {number[]} b */
const contrast = (a, b) => { const [x, y] = [luma(a), luma(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

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
