// @ts-check
// A colour of one's own: a square for saturation and brightness, a strip
// for the hue, the code in hex, and six steps from shadow to light around
// it — the way pixel artists build ramps.
//
// Changing a colour of the palette shows on the picture as it is dragged
// (every cell of it changes with it) and is one step in the undo history.
// A new colour is added only with "Add".

import { h } from '../dom.js';
import { t } from '../i18n.js';
import { hex, parseHex, toHsv, fromHsv, ramp } from './color.js';
import { bottomSheet } from '../kit/bottom-sheet.js';
import { clamp } from '../kit/motion.js';

/**
 * @param {{
 *   model: ReturnType<typeof import('./model.js').createModel>,
 *   chosen: (i: number) => void,
 * }} o chosen: a colour was added and should be the one drawn with
 */
export function colorSheet(o) {
  /** @type {number|null} the palette index being changed, or null for a new colour */
  let index = null;
  let hsv = { h: 0, s: 0, v: 0 };
  let was = 0;
  const sheet = bottomSheet({ label: t('ed.color.title') });

  const knob = h('span', { class: 'ed-knob' });
  const area = h('div', { class: 'ed-sv', 'aria-hidden': 'true' }, knob);
  const hueKnob = h('span', { class: 'ed-knob' });
  const hue = h('div', { class: 'ed-hue', 'aria-hidden': 'true' }, hueKnob);
  // The same three numbers as ranges, for keyboards and screen readers.
  const ranges = /** @type {HTMLInputElement[]} */ (['h', 's', 'v'].map((k) => h('input', {
    type: 'range', min: 0, max: k === 'h' ? 359 : 100, 'aria-label': t(`ed.color.${k}`),
    oninput: (/** @type {Event} */ e) => {
      const v = Number(/** @type {HTMLInputElement} */ (e.target).value);
      hsv = { ...hsv, [k]: k === 'h' ? v : v / 100 };
      changed();
    },
  })));
  const code = /** @type {HTMLInputElement} */ (h('input', { class: 'ed-hex', autocomplete: 'off', spellcheck: false, 'aria-label': 'HEX' }));
  const before = h('span', {}), after = h('span', {});
  const steps = h('div', { class: 'ed-ramp', role: 'group', 'aria-label': t('ed.color.ramp') });
  const addSteps = h('button', { type: 'button', class: 'text-btn', onclick: () => addRamp() }, t('ed.color.ramp-add'));
  const note = h('p', { class: 'ed-note' });
  const done = h('button', { type: 'button', class: 'btn key', onclick: () => finish() });
  const cancel = h('button', { type: 'button', class: 'btn', onclick: () => revert() }, t('ask.cancel'));
  sheet.body.append(
    h('div', { class: 'ed-color-head' }, h('div', { class: 'ed-was', title: t('ed.color.was') }, before, after),
      h('label', { class: 'field ed-hex-field' }, h('span', {}, 'HEX'), code)),
    area, hue, h('div', { class: 'ed-ranges' }, ranges),
    h('div', { class: 'ed-ramp-head' }, h('small', {}, t('ed.color.ramp')), addSteps), steps,
    note);
  sheet.foot.append(h('div', { class: 'row-btns' }, cancel, done));

  const color = () => fromHsv(hsv.h, hsv.s, hsv.v);

  /** Shows the colour; for a palette colour, the picture takes it too. */
  function changed() {
    const c = color();
    if (index != null) o.model.setColor(index, c);
    paint();
  }

  function paint() {
    const c = color();
    area.style.setProperty('--hue', hex(fromHsv(hsv.h, 1, 1)));
    knob.style.left = `${hsv.s * 100}%`;
    knob.style.top = `${(1 - hsv.v) * 100}%`;
    knob.style.background = hex(c);
    hueKnob.style.left = `${(hsv.h / 360) * 100}%`;
    hueKnob.style.background = hex(fromHsv(hsv.h, 1, 1));
    ranges[0].value = String(Math.round(hsv.h));
    ranges[1].value = String(Math.round(hsv.s * 100));
    ranges[2].value = String(Math.round(hsv.v * 100));
    if (document.activeElement !== code) code.value = hex(c).slice(1).toUpperCase();
    before.style.background = hex(was);
    after.style.background = hex(c);
    steps.replaceChildren(...ramp(c).map((x, k) => h('button', {
      type: 'button', class: 'ed-swatch', style: { background: hex(x) }, 'aria-pressed': String(k === 3),
      'aria-label': t('ed.color.step', k + 1, hex(x)), onclick: () => { hsv = toHsv(x); changed(); },
    })));
  }

  /** Follows a finger over the square or the strip. @param {HTMLElement} target @param {(fx: number, fy: number) => void} set */
  function drag(target, set) {
    target.addEventListener('pointerdown', (e) => {
      target.setPointerCapture(e.pointerId);
      const at = (/** @type {PointerEvent} */ ev) => {
        const r = target.getBoundingClientRect();
        set(clamp((ev.clientX - r.left) / r.width, 0, 1), clamp((ev.clientY - r.top) / r.height, 0, 1));
        changed();
      };
      at(e);
      const move = (/** @type {PointerEvent} */ ev) => at(ev);
      const up = () => { target.removeEventListener('pointermove', move); target.removeEventListener('pointerup', up); };
      target.addEventListener('pointermove', move);
      target.addEventListener('pointerup', up);
    });
  }
  drag(area, (x, y) => { hsv = { ...hsv, s: x, v: 1 - y }; });
  drag(hue, (x) => { hsv = { ...hsv, h: Math.min(359.9, x * 360) }; });
  code.addEventListener('input', () => {
    const c = parseHex(code.value);
    if (c != null) { hsv = toHsv(c); changed(); }
  });

  function finish() {
    if (index == null) {
      const i = o.model.addColor(color());
      if (i >= 0) o.chosen(i);
    }
    index = null;
    sheet.close();
  }
  /** Cancel: a changed palette colour goes back. */
  function revert() {
    if (index != null && o.model.doc.colors[index] !== was) o.model.setColor(index, was);
    index = null;
    sheet.close();
  }
  /** The other five steps of the ramp, as new colours (as many as fit). */
  function addRamp() {
    const r = ramp(color()).filter((_, k) => k !== 3);
    o.model.addColors(r);
    note.textContent = t('ed.color.ramp-added');
  }

  return {
    els: sheet.els,
    /** @param {number|null} i a palette colour to change, or null for a new one @param {number} start */
    show(i, start) {
      index = i;
      was = start;
      hsv = toHsv(start);
      sheet.retitle(t(i == null ? 'ed.color.new' : 'ed.color.title'));
      done.textContent = t(i == null ? 'ed.color.add' : 'ed.done');
      cancel.hidden = i == null;
      note.textContent = t(o.model.doc.builtin != null ? 'ed.color.note-builtin' : 'ed.color.note');
      paint();
      sheet.show();
    },
    close: () => sheet.close(),
    get open() { return sheet.open; },
  };
}
