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
// The code's square, quiet zone included: below the drawing, never on it
// (that ends at PAD + ART = 1020; the code starts at H − PAD − QR = 1040),
// and 3+ px a module for the largest single code (version 19: 101 with its quiet zone).
const QR = 340;
const QUIET = 4;
const GAP = 32; // between the name and the code
/** Where things are on the picture: what the tests check it against. */
export const LAYOUT = Object.freeze({ width: W, height: H, pad: PAD, art: ART, code: QR, gap: GAP });

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
  const textRight = plan.kind === 'single' ? W - PAD - QR - GAP : W - PAD;
  if (plan.kind === 'single') drawQr(g, plan.text, W - PAD - QR, H - PAD - QR, QR, codeColours(shade));

  // The name and the artist, as on the card.
  g.textBaseline = 'top';
  // The title and the name whole: a long one in smaller letters, not cut.
  // Only below the smallest size — never, within the format's limits — is
  // the rest cut with an ellipsis.
  const room = textRight - PAD;
  g.fillStyle = shade.ink;
  const size = fitted(g, (px) => `600 ${px}px Literata, Georgia, serif`, 64, 30, () => wrap(g, cardTitle(card), room, Infinity).length <= 2);
  const lines = wrap(g, cardTitle(card), room, 2);
  const step = Math.round(size * 1.16); // the line height: 74 at 64 px
  lines.forEach((l, i) => g.fillText(l, PAD, top + i * step));
  g.fillStyle = shade.dim;
  const by = card.author ? `@${card.author}` : '—';
  fitted(g, (px) => `500 ${px}px "IBM Plex Sans", system-ui, sans-serif`, 32, 18, () => g.measureText(by).width <= room);
  g.fillText(fit(g, by, room), PAD, top + lines.length * step + 12);
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

/**
 * The text in at most `max` lines of `width`, a cut one ending with an
 * ellipsis. Lines break between words; a word wider than a line — a title
 * in Japanese, which has no spaces, or one long name — between its
 * characters. @param {CanvasRenderingContext2D} g @param {string} text @param {number} width @param {number} max
 */
export function wrap(g, text, width, max) {
  /** @type {string[]} */
  const lines = [];
  let line = '';
  for (const w of text.split(/\s+/)) {
    const next = line ? `${line} ${w}` : w;
    if (g.measureText(next).width <= width) {
      line = next;
      continue;
    }
    if (line) lines.push(line);
    line = '';
    for (const ch of shown(w)) {
      if (line && g.measureText(line + ch).width > width) {
        lines.push(line);
        line = ch;
      } else line += ch;
    }
  }
  if (line) lines.push(line);
  // The last line shown says that more was cut.
  if (lines.length > max) {
    lines.length = max;
    lines[max - 1] = cut(g, lines[max - 1], width);
  }
  return lines.map((l) => fit(g, l, width));
}

/** What a person sees as single characters: an emoji or a flag is one. @param {string} s */
const shown = (s) => Array.from(new Intl.Segmenter().segment(s), (x) => x.segment);

/**
 * Sets the largest font from `max` down to `min` px, 2 at a time, with which
 * `fits` holds — else `min` — and returns its size.
 * @param {CanvasRenderingContext2D} g @param {(px: number) => string} font
 * @param {number} max @param {number} min @param {() => boolean} fits
 */
function fitted(g, font, max, min, fits) {
  for (let px = max; px > min; px -= 2) {
    g.font = font(px);
    if (fits()) return px;
  }
  g.font = font(min);
  return min;
}

/** The text as it is if it fits `width`, or cut with an ellipsis. @param {CanvasRenderingContext2D} g @param {string} text @param {number} width */
const fit = (g, text, width) => (g.measureText(text).width <= width ? text : cut(g, text, width));

/**
 * The text cut, a whole visible character at a time — never half an emoji
 * or a flag — until it fits `width` with an ellipsis after it.
 * @param {CanvasRenderingContext2D} g @param {string} text @param {number} width
 */
function cut(g, text, width) {
  const chars = shown(text);
  while (chars.length && g.measureText(`${chars.join('')}…`).width > width) chars.pop();
  return `${chars.join('')}…`;
}
