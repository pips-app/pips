// @ts-check
// A label that changes between a few known words without changing its
// width: all of them lie in the same place, only the current one is seen,
// so the widest sets the size and nothing beside it moves when it changes
// («По дате» / «По авторам», «вкл» / «выкл»). The hidden ones are hidden
// from screen readers too (visibility), so only the current one is read.

import { h } from '../dom.js';

/** @param {string[]} texts */
export function steadyLabel(texts) {
  const el = h('span', { class: 'steady' });
  let current = 0;
  /** @param {string[]} words */
  const set = (words) => {
    // Rebuilt only when the words change (another language), not on every paint.
    if (words.length === el.children.length && words.every((w, i) => el.children[i].textContent === w)) return;
    el.replaceChildren(...words.map((w, i) => h('span', { class: i === current ? 'on' : null }, w)));
  };
  set(texts);
  return {
    el,
    /** Shows the `i`-th, with the words as they are now. @param {number} i @param {string[]} [words] */
    show(i, words) {
      if (words) set(words);
      current = i;
      [...el.children].forEach((c, k) => c.classList.toggle('on', k === i));
    },
  };
}
