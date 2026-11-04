// @ts-check
// A label that changes between a few known words without changing its
// width: all of them lie in the same place, only the current one is seen,
// so the widest sets the size and nothing beside it moves when it changes
// («По дате» / «По авторам», «вкл» / «выкл»). The hidden ones are hidden
// from screen readers too (visibility), so only the current one is read.

import { h } from '../dom.js';

/** @param {() => string[]} words asked again on each show: the language may have changed */
export function steadyLabel(words) {
  const el = h('span', { class: 'steady' });
  /** @param {number} current */
  function show(current) {
    const now = words();
    // Rebuilt only when the words change (another language), not on every paint.
    if (now.length !== el.children.length || now.some((w, i) => el.children[i].textContent !== w)) {
      el.replaceChildren(...now.map((w) => h('span', {}, w)));
    }
    [...el.children].forEach((c, k) => c.classList.toggle('on', k === current));
  }
  show(0);
  return { el, show };
}
