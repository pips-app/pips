// @ts-check
// Where the app lands once there is a key and a name. For now the
// profile's key and backup: who the person is, how their key is kept,
// checking their written words (never shown, docs/REWRITE.md О1), saving
// and adding a backup, switching to another key. The real screens come at
// stage 5.

import { h, replace } from '../dom.js';
import { icon } from '../icons.js';
import { t } from '../i18n.js';
import { say } from '../errors.js';
import { identicon } from './identicon.js';
import { wordsEntry } from './words-entry.js';
import { onboarding } from './onboarding.js';
import { sheet } from './sheet.js';

/** The largest backup the core opens (pips-store's MAX_FILE): a larger file is refused before it is read. */
const BACKUP_MAX = 64 * 1024 * 1024;

/** @typedef {ReturnType<typeof import('../state.js').createState>} State */

/**
 * @param {object} o
 * @param {HTMLElement} o.root
 * @param {{ call(op: string, ...args: unknown[]): Promise<any> }} o.core
 * @param {State} o.app
 * @param {string} [o.said] what to say on arriving (a key just switched; what went wrong after)
 */
export function home({ root, core, app, said = '' }) {
  const k = app.key;
  if (k.state === 'none') return;
  const hidden = k.state === 'hidden';
  const status = h('p', { class: 'home-status', role: 'status' }, said);
  /** Says what came of an action; a wrong outcome in the warning colour. @param {string} text @param {boolean} [wrong] @param {any} [action] */
  const tell = (text, wrong = false, action = null) => {
    status.classList.toggle('wrong', wrong);
    replace(status, text, action ? [' ', action] : '');
  };
  const backupLine = h('p', { class: 'home-backup-line' });
  const fileInput = /** @type {HTMLInputElement} */ (h('input', { type: 'file', accept: '.pipsbak', hidden: true, onchange: () => add() }));

  const page = h('main', { class: 'home' },
    h('h1', {}, t('home.title')),
    h('div', { class: 'idcard' }, identicon(k.key.hex), h('div', {}, h('b', {}, app.profile.nick), h('small', {}, t('key.short', k.key.short)))),
    status,
    h('section', { class: 'group', 'aria-labelledby': 'home-key' }, h('h2', { id: 'home-key' }, t('home.key')),
      h('div', { class: hidden ? 'note' : 'note box warn' }, icon(hidden ? 'lock' : 'open'), h('p', {}, t(hidden ? 'home.key.hidden' : 'home.key.open'))),
      h('div', { class: 'row-btns home-btns' },
        h('button', { type: 'button', class: 'btn', onclick: () => verify() }, t('home.verify')),
        h('button', { type: 'button', class: 'btn', onclick: () => switchKey() }, t('home.switch')))),
    cardList(app),
    h('section', { class: 'group', 'aria-labelledby': 'home-backup' }, h('h2', { id: 'home-backup' }, t('home.backup')),
      backupLine,
      h('div', { class: 'row-btns home-btns' },
        h('button', { type: 'button', class: 'btn', onclick: () => save() }, t('home.backup.save')),
        h('button', { type: 'button', class: 'btn', onclick: () => fileInput.click() }, t('home.backup.add'))),
      fileInput,
      h('p', { class: 'hint' }, t('home.backup.hint'))));
  replace(root, page);
  void paintBackup();
  // Another tab switched the key: this page is of the old one, and goes.
  const stop = app.subscribe(() => {
    if (!page.isConnected) return stop();
    const now = app.key;
    if (now.state !== 'none' && now.key.hex !== k.key.hex) {
      stop();
      home({ root, core, app, said: t('home.switch.elsewhere') });
    }
  });

  /** When the last backup was made, and what changed since. */
  async function paintBackup() {
    const last = await app.lastBackup();
    const p = app.pending;
    const since = p.cards.length + (p.profile ? 1 : 0);
    const lines = [last ? t('home.backup.last', new Date(last.at).toLocaleDateString(), last.count) : t('home.backup.never')];
    if (last && since) lines.push(t('home.backup.since', since));
    // Numbers handed out after the last backup would be handed out again if it were restored.
    if (last && p.issued) lines.push(t('home.backup.issued', p.issued));
    backupLine.textContent = lines.join(' · ');
  }

  /** Saves a backup of every card and the profile, as a file. */
  async function save() {
    try {
      const { bytes, left } = await app.makeBackup();
      const day = new Date().toISOString().slice(0, 10);
      const url = URL.createObjectURL(new Blob([bytes], { type: 'application/octet-stream' }));
      const a = /** @type {HTMLAnchorElement} */ (h('a', { href: url, download: `pips-${day}.pipsbak`, hidden: true }));
      document.body.append(a);
      a.click();
      a.remove();
      // The browser has the file by the next task; the address is let go then.
      setTimeout(() => URL.revokeObjectURL(url));
      tell(left ? t('home.backup.left', left) : t('home.backup.saved'), left > 0);
    } catch (e) {
      tell(say(e), true);
    }
    await paintBackup();
  }

  /** Adds a backup of this key's to the cards on the device. */
  async function add() {
    const f = fileInput.files?.[0];
    fileInput.value = '';
    if (!f) return;
    /** @type {Uint8Array | null} */
    let bytes = null;
    try {
      if (f.size > BACKUP_MAX) throw { code: 'too_large' };
      bytes = new Uint8Array(await f.arrayBuffer());
      const r = await app.applyBackup(await core.call('openBackup', bytes));
      tell(t('home.backup.added', r.added, r.known));
    } catch (e) {
      // Another key's backup opens only with that key: offer to switch to it.
      const other = /** @type {any} */ (e)?.code === 'other_owner' && bytes;
      const file = other ? { bytes: /** @type {Uint8Array} */ (bytes), name: f.name } : null;
      tell(say(e), true, file ? h('button', { type: 'button', class: 'text-btn', onclick: () => switchKey(file) }, t('home.switch')) : null);
    }
    await paintBackup();
  }

  /** Another key in place of this one, from its words (and its backup). @param {{ bytes: Uint8Array, name: string } | null} [file] */
  function switchKey(file = null) {
    const before = k.state === 'none' ? '' : k.key.hex;
    const back = (/** @type {string} */ text = '') => home({ root, core, app, said: text });
    onboarding({
      root, core, app, start: 'switch', file,
      cancel: () => back(),
      done: (said = '') => back(said || (app.key.state !== 'none' && app.key.key.hex === before ? t('home.switch.same') : t('home.switch.done'))),
    });
  }

  /** Checking the written words against the key, in a sheet over the page. */
  /** Whether the words sheet is opening or open: a second tap opens no second one. */
  let verifying = false;

  /** Checking the written words against the key, in a sheet over the page. */
  async function verify() {
    if (verifying) return;
    verifying = true;
    /** @type {string[]} */
    let list;
    try {
      list = await core.call('recoveryWords');
    } catch (e) {
      verifying = false;
      tell(say(e), true);
      return;
    }
    const verdict = h('p', { class: 'home-verdict', role: 'status' });
    /** The words to check, once all 24 name a word. @type {string[] | null} */
    let words = null;
    const entry = wordsEntry(list, (s) => {
      words = s.words;
      verdict.classList.toggle('wrong', s.bad >= 0);
      verdict.textContent = s.bad >= 0 ? t('onb.restore.unknown', s.bad + 1) : '';
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
    const s = sheet({ title: t('home.verify'), onClose: () => { verifying = false; } },
      h('p', {}, t('home.verify.lead')), entry.el, verdict,
      h('button', { type: 'button', class: 'btn key wide', onclick: () => s.close() }, t('home.verify.done')));
    entry.focus();
  }
}

/**
 * The cards on the device, as a plain list: until the collection comes
 * (stage 5, docs/REWRITE.md), where a card that arrived can be seen. Its
 * name, its artist, and who passed it on; a numbered copy, its number.
 * @param {State} app
 */
function cardList(app) {
  const entries = [...app.cards.values()].filter((e) => e.rec.state !== 'trash').sort((a, b) => b.rec.received - a.rec.received);
  return h('section', { class: 'group', 'aria-labelledby': 'home-cards' }, h('h2', { id: 'home-cards' }, t('home.cards')),
    entries.length
      ? h('ul', { class: 'home-cards', 'aria-labelledby': 'home-cards' }, entries.map((e) => h('li', {},
        h('b', {}, e.card.title || t('card.untitled')),
        h('small', {}, [
          e.rec.mine ? t('home.cards.mine') : e.card.author ? `@${e.card.author}` : '',
          e.rec.edition ? t('edition.copy.of', e.rec.edition.edition, e.rec.edition.of) : '',
          e.rec.from && e.rec.from.key !== e.author?.hex ? t('home.cards.from', e.rec.from.nick) : '',
        ].filter(Boolean).join(' · ')))))
      : h('p', { class: 'hint' }, t('home.cards.none')));
}
