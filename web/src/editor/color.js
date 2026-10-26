// @ts-check
// Colours as the editor keeps them: one number, 0xRRGGBB. Conversions,
// the nearest colour of a palette, and ramps from shadow to light.
// Plain arithmetic: runs under node for tests.

/** @param {number} n */
export const hex = (n) => `#${n.toString(16).padStart(6, '0')}`;

/** "#e0645a", "e0645a" or "e64" to a colour, or null. @param {string} s */
export function parseHex(s) {
  let v = s.trim().replace(/^#/, '').toLowerCase();
  if (/^[0-9a-f]{3}$/.test(v)) v = v.replace(/./g, (c) => c + c);
  return /^[0-9a-f]{6}$/.test(v) ? parseInt(v, 16) : null;
}

/** @param {number} n @returns {[number, number, number]} */
export const rgb = (n) => [(n >> 16) & 255, (n >> 8) & 255, n & 255];
/** @param {number} r @param {number} g @param {number} b */
export const fromRgb = (r, g, b) => (clamp8(r) << 16) | (clamp8(g) << 8) | clamp8(b);
/** @param {number} v */
const clamp8 = (v) => Math.max(0, Math.min(255, Math.round(v)));

/** Hue in degrees, saturation and value 0…1. @param {number} n */
export function toHsv(n) {
  const [r, g, b] = rgb(n).map((x) => x / 255);
  const max = Math.max(r, g, b), d = max - Math.min(r, g, b);
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
  }
  return { h: (h * 60 + 360) % 360, s: max ? d / max : 0, v: max };
}

/** @param {number} h degrees @param {number} s 0…1 @param {number} v 0…1 */
export function fromHsv(h, s, v) {
  h = ((h % 360) + 360) % 360;
  s = Math.max(0, Math.min(1, s));
  v = Math.max(0, Math.min(1, v));
  const c = v * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = v - c;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return fromRgb((r + m) * 255, (g + m) * 255, (b + m) * 255);
}

/** How different two colours look: weighted RGB ("redmean"), cheap and
 * close enough for picking the nearest of at most 32. @param {number} a @param {number} b */
export function distance(a, b) {
  const [r1, g1, b1] = rgb(a), [r2, g2, b2] = rgb(b);
  const rm = (r1 + r2) / 2, dr = r1 - r2, dg = g1 - g2, db = b1 - b2;
  return (2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db;
}

/** The index of the colour in `colors` closest to `c`. @param {number} c @param {number[]} colors */
export function nearest(c, colors) {
  let best = 0, bd = Infinity;
  colors.forEach((x, i) => {
    const d = distance(c, x);
    if (d < bd) { bd = d; best = i; }
  });
  return best;
}

/** Turns hue `h` towards `to` by at most `by` degrees. @param {number} h @param {number} to @param {number} by */
const towards = (h, to, by) => {
  const d = ((to - h + 540) % 360) - 180;
  return h + Math.sign(d) * Math.min(Math.abs(d), by);
};

/**
 * Six steps from shadow to light around `c`, which is the fourth: shadows
 * turn cooler and towards violet, lights warmer and towards yellow, the
 * way pixel artists build ramps rather than only darkening.
 * @param {number} c @returns {number[]}
 */
export function ramp(c) {
  const { h, s, v } = toHsv(c);
  const out = [];
  for (let k = -3; k <= 2; k++) {
    if (k === 0) { out.push(c); continue; }
    const j = Math.abs(k);
    out.push(k < 0
      ? fromHsv(towards(h, 255, 12 * j), Math.min(1, s + 0.06 * j), v * (1 - 0.24 * j))
      : fromHsv(towards(h, 55, 14 * j), s * (1 - 0.28 * j), v + (1 - v) * 0.55 * j));
  }
  return out;
}
