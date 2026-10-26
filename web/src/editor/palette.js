// @ts-check
// The colours under the canvas: sixteen at a time in two rows of eight,
// big enough for a finger; a second page holds the rest of 32. The chosen
// one is ringed inside its swatch. A tap picks a colour; a tap on the
// chosen one (or a long press) changes it. Above, the palette's name opens
// the palettes, and "+" adds a colour (always in sight, on any page).

import { h, icon } from '../dom.js';
import { t } from '../i18n.js';
import { hex } from './color.js';
import { MAX_COLORS } from './model.js';

const PAGE = 16;
const HOLD_MS = 450;

/**
 * @param {{
 *   pick: (i: number) => void, edit: (i: number) => void, add: () => void,
 *   open: () => void, name: (doc: import('./model.js').Doc) => string,
 * }} o
 */
export function paletteGrid(o) {
  let page = 0, chosen = 0;
  /** @type {import('./model.js').Doc|null} */
  let doc = null;
  const nameBtn = h('button', { type: 'button', class: 'ed-pal-name', onclick: o.open });
  const pages = [0, 1].map((p) => h('button', {
    type: 'button', class: 'ed-pal-page', 'aria-label': t('ed.pal.page', p * PAGE + 1, p * PAGE + PAGE),
    onclick: () => { page = p; paint(); },
  }, String(p + 1)));
  const add = h('button', { type: 'button', class: 'ed-pal-add', 'aria-label': t('ed.pal.add'), title: t('ed.pal.add'), onclick: o.add }, icon('plus'));
  const grid = h('div', { class: 'ed-pal-grid', role: 'group', 'aria-label': t('ed.pal.colors') });
  const el = h('div', { class: 'ed-palette' }, h('div', { class: 'ed-pal-head' }, nameBtn, h('div', { class: 'ed-pal-pages' }, pages, add)), grid);

  /** A swatch: tap picks, tap again or hold edits. @param {number} i */
  function swatch(i) {
    let held = 0, fired = false;
    const b = h('button', {
      type: 'button', class: 'ed-swatch', style: { background: hex(/** @type {any} */ (doc).colors[i]) },
      'aria-label': t('ed.pal.color', i + 1, hex(/** @type {any} */ (doc).colors[i])), 'aria-pressed': String(i === chosen),
      onclick: () => {
        if (fired) return;
        if (i === chosen) o.edit(i); else o.pick(i);
      },
    });
    b.addEventListener('pointerdown', () => {
      fired = false;
      held = window.setTimeout(() => { fired = true; o.edit(i); }, HOLD_MS);
    });
    for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) b.addEventListener(ev, () => clearTimeout(held));
    return b;
  }

  function paint() {
    if (!doc) return;
    const n = doc.colors.length, pageCount = Math.ceil(n / PAGE);
    page = Math.min(page, pageCount - 1);
    pages.forEach((p, k) => { p.hidden = pageCount < 2; p.setAttribute('aria-pressed', String(k === page)); });
    const cells = [];
    for (let i = page * PAGE; i < page * PAGE + PAGE; i++) {
      cells.push(i < n ? swatch(i) : h('span', { class: 'ed-swatch free' }));
    }
    grid.replaceChildren(...cells);
    add.hidden = n >= MAX_COLORS;
    nameBtn.replaceChildren(icon('palette'), h('span', {}, o.name(doc)), icon('next'));
    nameBtn.setAttribute('aria-label', `${t('ed.pal.open')}: ${o.name(doc)}`);
  }

  return {
    el,
    /** @param {import('./model.js').Doc} d @param {number} i the chosen colour */
    set(d, i) {
      doc = d;
      if (i !== chosen) page = Math.floor(i / PAGE); // the chosen colour is always in sight
      chosen = i;
      paint();
    },
  };
}
