// @ts-check
// A segmented switch: a few options, exactly one chosen.

import { h } from '../dom.js';

/**
 * @template {string} V
 * @param {{options: {value: V, label: string, title?: string}[], value: V, label: string, onChange: (v: V) => void}} o
 * title: a fuller name of an option whose label is short (a symbol, a number)
 */
export function segmented(o) {
  let value = o.value;
  const buttons = o.options.map((opt) => h('button', {
    type: 'button', dataset: { value: opt.value }, title: opt.title, 'aria-label': opt.title,
    onclick: () => { if (opt.value !== value) { set(opt.value); o.onChange(opt.value); } },
  }, opt.label));
  const el = h('div', { class: 'seg', role: 'group', 'aria-label': o.label }, buttons);
  /** @param {V} v */
  function set(v) {
    value = v;
    for (const b of buttons) b.setAttribute('aria-pressed', String(b.dataset.value === v));
  }
  set(value);
  return { el, set, get value() { return value; } };
}
