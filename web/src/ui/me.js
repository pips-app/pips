// @ts-check
// Me: identity, what goes on the back of your cards, secrets, settings.

import { h, replace, byteLimit } from '../dom.js';
import { t, reason, language, date } from '../i18n.js';
import { app, setProfile, makeBackup, restoreBackup, lastBackup } from '../state.js';
import { isPersisted, setMeta, memoryOnly } from '../store.js';
import { toast, ask } from './shell.js';
import { qrText } from './qr.js';
import { identicon } from '../kit/identicon.js';
import { BLANK_CARD } from './card.js';
import { onboarding } from './onboarding.js';
import { caught } from '../diagnostics.js';
import { journalGroup } from './journal-view.js';
import { developerGroup } from './developer.js';

const NETWORKS = ['telegram', 'instagram', 'x', 'bluesky', 'mastodon', 'vk', 'tiktok', 'other'];

export function meView() {
  const body = h('div');
  const el = h('section', { class: 'view' },
    h('div', { class: 'bar' }, h('div', { class: 'title' }, h('h1', {}, t('me.title')))),
    h('div', { class: 'scroll' }, body));

  async function render() {
    const key = app.identity.publicKey();
    const p = app.profile;
    const nick = byteLimit(/** @type {HTMLInputElement} */ (h('input', { value: p.nick, autocomplete: 'nickname' })), 24);
    const network = /** @type {HTMLSelectElement} */ (h('select', {}, NETWORKS.map((n) => h('option', { value: n, selected: p.handle?.network === n }, n))));
    const handle = byteLimit(/** @type {HTMLInputElement} */ (h('input', { value: p.handle?.text ?? '', autocomplete: 'off' })), 48);
    const link = byteLimit(/** @type {HTMLInputElement} */ (h('input', { value: p.link, placeholder: 'kitsu.art', autocomplete: 'off', inputMode: 'url' })), 64);
    const error = h('div', { class: 'error' });
    const secret = h('div', { class: 'secret' });
    const lang = /** @type {HTMLSelectElement} */ (h('select', {
      onchange: async () => {
        await setMeta('language', lang.value);
        // In memory-only mode a reload would lose everything: apply on next start.
        if (memoryOnly) toast(t('me.language.later'));
        else location.reload();
      },
    }, h('option', { value: 'ru', selected: language() === 'ru' }, 'Русский'), h('option', { value: 'en', selected: language() === 'en' }, 'English')));
    const persisted = await isPersisted();

    const save = async () => {
      const next = {
        nick: nick.value.trim(),
        handle: handle.value.trim() ? { network: network.value, text: handle.value.trim() } : null,
        link: normalLink(link.value),
      };
      // The core is the judge of what a card may carry.
      try {
        app.core.shareSize({ ...BLANK_CARD, author: next.nick, handle: next.handle, link: next.link });
      } catch (e) {
        error.textContent = /** @type {any} */ (e).message ?? t('err.generic');
        return;
      }
      error.textContent = '';
      await setProfile(next);
      toast(t('me.saved'));
    };

    // Each button shows its secret and, pressed again, hides it; only one
    // is open at a time, and leaving the tab hides both.
    /** @type {'words'|'paper'|null} */
    let shown = null;
    const wordsBtn = h('button', { class: 'btn', onclick: () => reveal('words') });
    const paperBtn = h('button', { class: 'btn', onclick: () => reveal('paper') });
    const labels = () => {
      wordsBtn.replaceChildren(t(shown === 'words' ? 'me.words.hide' : 'me.words'));
      paperBtn.replaceChildren(t(shown === 'paper' ? 'me.paper.hide' : 'me.paper'));
    };
    labels();
    const reveal = async (/** @type {'words'|'paper'} */ what) => {
      if (shown === what) {
        shown = null;
        secret.replaceChildren();
        return labels();
      }
      if (!(await ask(t('me.secret.confirm'), { yes: t('ask.show') }))) return;
      shown = what;
      if (what === 'words') {
        replace(secret, h('div', { class: 'word-grid' }, app.identity.words().split(' ').map((/** @type {string} */ w) => h('span', {}, w))));
      } else {
        // The QR is what gets printed; the text stays folded away unless asked for.
        const paper = app.identity.paper();
        replace(secret, qrText(paper, 240),
          h('details', { class: 'paper-text' }, h('summary', {}, t('me.paper.text')), h('code', {}, paper)));
      }
      labels();
    };

    replace(body,
      h('div', { class: 'idcard' }, identicon(key.hex), h('div', {}, h('b', {}, p.nick || '—'), h('small', {}, `${t('me.key')} ${key.short}`))),
      h('div', { class: 'group' }, h('h2', {}, t('me.card-back')),
        h('div', { class: 'field' }, h('label', {}, t('me.nick')), nick),
        h('div', { class: 'field' }, h('label', {}, t('me.network')), network),
        h('div', { class: 'field' }, h('label', {}, t('me.handle')), handle),
        h('div', { class: 'field' }, h('label', {}, t('me.link')), h('span', { class: 'prefix', 'aria-hidden': 'true' }, 'https://'), link),
        h('p', { class: 'hint' }, t('me.link.hint')), error,
        h('button', { class: 'btn key wide', onclick: save }, t('me.save'))),
      h('div', { class: 'group' }, h('h2', {}, t('me.key')),
        h('div', { class: 'row-btns' }, wordsBtn, paperBtn),
        secret,
        h('button', { class: 'btn wide', style: { marginTop: '8px' }, onclick: () => switchKey(null) }, t('me.switch'))),
      await backupGroup(switchKey),
      h('div', { class: 'group' }, h('h2', {}, t('me.language')), h('div', { class: 'field' }, lang)),
      h('div', { class: 'group' }, h('h2', {}, t('me.storage')),
        h('p', { class: 'hint' }, t(memoryOnly ? 'me.storage.memory' : persisted ? 'me.storage.persisted' : 'me.storage.not-persisted'))),
      journalGroup(),
      await developerGroup());
  }

  /**
   * Another key in place of this one, through the same restore as on a new
   * phone. Own cards stay, but become a former key's: say so first.
   * @param {{bytes: Uint8Array, name: string}|null} file a backup already chosen
   */
  async function switchKey(file) {
    const own = [...app.cards.values()].filter((e) => e.rec.mine).length;
    if (own && !(await ask(t('me.switch.confirm', own), { yes: t('me.switch.go'), danger: true }))) return;
    const before = app.identity.publicKey().hex;
    onboarding(document.body, () => {
      render();
      toast(app.identity.publicKey().hex === before ? t('me.switch.same') : t('me.switch.done'));
    }, { switching: { file, cancel: () => {} } });
  }

  return { el, show: render };
}

/** Backup: save, restore, and how stale the last copy is. The group redraws
 * itself after each action, so its status is never out of date. */
/** @param {(file: {bytes: Uint8Array, name: string}) => void} switchKey for another key's backup */
async function backupGroup(switchKey) {
  const box = h('div', { class: 'group' });
  const input = /** @type {HTMLInputElement} */ (h('input', { type: 'file', accept: '.pipsbak,application/octet-stream', hidden: true }));
  input.addEventListener('change', async () => {
    const f = input.files?.[0];
    input.value = '';
    if (!f) return;
    const bytes = new Uint8Array(await f.arrayBuffer());
    try {
      const r = await restoreBackup(bytes);
      toast(t('backup.restored', r.added, r.known));
    } catch (e) {
      caught(e, 'backup');
      // Another key's backup opens only with that key: offer to switch to it.
      const other = /** @type {any} */ (e)?.code === 'other_owner';
      toast(backupError(/** @type {any} */ (e)), other ? { label: t('backup.switch'), run: () => switchKey({ bytes, name: f.name }) } : undefined);
    }
    await draw();
  });

  const save = async () => {
    try {
      const { bytes } = await makeBackup();
      const day = new Date().toISOString().slice(0, 10);
      const a = /** @type {HTMLAnchorElement} */ (h('a', { href: URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'application/octet-stream' })), download: `pips-${day}.pipsbak` }));
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
      toast(t('backup.saved'));
    } catch (e) {
      caught(e, 'backup');
      toast(backupError(/** @type {any} */ (e)));
    }
    await draw();
  };

  async function draw() {
    const last = await lastBackup();
    const p = app.pending;
    const changes = p.cards.length + (p.profile ? 1 : 0);
    // Copy numbers handed out since are what a stale backup would repeat
    // after a restore: those make it urgent at once; anything else, in time.
    const stale = last ? p.issued > 0 || changes >= 10 : app.cards.size > 0;
    const status = !last
      ? t('backup.never')
      : `${t('backup.last', date(last.at, { day: 'numeric', month: 'long', year: 'numeric' }), last.count)}${changes ? ` · ${t('backup.since', changes)}` : ''}`;
    box.replaceChildren(h('h2', {}, t('backup.title')),
      h('p', { class: `hint lead${stale ? ' warn-text' : ''}` }, status),
      last && p.issued ? h('p', { class: 'hint lead warn-text' }, t('backup.issued', p.issued)) : '',
      h('div', { class: 'row-btns' },
        h('button', { class: `btn${stale ? ' key' : ''}`, onclick: save }, t('backup.save')),
        h('button', { class: 'btn', onclick: () => input.click() }, t('backup.restore'))),
      h('p', { class: 'hint' }, t('backup.hint')), input);
  }

  await draw();
  return box;
}

/** @param {{code?: string, message?: string}} e */
const backupError = (e) => reason('backup.err', e, e?.message);


/** Without the scheme, and with the host in lower case, as the format wants;
 * the path keeps its case. @param {string} s */
function normalLink(s) {
  const v = s.trim().replace(/^https?:\/\//i, '');
  const i = v.search(/[/?#]/);
  return i < 0 ? v.toLowerCase() : v.slice(0, i).toLowerCase() + v.slice(i);
}

