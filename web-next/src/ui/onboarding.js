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
 * @param {() => void} o.done the app can start
 * @param {'welcome' | 'name'} [o.start] 'name': a key is kept, the name is not
 */
export function onboarding({ root, core, app, done, start = 'welcome' }) {
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
    const next = /** @type {HTMLButtonElement} */ (h('button', { type: 'button', class: 'btn key wide', disabled: true, onclick: () => keep(next) }, t('onb.next')));
    /** Whether each asked word is right, as the core says. @type {boolean[]} */
    const right = places.map(() => false);
    const fields = places.map((n, i) => {
      const input = /** @type {HTMLInputElement} */ (h('input', {
        type: 'text', autocomplete: 'off', autocapitalize: 'none', autocorrect: 'off', spellcheck: 'false', 'aria-label': t('onb.check.word', n),
      }));
      const mark = h('span', { class: 'onb-mark' });
      const field = h('label', { class: 'field' }, h('span', { 'aria-hidden': 'true' }, t('onb.check.word', n)), input, mark);
      input.addEventListener('input', async () => {
        const word = book.resolve(input.value);
        right[i] = !!word && (await core.call('keyCheckWords', [{ n, word }]))[0];
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

  /** The new key kept: hidden by the browser where it can. @param {HTMLButtonElement} button */
  async function keep(button) {
    if (button.disabled) return;
    button.disabled = true;
    try {
      await core.call('keyKeep');
      await app.keyChanged();
    } catch (e) {
      button.disabled = false;
      replace(/** @type {HTMLElement} */ (page.querySelector('.onb-status')), say(e));
      return;
    }
    kept();
  }

  /** What the person now has: the key here, the words with them. */
  function kept() {
    const k = app.key;
    if (k.state === 'none') return welcome();
    const hidden = k.state === 'hidden';
    show(heading(t('onb.kept.title')), h('p', {}, t('onb.kept.lead')),
      h('div', { class: 'idcard' }, identicon(k.key.hex), h('div', {}, h('b', {}, t('onb.kept.new')), h('small', {}, t('key.short', k.key.short)))),
      h('div', { class: 'onb-facts' },
        h('div', { class: hidden ? 'note' : 'note box warn' }, icon(hidden ? 'lock' : 'open'), h('p', {}, t(hidden ? 'onb.kept.hidden' : 'onb.kept.open'))),
        h('div', { class: 'note' }, icon('lines'), h('p', {}, t('onb.kept.words')))),
      h('div', { class: 'onb-grow' }),
      h('button', { type: 'button', class: 'btn key wide', onclick: () => name() }, t('onb.kept.next')));
  }

  /**
   * Getting back what there was: the backup first, if there is one, so the
   * key can be checked against it before anything is kept; then the key
   * from its 24 words.
   */
  async function restore() {
    /** The key the words give, waiting in the worker. @type {{ hex: string, short: string } | null} */
    let key = null;
    /** @type {{ bytes: Uint8Array, name: string, owner: { hex: string, short: string } } | null} */
    let file = null;
    const status = h('p', { class: 'onb-status', role: 'status' });
    const fileBox = h('div', {});
    const go = /** @type {HTMLButtonElement} */ (h('button', { type: 'button', class: 'btn key wide', disabled: true, onclick: () => finish() }, t('onb.restore.go')));

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
        const bytes = new Uint8Array(await f.arrayBuffer());
        file = { bytes, name: f.name, owner: await core.call('backupOwner', bytes) };
        paintFile();
      } catch (e) {
        file = null;
        paintFile(say(e));
        shake(fileBox);
      }
      paint();
    }
    paintFile();

    const entry = wordsEntry(await list, async (s) => {
      key = null;
      if (s.bad >= 0) return paint(t('onb.restore.unknown', s.bad + 1), true);
      if (!s.words) return paint(s.named ? t('onb.restore.count', s.named) : '');
      try {
        key = (await core.call('keyRestore', { words: s.words.join(' ') })).key;
        paint();
      } catch {
        paint(t('onb.restore.sum'), true);
      }
    });

    async function finish() {
      if (go.disabled) return;
      go.disabled = true;
      try {
        // Every card and certificate of the backup checked before anything is kept.
        const opened = file ? await core.call('openBackupWaiting', file.bytes) : null;
        await core.call('keyKeep');
        await app.keyChanged();
        if (opened) await app.applyBackup(opened);
      } catch (e) {
        paint(say(e), true);
        go.disabled = false;
        return;
      }
      if (app.profile.nick) done();
      else name();
    }

    show(heading(t('onb.restore.title')), h('p', {}, t('onb.restore.lead')),
      h('div', { class: 'group' }, h('h2', {}, t('onb.restore.file')), fileBox, fileInput),
      h('div', { class: 'group' }, h('h2', {}, t('onb.restore.key')), h('p', { class: 'hint' }, t('onb.restore.words.lead')), entry.el, status),
      h('div', { class: 'onb-grow' }), go,
      h('button', { type: 'button', class: 'btn plain wide', onclick: async () => { await core.call('keyDrop'); welcome(); } }, t('onb.back')));
  }

  /** The name on the person's cards. The key is kept by now: only forward. */
  function name() {
    const nick = textLimit(/** @type {HTMLInputElement} */ (h('input', { autocomplete: 'nickname', placeholder: 'kitsu', 'aria-label': t('onb.nick.title') })), LIMITS.name, 'chars');
    const problem = h('p', { class: 'onb-status wrong', role: 'alert' });
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
      done();
    }
    show(heading(t('onb.nick.title')), h('p', {}, t('onb.nick.lead')), h('div', { class: 'field' }, nick), problem, h('div', { class: 'onb-grow' }), go);
    nick.focus();
  }

  if (start === 'name') name();
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
