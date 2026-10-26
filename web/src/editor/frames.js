// @ts-check
// The frames of the picture as a strip: the first tile plays them (and
// shows the card as small as in the collection), then a thumbnail of each
// frame, "+" for a copy of the open one, and the onion skin switch. A tap on
// the open frame shows what can be done with it.

import { h, icon, reveal } from '../dom.js';
import { t } from '../i18n.js';
import { T } from './model.js';
import { rgb } from './color.js';

/** Paints a frame into a small canvas. @param {HTMLCanvasElement} cv @param {import('./model.js').Doc} doc @param {number} f */
export function thumb(cv, doc, f) {
  if (cv.width !== doc.size) { cv.width = doc.size; cv.height = doc.size; }
  const g = /** @type {CanvasRenderingContext2D} */ (cv.getContext('2d'));
  const img = g.createImageData(doc.size, doc.size), buf = doc.frames[f];
  for (let i = 0; i < buf.length; i++) {
    if (buf[i] === T) continue;
    const [r, gg, b] = rgb(doc.colors[buf[i]] ?? 0);
    img.data.set([r, gg, b, 255], i * 4);
  }
  g.putImageData(img, 0, 0);
}

/**
 * @param {{select: (f: number) => void, add: () => void, play: () => void, menu: (f: number) => void, onion: () => void}} o
 */
export function framesStrip(o) {
  const preview = /** @type {HTMLCanvasElement} */ (h('canvas', { class: 'ed-preview-art' }));
  const badge = h('span', { class: 'ed-play-badge' });
  const play = h('button', { type: 'button', class: 'ed-play', onclick: o.play }, preview, badge);
  const list = h('div', { class: 'ed-frame-list' });
  const add = h('button', { type: 'button', class: 'ed-frame add', 'aria-label': t('ed.frame.add'), title: t('ed.frame.add'), onclick: o.add }, icon('plus'));
  const onion = h('button', { type: 'button', class: 'ed-onion-btn', onclick: o.onion });
  const scroller = h('div', { class: 'ed-frame-scroll' }, list, add, onion);
  const el = h('section', { class: 'ed-frames', 'aria-label': t('ed.frames') }, play, scroller);
  /** @type {HTMLCanvasElement[]} */
  let thumbs = [];
  let open = 0;

  return {
    el,
    /**
     * @param {import('./model.js').Doc} doc @param {number} f the open frame
     * @param {{playing: boolean, shown: number, onion: boolean, delay: number}} s shown: the frame the preview shows
     */
    set(doc, f, s) {
      open = f;
      if (thumbs.length !== doc.frames.length) {
        thumbs = doc.frames.map((_, k) => /** @type {HTMLCanvasElement} */ (h('canvas', {})));
        list.replaceChildren(...thumbs.map((cv, k) => h('button', {
          type: 'button', class: 'ed-frame', onclick: () => (k === open ? o.menu(k) : o.select(k)),
        }, cv)));
      }
      thumbs.forEach((cv, k) => {
        thumb(cv, doc, k);
        const b = /** @type {HTMLElement} */ (cv.parentElement);
        b.setAttribute('aria-pressed', String(k === f));
        b.setAttribute('aria-label', t(k === f ? 'ed.frame.open' : 'ed.frame.n', k + 1, doc.frames.length));
      });
      thumb(preview, doc, s.shown);
      badge.replaceChildren(icon(s.playing ? 'pause' : 'play'));
      play.setAttribute('aria-label', t(s.playing ? 'ed.stop' : 'ed.play'));
      play.title = t(s.playing ? 'ed.stop' : 'ed.play');
      play.classList.toggle('still', doc.frames.length < 2);
      add.hidden = doc.frames.length >= 64;
      onion.replaceChildren(h('b', {}, t('ed.onion')), h('span', {}, s.onion ? t('ed.on') : t('ed.off')));
      onion.setAttribute('aria-pressed', String(s.onion));
      onion.hidden = doc.frames.length < 2;
      reveal(scroller, list.children[f]);
    },
    /** Just the preview, while playing. @param {import('./model.js').Doc} doc @param {number} f */
    show(doc, f) { thumb(preview, doc, f); },
  };
}
