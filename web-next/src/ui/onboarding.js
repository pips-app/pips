// @ts-check
// The first run: a new key, its words shown once and checked, then kept
// hidden by the browser (core/keys.js); or a key restored from its 24
// words, with the backup if there is one. Then the name the person signs
// with. Nothing is kept until the words have been checked, or until the
// restored key and its backup both check out (the agreed mock-up:
// docs/REWRITE.md, О1). From web/src/ui/onboarding.js, which held the key
// itself.
//
// The paper key is read with the camera at stage 4; until then the words.

import { h, replace, shake, textLimit } from '../dom.js';
import { icon } from '../icons.js';
import { t } from '../i18n.js';
import { say } from '../errors.js';
import { finished, LIMITS } from '../text.js';
import { wordBook } from '../words.js';
import { identicon } from './identicon.js';
import { qrCanvas } from './qr.js';
import { wordsEntry } from './words-entry.js';

/** Words asked back to check the record: a typo or a swapped pair is caught, and it is quick (decided with the owner). */
const ASKED = 3;
/** The largest backup the core opens (pips-store's MAX_FILE): a larger file is refused before it is read. */
const BACKUP_MAX = 64 * 1024 * 1024;

/** @typedef {ReturnType<typeof import('../state.js').createState>} State */
/** @typedef {import('../core/client.js').CoreError} CoreError */

/**
 * @param {object} o
 * @param {HTMLElement} o.root where the pages go
 * @param {{ call(op: string, ...args: unknown[]): Promise<any> }} o.core
 * @param {State} o.app
 * @param {(said?: string) => void} o.done the app can start; `said`: what went wrong after the key was kept, to say there
 * @param {'welcome' | 'name' | 'switch'} [o.start] 'name': a key is kept, the name is not;
 *   'switch': from the profile, another key in place of this one
 * @param {() => void} [o.cancel] back out of switching
 * @param {{ bytes: Uint8Array, name: string } | null} [o.file] switching to the key of this backup
 */
export function onboarding({ root, core, app, done, start = 'welcome', cancel = () => {}, file: chosen = null }) {
  const page = h('main', { class: 'onb' });
  replace(root, page);
  /** The core's word list, asked for once. @type {Promise<string[]>} */
  const list = core.call('recoveryWords');

  /** One page: its parts, then focus on its heading so a screen reader starts there. @param {...any} parts */
  function show(...parts) {
    replace(page, ...parts);
    window.scrollTo(0, 0);
    /** @type {HTMLElement | null} */ (page.querySelector('h1'))?.focus();
  }
  /** @param {string} text */
  const heading = (text) => h('h1', { tabindex: -1 }, text);

  function welcome() {
    show(logo(), h('h1', { class: 'onb-title', tabindex: -1 }, 'Pips'), h('p', {}, t('onb.lead')), h('div', { class: 'onb-grow' }),
      h('button', { type: 'button', class: 'btn key wide', onclick: () => create() }, t('onb.create')),
      h('button', { type: 'button', class: 'btn wide', onclick: () => restore() }, t('onb.restore')));
  }

  /**
   * A new key's words, shown now or never. The key waits in the core's
   * worker, not kept; back is back.
   * @param {{ words: string, paper: string, key: { hex: string } } | null} [made] the key shown before, coming back to it
   */
  async function create(made = null) {
    /** @type {{ words: string, paper: string, key: { hex: string } }} */
    const k = made ?? await core.call('keyNew');
    const words = k.words.split(' ');
    const paper = h('div', { class: 'onb-paper', hidden: true });
    // The paper key: the same key as a QR code, to print or photograph and
    // keep instead of the words. Drawn by the core when first asked for.
    const paperBtn = h('button', { type: 'button', class: 'btn wide', 'aria-expanded': 'false', onclick: async () => {
      if (!paper.childElementCount) paper.append(qrCanvas(await core.call('qrMatrix', k.paper), t('onb.paper.code')));
      const open = paper.hidden;
      paper.hidden = !open;
      paperBtn.setAttribute('aria-expanded', String(open));
    } }, icon('qr'), t('onb.paper'));
    show(heading(t('onb.words.title')), h('p', {}, t('onb.words.lead')),
      h('div', { class: 'note box' }, icon('lock'), h('p', {}, h('b', {}, t('onb.words.once')), ' ', t('onb.words.why'))),
      h('ol', { class: 'word-grid shown', 'aria-label': t('onb.words.title') }, words.map((w, i) => h('li', {}, h('span', { 'aria-hidden': 'true' }, i + 1), w))),
      paper, h('div', { class: 'onb-grow' }), paperBtn,
      h('button', { type: 'button', class: 'btn key wide', onclick: () => check(k) }, t('onb.words.written')),
      h('button', { type: 'button', class: 'btn plain wide', onclick: async () => { await core.call('keyDrop'); welcome(); } }, t('onb.back')));
  }

  /**
   * Three of the words asked back, at places chosen at random: the record
   * is checked while the words can still be seen.
   * @param {{ words: string, paper: string, key: { hex: string } }} k
   */
  async function check(k) {
    const words = k.words.split(' ');
    const book = wordBook(await list);
    const places = pick(ASKED, words.length);
    const status = h('p', { class: 'onb-status wrong', role: 'status' });
    const next = /** @type {HTMLButtonElement} */ (h('button', { type: 'button', class: 'btn key wide', disabled: true, onclick: () => keep(next, k.words) }, t('onb.next')));
    /** Whether each asked word is right. The page has the words: it is showing them. @type {boolean[]} */
    const right = places.map(() => false);
    const fields = places.map((n, i) => {
      const input = /** @type {HTMLInputElement} */ (h('input', {
        type: 'text', autocomplete: 'off', autocapitalize: 'none', autocorrect: 'off', spellcheck: 'false', 'aria-label': t('onb.check.word', n),
      }));
      const mark = h('span', { class: 'onb-mark' });
      const field = h('label', { class: 'field' }, h('span', { 'aria-hidden': 'true' }, t('onb.check.word', n)), input, mark);
      input.addEventListener('input', () => {
        const word = book.resolve(input.value);
        right[i] = word === words[n - 1];
        replace(mark, right[i] ? icon('check') : '');
        const wrong = !!word && !right[i];
        field.classList.toggle('bad', wrong);
        input.setAttribute('aria-invalid', String(wrong));
        // What is wrong, in words: a word from another place is a swapped pair.
        const elsewhere = !!word && words.includes(word);
        status.textContent = wrong ? t(elsewhere ? 'onb.check.swapped' : 'onb.check.other') : '';
        next.disabled = !right.every(Boolean);
      });
      return field;
    });
    show(heading(t('onb.check.title')), h('p', {}, t('onb.check.lead')),
      h('div', { class: 'onb-asked' }, fields), status, h('div', { class: 'onb-grow' }), next,
      h('button', { type: 'button', class: 'text-btn', onclick: () => create(k) }, t('onb.check.again')));
    /** @type {HTMLInputElement} */ (fields[0].querySelector('input')).focus();
  }

  /**
   * The new key kept: hidden by the browser where it can. Made again from
   * its words first, so that a worker restarted meanwhile (which forgets a
   * waiting key) changes nothing: the key kept is the one whose words were
   * checked. @param {HTMLButtonElement} button @param {string} words
   */
  async function keep(button, words) {
    if (button.disabled) return;
    button.disabled = true;
    /** @type {any} */
    let next;
    try {
      await core.call('keyRestore', { words });
      next = await core.call('keyKeep');
    } catch (e) {
      button.disabled = false;
      replace(/** @type {HTMLElement} */ (page.querySelector('.onb-status')), say(e));
      return;
    }
    kept(await settled(next));
  }

  /**
   * After a key is kept there is no way back: whatever fails next (storage,
   * the backup) is said where the person goes on, not on the page they
   * left. @param {any} next the key's state, as keyKeep gave it @param {() => Promise<unknown>} [then]
   * @returns {Promise<string>} what to say, if anything
   */
  async function settled(next, then = async () => {}) {
    try {
      await app.keyChanged(next);
      await then();
      return '';
    } catch (e) {
      return say(e);
    }
  }

  /** What the person now has: the key here, the words with them. @param {string} said */
  function kept(said) {
    const k = app.key;
    if (k.state === 'none') return welcome();
    const hidden = k.state === 'hidden';
    show(heading(t('onb.kept.title')), h('p', {}, t('onb.kept.lead')),
      h('div', { class: 'idcard' }, identicon(k.key.hex), h('div', {}, h('b', {}, t('onb.kept.new')), h('small', {}, t('key.short', k.key.short)))),
      h('div', { class: 'onb-facts' },
        h('div', { class: hidden ? 'note' : 'note box warn' }, icon(hidden ? 'lock' : 'open'), h('p', {}, t(hidden ? 'onb.kept.hidden' : 'onb.kept.open'))),
        h('div', { class: 'note' }, icon('lines'), h('p', {}, t('onb.kept.words')))),
      h('p', { class: 'onb-status wrong', role: 'alert' }, said),
      h('div', { class: 'onb-grow' }),
      h('button', { type: 'button', class: 'btn key wide', onclick: () => name() }, t('onb.kept.next')));
  }

  /**
   * Getting back what there was: the backup first, if there is one, so the
   * key can be checked against it before anything is kept; then the key
   * from its 24 words.
   */
  /**
   * The same, from the profile: another key takes this one's place. The
   * cards on the device stay; the person's own become a former self's.
   */
  async function restore(switching = false) {
    /** The key the words give, waiting in the worker. @type {{ hex: string, short: string } | null} */
    let key = null;
    /** The words that gave it. */
    let typed = '';
    /** @type {{ bytes: Uint8Array, name: string, owner: { hex: string, short: string } } | null} */
    let file = null;
    const status = h('p', { class: 'onb-status', role: 'status' });
    const fileBox = h('div', {});
    const go = /** @type {HTMLButtonElement} */ (h('button', { type: 'button', class: 'btn key wide', disabled: true }, t('onb.restore.go')));

    /**
     * Where things stand; restoring goes only with a key that fits the file.
     * @param {string} [note] @param {boolean} [bad] the note says something is wrong (not a count)
     */
    function paint(note = '', bad = false) {
      const mismatch = !!(key && file && key.hex !== file.owner.hex);
      status.classList.toggle('wrong', mismatch || bad);
      if (key && !mismatch) replace(status, h('div', { class: 'idcard' }, identicon(key.hex), h('div', {}, h('b', {}, t('onb.restore.found')), h('small', {}, t('key.short', key.short) + (file ? ` · ${t('onb.restore.fits')}` : '')))));
      else replace(status, mismatch && key ? t('onb.restore.mismatch', key.short) : note);
      go.disabled = !key || mismatch;
    }

    const fileInput = /** @type {HTMLInputElement} */ (h('input', { type: 'file', accept: '.pipsbak', hidden: true, onchange: () => pickFile() }));
    /** @param {string} [problem] */
    function paintFile(problem = '') {
      replace(fileBox,
        file
          ? h('div', { class: 'idcard' }, identicon(file.owner.hex), h('div', {}, h('b', {}, file.name), h('small', {}, t('key.short', file.owner.short))),
            h('button', { type: 'button', class: 'text-btn', onclick: () => { file = null; paintFile(); paint(); } }, t('onb.restore.drop')))
          : h('button', { type: 'button', class: 'btn wide', onclick: () => fileInput.click() }, t('onb.restore.pick')),
        h('p', { class: problem ? 'hint wrong' : 'hint', role: problem ? 'alert' : null }, problem || t(file ? 'onb.restore.file.on' : 'onb.restore.file.off')));
    }
    async function pickFile() {
      const f = fileInput.files?.[0];
      fileInput.value = '';
      if (!f) return;
      try {
        if (f.size > BACKUP_MAX) throw { code: 'too_large' };
        await take(new Uint8Array(await f.arrayBuffer()), f.name);
      } catch (e) {
        file = null;
        paintFile(say(e));
        shake(fileBox);
      }
      paint();
    }
    /** A backup file, by its owner. @param {Uint8Array} bytes @param {string} name */
    async function take(bytes, name) {
      file = { bytes, name, owner: await core.call('backupOwner', bytes) };
      paintFile();
    }
    if (chosen) await take(chosen.bytes, chosen.name);
    else paintFile();

    /** Each change of the words asks anew; an answer to an older one is dropped. */
    let asked = 0;
    const entry = wordsEntry(await list, async (s) => {
      const words = s.words?.join(' ') ?? '';
      // The same words again (a cell left, as a tap on the button leaves it): nothing changed.
      if (s.bad < 0 && words && words === typed && key) return;
      const ask = ++asked;
      // Nothing to restore until these words have answered.
      key = null;
      typed = '';
      go.disabled = true;
      if (s.bad >= 0) return paint(t('onb.restore.unknown', s.bad + 1), true);
      if (!s.words) return paint(s.named ? t('onb.restore.count', s.named) : '');
      try {
        const found = (await core.call('keyRestore', { words })).key;
        if (ask !== asked) return; // typed on meanwhile
        key = found;
        typed = words;
        paint();
      } catch (e) {
        if (ask !== asked) return;
        paint(/** @type {any} */ (e)?.code === 'bad_words' ? t('onb.restore.sum') : say(e), true);
      }
    });

    /** Restoring: in place of another key, asked first. */
    function restoreClicked() {
      if (go.disabled) return;
      const now = app.key;
      if (switching && now.state !== 'none' && key && now.key.hex !== key.hex) confirm(now.key);
      else void finish();
    }

    /**
     * Switching throws the current key away: it comes back only from its
     * words, which Pips cannot show. Said, and asked, before it is done.
     * @param {{ hex: string, short: string }} current
     */
    function confirm(current) {
      const own = [...app.cards.values()].filter((e) => e.rec.mine).length;
      show(heading(t('onb.confirm.title')), h('p', {}, t('onb.switch.lead')),
        h('div', { class: 'idcard' }, identicon(current.hex), h('div', {}, h('b', {}, t('onb.confirm.now')), h('small', {}, t('key.short', current.short)))),
        h('div', { class: 'note box warn' }, icon('open'), h('p', {}, t('onb.confirm.lead', current.short))),
        own ? h('div', { class: 'note' }, icon('lines'), h('p', {}, t('onb.switch.own', own))) : '',
        h('div', { class: 'onb-grow' }),
        h('button', { type: 'button', class: 'btn key wide', onclick: () => { show(...parts); void finish(); } }, t('onb.confirm.go')),
        h('button', { type: 'button', class: 'btn plain wide', onclick: () => show(...parts) }, t('onb.back')));
    }

    async function finish() {
      if (go.disabled) return;
      go.disabled = true;
      /** @type {any} */
      let next;
      /** @type {any} */
      let opened = null;
      try {
        // The key made again from its words: a worker restarted since they
        // were typed has forgotten it, and the person need not type them again.
        await core.call('keyRestore', { words: typed });
        // Every card and certificate of the backup checked before anything is kept.
        if (file) opened = await core.call('openBackupWaiting', file.bytes);
        next = await core.call('keyKeep', { switching });
      } catch (e) {
        paint(say(e), true);
        go.disabled = false;
        return;
      }
      const said = await settled(next, async () => { if (opened) await app.applyBackup(opened); });
      if (app.profile.nick) done(said);
      else name(said);
    }

    go.onclick = restoreClicked;
    const parts = [heading(t(switching ? 'onb.switch.title' : 'onb.restore.title')), h('p', {}, t(switching ? 'onb.switch.lead' : 'onb.restore.lead')),
      h('div', { class: 'group' }, h('h2', {}, t('onb.restore.file')), fileBox, fileInput),
      h('div', { class: 'group' }, h('h2', {}, t('onb.restore.key')), h('p', { class: 'hint' }, t('onb.restore.words.lead')), entry.el, status),
      h('div', { class: 'onb-grow' }), go,
      h('button', { type: 'button', class: 'btn plain wide', onclick: async () => { await core.call('keyDrop'); if (switching) cancel(); else welcome(); } }, t('onb.back'))];
    show(...parts);
  }

  /** The name on the person's cards. The key is kept by now: only forward. @param {string} [said] what went wrong before, still to say */
  function name(said = '') {
    const nick = textLimit(/** @type {HTMLInputElement} */ (h('input', { autocomplete: 'nickname', placeholder: 'kitsu', 'aria-label': t('onb.nick.title') })), LIMITS.name, 'chars');
    const problem = h('p', { class: 'onb-status wrong', role: 'alert' }, said);
    // A name is needed: it is on every card drawn and every card passed on.
    const go = /** @type {HTMLButtonElement} */ (h('button', { type: 'button', class: 'btn key wide', disabled: true, onclick: finish }, t('onb.done')));
    nick.addEventListener('input', () => { go.disabled = !finished(nick.value); });
    // Once: a second tap while the first is storing would start the app twice.
    async function finish() {
      if (go.disabled) return;
      go.disabled = true;
      try {
        await app.setProfile({ ...app.profile, nick: finished(nick.value) });
      } catch (e) {
        problem.textContent = say(e);
        go.disabled = false;
        return;
      }
      done(said);
    }
    show(heading(t('onb.nick.title')), h('p', {}, t('onb.nick.lead')), h('div', { class: 'field' }, nick), problem, h('div', { class: 'onb-grow' }), go);
    nick.focus();
  }

  if (start === 'name') name();
  else if (start === 'switch') void restore(true);
  else welcome();
}

/** The app's mark, drawn as pixels. */
function logo() {
  const cv = /** @type {HTMLCanvasElement} */ (h('canvas', { class: 'onb-logo', width: 8, height: 8, 'aria-hidden': 'true' }));
  const g = /** @type {CanvasRenderingContext2D} */ (cv.getContext('2d'));
  const rows = ['..XXXX..', '.X....X.', 'X.X..X.X', 'X......X', 'X.X..X.X', 'X..XX..X', '.X....X.', '..XXXX..'];
  g.fillStyle = '#6d8fd6';
  rows.forEach((r, y) => [...r].forEach((c, x) => { if (c === 'X') g.fillRect(x, y, 1, 1); }));
  return cv;
}

/**
 * `count` different places from 1 to `of`, in order, chosen with the
 * browser's secure random numbers.
 * @param {number} count @param {number} of
 */
function pick(count, of) {
  const chosen = new Set();
  const r = new Uint32Array(1);
  while (chosen.size < count) {
    crypto.getRandomValues(r);
    chosen.add((r[0] % of) + 1);
  }
  return [...chosen].sort((a, b) => a - b);
}
