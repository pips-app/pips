// @ts-check
// A sheet over the page: a dialog with its own heading, the page under it
// out of reach (inert: no focus, no taps) while it is open. Escape closes
// the top sheet only, as its own button does, and focus goes back to what
// opened it. What its buttons mean is the caller's.

import { h } from '../dom.js';

/** Sheets open now, the top one last: Escape belongs to it. @type {(() => void)[]} */
const open = [];

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && open.length) {
    e.preventDefault();
    open[open.length - 1]();
  }
});

/**
 * Opens a sheet with `title` over everything else.
 * @param {{ title: string, onClose?: () => void }} o onClose: told once, however it closed
 * @param {...any} body
 * @returns {{ el: HTMLElement, close: () => void }}
 */
export function sheet({ title, onClose = () => {} }, ...body) {
  const opener = /** @type {HTMLElement | null} */ (document.activeElement);
  const id = `sheet-${open.length + 1}`;
  const dialog = h('div', { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': id }, h('h2', { id }, title), ...body);
  const el = h('div', { class: 'sheet' }, dialog);
  // What is under the sheet now: everything on the page but it.
  const under = [...document.body.children].filter((c) => c instanceof HTMLElement && !c.inert);
  let closed = false;
  function close() {
    if (closed) return;
    closed = true;
    open.splice(open.indexOf(close), 1);
    el.remove();
    for (const u of under) /** @type {HTMLElement} */ (u).inert = false;
    opener?.focus();
    onClose();
  }
  for (const u of under) /** @type {HTMLElement} */ (u).inert = true;
  open.push(close);
  document.body.append(el);
  return { el: dialog, close };
}
