// @ts-check
// Where the app lands once there is a key and a name. For now the
// profile's key: who the person is, how their key is kept, and checking
// their written words — checked, never shown (docs/REWRITE.md, О1). The
// real screens come at stage 5.

import { h, replace } from '../dom.js';
import { icon } from '../icons.js';
import { t } from '../i18n.js';
import { say } from '../errors.js';
import { identicon } from './identicon.js';
import { wordsEntry } from './words-entry.js';

/** @typedef {ReturnType<typeof import('../state.js').createState>} State */

/**
 * @param {object} o
 * @param {HTMLElement} o.root
 * @param {{ call(op: string, ...args: unknown[]): Promise<any> }} o.core
 * @param {State} o.app
 */
export function home({ root, core, app }) {
  const k = app.key;
  if (k.state === 'none') return;
  const hidden = k.state === 'hidden';
  const page = h('main', { class: 'home' },
    h('h1', {}, t('home.title')),
    h('div', { class: 'idcard' }, identicon(k.key.hex), h('div', {}, h('b', {}, app.profile.nick), h('small', {}, t('key.short', k.key.short)))),
    h('section', { class: 'group', 'aria-labelledby': 'home-key' }, h('h2', { id: 'home-key' }, t('home.key')),
      h('div', { class: hidden ? 'note' : 'note box warn' }, icon(hidden ? 'lock' : 'open'), h('p', {}, t(hidden ? 'home.key.hidden' : 'home.key.open'))),
      h('div', { class: 'row-btns' }, h('button', { type: 'button', class: 'btn', onclick: () => verify() }, t('home.verify')))));
  replace(root, page);

  /** Checking the written words against the key, in a sheet over the page. */
  async function verify() {
    const opener = /** @type {HTMLElement | null} */ (document.activeElement);
    const verdict = h('p', { class: 'home-verdict', role: 'status' });
    /** The words to check, once all 24 name a word. @type {string[] | null} */
    let words = null;
    const entry = wordsEntry(await core.call('recoveryWords'), (s) => {
      words = s.words;
      verdict.classList.remove('wrong');
      verdict.textContent = s.bad >= 0 ? t('onb.restore.unknown', s.bad + 1) : '';
      if (s.bad >= 0) verdict.classList.add('wrong');
      if (words) void judge(words);
    });
    /** @param {string[]} w */
    async function judge(w) {
      try {
        const ok = await core.call('keyVerify', w.join(' '));
        if (words !== w) return; // typed on meanwhile
        verdict.classList.toggle('wrong', !ok);
        replace(verdict, ok ? [icon('check'), ' ', t('home.verify.ok', k.state === 'none' ? '' : k.key.short)] : t('home.verify.no'));
      } catch (e) {
        verdict.classList.add('wrong');
        verdict.textContent = /** @type {any} */ (e)?.code === 'bad_words' ? t('onb.restore.sum') : say(e);
      }
    }
    const close = () => { sheet.remove(); document.removeEventListener('keydown', onKey); opener?.focus(); };
    /** Escape closes the sheet, as its button does. @param {KeyboardEvent} e */
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    const sheet = h('div', { class: 'home-sheet' },
      h('div', { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'home-verify' },
        h('h2', { id: 'home-verify' }, t('home.verify')), h('p', {}, t('home.verify.lead')),
        entry.el, verdict,
        h('button', { type: 'button', class: 'btn key wide', onclick: close }, t('home.verify.done'))));
    document.addEventListener('keydown', onKey);
    document.body.append(sheet);
    entry.focus();
  }
}
