// @ts-check
// Choosing a ready palette. A tap tries it at once on the picture — every
// cell takes its nearest colour there — and "Apply" keeps it, "Cancel"
// takes it back. Trying several is one step in the undo history, not one
// per palette tried. A ready palette costs nothing in the code: the card
// carries only its number.

import { h } from '../dom.js';
import { t } from '../i18n.js';
import { hex } from './color.js';
import { bottomSheet } from '../kit/bottom-sheet.js';

/** A palette's colours as a striped bar, 32 in two rows. @param {number[]} cs */
function strip(cs) {
  const rows = cs.length > 16 ? [cs.slice(0, 16), cs.slice(16)] : [cs];
  return h('span', { class: 'ed-strip', 'aria-hidden': 'true' }, rows.map((r) => h('span', {}, r.map((c) => h('i', { style: { background: hex(c) } })))));
}

/**
 * @param {{
 *   palettes: () => {id: number, name: string, colors: number[]}[],
 *   model: ReturnType<typeof import('./model.js').createModel>,
 * }} o
 */
export function palettesSheet(o) {
  /** @type {any} */
  let start = null, tried = /** @type {any} */ (null);
  const sheet = bottomSheet({ label: t('ed.pal.title'), low: true, onClose: () => cancel() });
  const list = h('div', { class: 'ed-pal-list' });
  const note = h('p', { class: 'ed-note' }, t('ed.pal.note'));
  const apply = h('button', { type: 'button', class: 'btn key', onclick: () => { start = null; sheet.close(); } }, t('ed.apply'));
  const back = h('button', { type: 'button', class: 'btn', onclick: () => sheet.close() }, t('ask.cancel'));
  sheet.body.append(list);
  sheet.foot.append(note, h('div', { class: 'row-btns' }, back, apply));

  /** Tries a palette: the step tried before is taken back first. @param {{id: number|null, colors: number[]}} p */
  function tryOn(p) {
    if (tried && o.model.history.current === tried) o.model.undo();
    if (p.id === o.model.doc.builtin && p.colors.join() === o.model.doc.colors.join()) { tried = null; paint(); return; }
    o.model.setPalette(p.colors, p.id);
    tried = o.model.history.current;
    paint();
  }
  /** Leaves as it was when opened (the tries stay in the history's branches). */
  function cancel() {
    if (start && o.model.history.current !== start) o.model.goTo(start);
    start = tried = null;
  }

  function paint() {
    const doc = o.model.doc;
    const rows = [];
    if (doc.builtin == null) rows.push({ id: null, name: t('ed.pal.own'), note: t('ed.pal.count', doc.colors.length), colors: doc.colors, on: true, own: true });
    for (const p of o.palettes()) {
      rows.push({ id: p.id, name: p.name, note: t('ed.pal.count', p.colors.length), colors: p.colors, on: doc.builtin === p.id, own: false });
    }
    list.replaceChildren(...rows.map((r) => h('button', {
      type: 'button', class: 'ed-pal-row', 'aria-pressed': String(r.on),
      onclick: () => (r.own ? null : tryOn({ id: r.id, colors: r.colors })),
    }, h('span', { class: 'ed-pal-row-head' }, h('b', {}, r.name), h('small', {}, r.note)), strip(r.colors))));
  }

  return {
    els: sheet.els,
    show() {
      start = o.model.history.current;
      tried = null;
      paint();
      sheet.show();
    },
    close: () => sheet.close(),
    get open() { return sheet.open; },
  };
}
