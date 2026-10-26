// @ts-check
// The picture's settings: its size, the frame's colour, how long a frame
// is shown, and what the canvas shows (grid, which way the mirror works).
// On a phone they live in a sheet behind "More"; on a computer, beside
// the canvas. The same element either way.

import { h } from '../dom.js';
import { t } from '../i18n.js';
import { FRAME_SHADES } from '../ui/card.js';
import { segmented } from '../kit/segmented.js';
import { SIZES } from './model.js';

const DELAYS = [80, 120, 160, 250, 400];

/**
 * @param {{
 *   size: (n: number) => void, shade: (i: number) => void, delay: (ms: number) => void,
 *   grid: (on: boolean) => void, axes: (a: {x: boolean, y: boolean}) => void, fresh: () => void,
 * }} o
 */
export function settingsPanel(o) {
  const size = segmented({
    label: t('ed.set.size'), value: '32', options: SIZES.map((n) => ({ value: String(n), label: String(n) })),
    onChange: (v) => o.size(Number(v)),
  });
  const shades = h('div', { class: 'shades', role: 'radiogroup', 'aria-label': t('ed.set.shade') });
  const delay = segmented({
    label: t('ed.set.delay'), value: '160', options: DELAYS.map((n) => ({ value: String(n), label: String(n) })),
    onChange: (v) => o.delay(Number(v)),
  });
  const delayRow = h('div', { class: 'ed-set-row' }, h('h3', {}, t('ed.set.delay')), delay.el);
  const axes = segmented({
    label: t('ed.set.axes'), value: 'x',
    options: [{ value: 'x', label: '⇆', title: t('ed.set.axes.x') }, { value: 'y', label: '⇅', title: t('ed.set.axes.y') }, { value: 'xy', label: '⇆ ⇅', title: t('ed.set.axes.xy') }],
    onChange: (v) => o.axes({ x: v.includes('x'), y: v.includes('y') }),
  });
  const grid = /** @type {HTMLInputElement} */ (h('input', { type: 'checkbox', checked: true, onchange: () => o.grid(grid.checked) }));
  const el = h('div', { class: 'ed-settings' },
    h('div', { class: 'ed-set-row' }, h('h3', {}, t('ed.set.size')), size.el),
    h('div', { class: 'ed-set-row' }, h('h3', {}, t('ed.set.shade')), shades),
    delayRow,
    h('div', { class: 'ed-set-row' }, h('h3', {}, t('ed.set.axes')), axes.el),
    h('label', { class: 'check' }, grid, h('span', {}, t('ed.set.grid'))),
    h('button', { type: 'button', class: 'btn', onclick: o.fresh }, t('ed.set.new')));

  return {
    el,
    /** @param {import('./model.js').Doc} doc */
    set(doc) {
      size.set(String(doc.size));
      // A delay set elsewhere (an imported card) may be none of the presets.
      delay.set(String(DELAYS.includes(doc.delay) ? doc.delay : ''));
      delayRow.hidden = doc.frames.length < 2;
      shades.replaceChildren(...FRAME_SHADES.map((s, i) => h('button', {
        type: 'button', class: 'shade', role: 'radio', 'aria-checked': String(i === doc.shade), 'aria-label': t('ed.set.shade.n', i + 1),
        style: { background: s.paper }, onclick: () => o.shade(i),
      })));
    },
    /** @param {{x: boolean, y: boolean}} a */
    setAxes(a) { axes.set(a.x && a.y ? 'xy' : a.y ? 'y' : 'x'); },
  };
}

