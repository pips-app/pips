// @ts-check
// Animated cards play where they are looked at — the card in the middle of
// the feed, or open — one at a time. Everywhere else (the grid, the strip)
// a card shows its first frame, to spare the battery; so does every card
// for a person who asked their system for less motion.

import { app } from '../state.js';

/** @type {Map<string, ImageData[]>} the frames of cards that played, by digest */
const cache = new Map();
/** @type {{id: string, timer: number} | null} */
let playing = null;
const still = matchMedia('(prefers-reduced-motion: reduce)');

/** @param {string} id @param {any} card */
function framesOf(id, card) {
  let list = cache.get(id);
  if (!list) {
    list = Array.from({ length: card.frames }, (_, k) => {
      const r = app.core.render(card, k);
      return new ImageData(new Uint8ClampedArray(r.rgba), r.width, r.height);
    });
    cache.set(id, list);
  }
  return list;
}

/**
 * Every picture of this card on screen (the feed's, the open card's); a
 * playing one hides its "animated" mark. @param {string} id @param {ImageData} img @param {boolean} on
 */
function show(id, img, on) {
  for (const cv of document.querySelectorAll(`.art canvas[data-art="${CSS.escape(id)}"]`)) {
    /** @type {CanvasRenderingContext2D} */ (/** @type {HTMLCanvasElement} */ (cv).getContext('2d')).putImageData(img, 0, 0);
    cv.parentElement?.classList.toggle('playing', on);
  }
}

/**
 * Plays this card (a digest), and only it; null stops whatever plays. The
 * card stopped goes back to its first frame. @param {string|null} id
 */
export function playOnly(id) {
  if (id === (playing?.id ?? null)) return;
  if (playing) {
    clearInterval(playing.timer);
    const first = cache.get(playing.id)?.[0];
    if (first) show(playing.id, first, false);
    playing = null;
  }
  const card = id ? app.cards.get(id)?.card : null;
  if (!id || !card || card.frames < 2 || still.matches) return;
  const list = framesOf(id, card);
  let k = 0;
  playing = { id, timer: window.setInterval(() => show(id, list[(k = (k + 1) % list.length)], true), Math.max(card.delay_ms, 20)) };
}
