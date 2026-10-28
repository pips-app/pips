// @ts-check
// Card data back into a picture the editor can work on — the other way
// round from to-card.js: an imported file, or one's own card to start a new
// one from. The picture is square, one of the editor's sizes: a smaller
// card sits in the middle of the nearest larger canvas, on empty cells.
// A card that is not square, or larger than the editor's largest canvas,
// is no picture for it: null, and the caller crops first.
// No DOM: runs under node for tests.

import { T, SIZES, DELAY } from './model.js';

/** @param {number[]} c [r, g, b] */
const packed = (c) => (c[0] << 16) | (c[1] << 8) | c[2];

/**
 * @param {any} card width, height, opaque, palette ({builtin} | {inline}), frames, delay_ms, pixels, title, frame
 * @param {(id: number) => number[][] | undefined} builtin a built-in palette's colours, by id
 * @returns {import('./model.js').Doc | null}
 */
export function fromCard(card, builtin) {
  const w = card.width, h = card.height;
  const size = SIZES.find((n) => n >= Math.max(w, h));
  if (!size) return null;
  const inline = card.palette.inline;
  const list = inline ?? builtin(card.palette.builtin);
  if (!list) return null;
  // An empty cell is index 0 of a card that is not opaque. With its own
  // colours, that slot is no colour of the picture: the rest move down one.
  const skip = !card.opaque && inline ? 1 : 0;
  const colors = list.slice(skip).map(packed);
  const ox = (size - w) >> 1, oy = (size - h) >> 1, n = w * h;
  const frames = Array.from({ length: card.frames }, (_, k) => {
    const f = new Uint8Array(size * size).fill(T);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const v = card.pixels[k * n + y * w + x];
        f[(y + oy) * size + x + ox] = !card.opaque && v === 0 ? T : v - skip;
      }
    }
    return f;
  });
  return {
    size, frames, colors, builtin: inline ? null : card.palette.builtin,
    title: card.title ?? '', shade: card.frame ?? 0,
    delay: card.frames > 1 ? Math.min(DELAY.max, Math.max(DELAY.min, card.delay_ms)) : DELAY.start,
  };
}
