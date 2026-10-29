// @ts-check
// A page over the whole app, with a title and a close button: things that
// take the screen for a while (a code to be scanned, a journal to read).
// It goes with the button, Escape or `close()`. Its body scrolls; its
// foot (buttons), if any, stays.

import { h, icon } from '../dom.js';
import { holdFocus } from './focus.js';
import { t } from '../i18n.js';

/** @param {string} title @param {() => void} [onClose] */
export function fullSheet(title, onClose) {
  const body = h('div', { class: 'scroll sheet-body' });
  const foot = h('div', { class: 'sheet-foot' });
  const close = () => {
    release();
    overlay.remove();
    onClose?.();
  };
  const overlay = h('section', { class: 'overlay', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h('div', { class: 'bar' },
      h('button', { class: 'icon-btn', 'aria-label': t('sheet.close'), onclick: close }, icon('close')),
      h('div', { class: 'title' }, h('h1', {}, title))),
    body, foot);
  document.body.append(overlay);
  const release = holdFocus(overlay, { escape: () => close() });
  return { body, foot, close };
}
