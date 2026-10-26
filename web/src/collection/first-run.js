// @ts-check
// An empty collection starts with the person's own calling card (the
// pattern of their key), and two ways to begin: draw or scan.

import { h } from '../dom.js';
import { t } from '../i18n.js';
import { app } from '../state.js';
import { showRecipientCode } from '../ui/edition.js';
import { identicon } from '../kit/identicon.js';

/** @param {{draw: () => void, scan: () => void}} o */
export function firstRun(o) {
  const mark = h('div', { class: 'me-art' });
  const name = h('b');
  const info = h('small');
  const card = h('button', { type: 'button', class: 'me-card', onclick: () => showRecipientCode() }, mark, name, info);
  const el = h('div', { class: 'first-run', hidden: true }, card,
    h('h2', {}, t('first.title')), h('p', {}, t('first.text')),
    h('div', { class: 'row-btns' },
      h('button', { type: 'button', class: 'btn', onclick: () => o.draw() }, t('first.draw')),
      h('button', { type: 'button', class: 'btn key', onclick: () => o.scan() }, t('first.scan'))));
  let painted = '';
  return {
    el,
    /** Draws the card for the current key and nick (once per change). */
    paint() {
      const key = app.identity.publicKey();
      if (painted === key.hex + app.profile.nick) return;
      painted = key.hex + app.profile.nick;
      mark.replaceChildren(identicon(key.hex));
      name.textContent = app.profile.nick || '—';
      info.textContent = `${t('first.card')} · ${key.short}`;
    },
  };
}
