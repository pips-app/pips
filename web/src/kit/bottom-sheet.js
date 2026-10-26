// @ts-check
// A sheet that rises from the bottom over a dimmed screen: choices that
// belong to the screen beneath (a palette, a colour, settings). It goes
// away with a swipe down on its handle, a tap on the dimmed screen, Escape,
// or `close()`. Its body scrolls; its foot (the buttons) stays.
// `low`: at most about half the screen, so what it changes stays in sight.

import { h } from '../dom.js';

/** @param {{label: string, low?: boolean, onClose?: () => void}} o */
export function bottomSheet(o) {
  const title = h('h2', {}, o.label);
  const body = h('div', { class: 'bottom-sheet-body' });
  const foot = h('div', { class: 'bottom-sheet-foot' });
  const grab = h('div', { class: 'grab', 'aria-hidden': 'true' });
  const el = h('section', { class: `bottom-sheet${o.low ? ' low' : ''}`, role: 'dialog', 'aria-label': o.label, 'aria-hidden': 'true', inert: true }, grab, title, body, foot);
  const scrim = h('div', { class: 'scrim', onclick: () => close() });
  let open = false;

  function show() {
    if (open) return;
    open = true;
    el.setAttribute('aria-hidden', 'false');
    el.inert = false;
    el.classList.add('on');
    scrim.classList.add('on', 'anim');
    scrim.style.opacity = o.low ? '0.15' : '0.45'; // a low sheet leaves what it changes in view
    document.addEventListener('keydown', onKey, true);
  }
  function close() {
    if (!open) return;
    open = false;
    el.setAttribute('aria-hidden', 'true');
    el.inert = true;
    el.classList.remove('on');
    el.style.transform = '';
    scrim.classList.remove('on');
    scrim.style.opacity = '0';
    document.removeEventListener('keydown', onKey, true);
    o.onClose?.();
  }
  const onKey = (/** @type {KeyboardEvent} */ e) => {
    if (e.key !== 'Escape') return;
    e.stopPropagation(); // the screen beneath must not take it as its own
    close();
  };
  // The handle follows a finger down; far enough, and the sheet goes.
  let y0 = /** @type {number|null} */ (null);
  grab.addEventListener('pointerdown', (e) => { y0 = e.clientY; grab.setPointerCapture(e.pointerId); el.classList.add('held'); });
  grab.addEventListener('pointermove', (e) => { if (y0 != null) el.style.transform = `translateY(${Math.max(0, e.clientY - y0)}px)`; });
  grab.addEventListener('pointerup', (e) => {
    el.classList.remove('held');
    if (y0 != null && e.clientY - y0 > 60) close();
    else el.style.transform = '';
    y0 = null;
  });

  return {
    /** Both parts, to be placed in the page: the dim layer, then the sheet. */
    els: [scrim, el],
    body, foot, show, close,
    get open() { return open; },
    /** @param {string} text */
    retitle(text) { title.textContent = text; el.setAttribute('aria-label', text); },
  };
}
