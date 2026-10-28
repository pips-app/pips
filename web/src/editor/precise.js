// @ts-check
// The precise mode: for a pixel smaller than a fingertip. A finger moving
// anywhere on the pad moves a cursor over the canvas — slower than the
// finger, so it lands exactly — and the big button does what the chosen
// tool does where the cursor is: a pixel (held while the finger moves, a
// line), a fill, a shape or a selection dragged from press to release, a
// colour picked. Beside it, the same for empty cells, and the pipette.

import { h, icon } from '../dom.js';
import { t } from '../i18n.js';

const PX_PER_CELL = 22; // finger travel for one cell

/**
 * @param {{
 *   move: (dx: number, dy: number) => void,
 *   press: (erase: boolean) => void, release: () => void, pick: () => void,
 * }} o move: in cells, fractions included
 */
export function precisePad(o) {
  const hint = h('p', {}, t('ed.precise.hint'));
  /** A button that acts while held. @param {string} cls @param {any} ic @param {string} label @param {boolean} erase */
  const hold = (cls, ic, label, erase) => {
    const b = h('button', { type: 'button', class: cls, 'aria-label': label, title: label }, ic ? icon(ic) : label);
    b.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      try { b.setPointerCapture(e.pointerId); } catch { /* synthetic pointers */ }
      o.press(erase);
    });
    for (const ev of ['pointerup', 'pointercancel']) b.addEventListener(ev, () => o.release());
    // From a keyboard: a press is a dot.
    b.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); o.press(erase); o.release(); } });
    return b;
  };
  const put = hold('ed-put', null, t('ed.precise.put'), false);
  const erase = hold('ed-round', 'eraser', t('ed.precise.erase'), true);
  const pick = h('button', { type: 'button', class: 'ed-round', 'aria-label': t('ed.tool.pick'), title: t('ed.tool.pick'), onclick: o.pick }, icon('pick'));
  // The hint's place: the selection's actions take it over (view.js).
  const top = h('div', { class: 'ed-place' }, hint);
  const el = h('div', { class: 'ed-pad', 'aria-label': t('ed.precise') }, top, h('div', { class: 'ed-pad-btns' }, pick, erase, put));

  // Any finger on the pad (not on its buttons) moves the cursor.
  /** @type {Map<number, {x: number, y: number}>} */
  const fingers = new Map();
  el.addEventListener('pointerdown', (e) => {
    if (/** @type {Element} */ (e.target).closest('button')) return;
    try { el.setPointerCapture(e.pointerId); } catch { /* synthetic pointers */ }
    fingers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  });
  el.addEventListener('pointermove', (e) => {
    const p = fingers.get(e.pointerId);
    if (!p) return;
    o.move((e.clientX - p.x) / PX_PER_CELL, (e.clientY - p.y) / PX_PER_CELL);
    p.x = e.clientX;
    p.y = e.clientY;
  });
  for (const ev of ['pointerup', 'pointercancel']) el.addEventListener(ev, (e) => fingers.delete(/** @type {PointerEvent} */ (e).pointerId));

  return {
    el, top,
    /**
     * What the big button will do, in a word, and the colour it puts (none
     * for a tool that puts no colour). @param {string} label @param {string|null} css
     */
    mode(label, css) {
      if (put.textContent !== label) put.textContent = label;
      put.setAttribute('aria-label', label);
      if (css) put.style.setProperty('--put', css);
      else put.style.removeProperty('--put');
      put.classList.toggle('plain', !css);
    },
  };
}
