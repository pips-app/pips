// @ts-check
// A drawn picture as card data for the core. Each frame is its visible
// layers pressed into one, and is there as many times as it lasts (a card
// has one delay for all its frames; a frame shown for three ticks is three
// frames alike, which deflate makes nearly free). The palette is kept as a
// built-in one when it still is one (it then costs only its number), or cut
// down to the colours actually used. An empty cell is index 0 of a card that
// is not opaque, so a built-in palette whose first colour is drawn with
// cannot also have empty cells: those cards carry their colours inline.
// No DOM: runs under node for tests.

import { T, composite } from './model.js';
import { rgb } from './color.js';
import { finished } from '../text.js';

/**
 * @param {import('./model.js').Doc} doc
 * @param {{nick: string, handle: any, link: string}} by the author
 * @returns {{card: any} | {problem: 'too_many_colors'}}
 */
export function toCard(doc, by) {
  // The card's frames, in order, as they show.
  // A still picture is one frame, however long it was once said to last.
  const shown = doc.frames.length === 1 ? [composite(doc, 0)] : doc.frames.flatMap((_, k) => {
    const c = composite(doc, k);
    return Array.from({ length: doc.holds[k] }, () => c);
  });
  const used = new Set();
  let empty = false;
  for (const f of shown) {
    for (const v of f) {
      if (v === T) empty = true;
      else used.add(v);
    }
  }
  const map = new Uint8Array(256);
  /** @type {any} */
  let palette;
  if (doc.builtin != null && !(empty && used.has(0))) {
    palette = { builtin: doc.builtin };
    for (let i = 0; i < 256; i++) map[i] = i;
    map[T] = 0;
  } else {
    const list = [...used].sort((a, b) => a - b);
    const colors = list.map((i) => rgb(doc.colors[i]));
    if (empty) colors.unshift(colors[0] ?? [0, 0, 0]); // index 0: empty, its colour unseen
    while (colors.length < 2) colors.push(colors[0] ?? [0, 0, 0]);
    if (colors.length > 32) return { problem: 'too_many_colors' };
    list.forEach((v, k) => { map[v] = k + (empty ? 1 : 0); });
    map[T] = 0;
    palette = { inline: colors };
  }
  const n = doc.size * doc.size, pixels = new Uint8Array(n * shown.length);
  shown.forEach((f, k) => { for (let i = 0; i < n; i++) pixels[k * n + i] = map[f[i]]; });
  const animated = shown.length > 1;
  return {
    card: {
      width: doc.size, height: doc.size, opaque: !empty, palette, frame: doc.shade,
      frames: shown.length, delay_ms: animated ? doc.delay : 0,
      title: finished(doc.title), author: by.nick, handle: by.handle ?? null, link: by.link ?? '', pixels,
    },
  };
}
