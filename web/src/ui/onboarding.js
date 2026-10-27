// @ts-check
// First run: create a key (and write down its words) or restore one — the
// key from its 24 words or its paper QR, with the backup if there is one.
// Nothing is stored until the person has confirmed the words, or until the
// key and the backup have both checked out.
//
// The same restore, opened from Profile, puts another key in place of the
// present one (a key made by mistake on a new phone, say); the cards on
// the device stay.

import { h, replace, byteLimit } from '../dom.js';
import { t, reason } from '../i18n.js';
import { app, setIdentity, setProfile, applyBackup } from '../state.js';
import { segmented } from '../kit/segmented.js';
import { identicon } from '../kit/identicon.js';
import { iconButton } from '../kit/icon-button.js';
import { wordsEntry } from './words-entry.js';
import { scanner } from './scan.js';
import { caught } from '../diagnostics.js';

/**
 * @param {HTMLElement} root @param {() => void} done
 * @param {{switching?: {file: {bytes: Uint8Array, name: string}|null, cancel: () => void}}} [opts]
 *   switching: from Profile, only the restore, maybe with a backup already chosen
 */
export function onboarding(root, done, opts = {}) {
  const page = h('div', { class: 'onb' });
  root.append(page);

  const logo = () => {
    const cv = /** @type {HTMLCanvasElement} */ (h('canvas', { class: 'logo', width: 8, height: 8 }));
    const g = /** @type {CanvasRenderingContext2D} */ (cv.getContext('2d'));
    const rows = ['..XXXX..', '.X....X.', 'X.X..X.X', 'X......X', 'X.X..X.X', 'X..XX..X', '.X....X.', '..XXXX..'];
    rows.forEach((r, y) => [...r].forEach((c, x) => { if (c === 'X') { g.fillStyle = '#6d8fd6'; g.fillRect(x, y, 1, 1); } }));
    return cv;
  };

  function welcome() {
    replace(page, logo(), h('h1', {}, t('onb.title')), h('p', {}, t('onb.lead')), h('div', { class: 'grow' }),
      h('button', { class: 'btn key wide', onclick: create }, t('onb.create')),
      h('div', { style: { height: '8px' } }),
      h('button', { class: 'btn wide', onclick: restore }, t('onb.restore')));
  }

  function create() {
    const identity = app.core.Identity.fromSeed(crypto.getRandomValues(new Uint8Array(32)));
    const next = /** @type {HTMLButtonElement} */ (h('button', { class: 'btn key wide', disabled: true, onclick: () => name(identity) }, t('onb.next')));
    const ack = /** @type {HTMLInputElement} */ (h('input', { type: 'checkbox', onchange: () => (next.disabled = !ack.checked) }));
    replace(page, h('h1', {}, t('onb.words.title')), h('p', {}, t('onb.words.lead')),
      h('div', { class: 'word-grid' }, identity.words().split(' ').map((/** @type {string} */ w) => h('span', {}, w))),
      h('label', { class: 'check' }, ack, t('onb.words.ack')), h('div', { class: 'grow' }), next);
  }

  /**
   * A key as Profile shows it: its mark, a title, the key in short.
   * @param {{hex: string, short: string}} k @param {string} title @param {string} extra after the key
   * @param {Element} [end] a control at the end
   */
  const idCard = (k, title, extra, end) => h('div', { class: 'idcard' }, identicon(k.hex),
    h('div', { class: 'grow' }, h('b', {}, title), h('small', {}, `${t('me.key')} ${k.short}${extra ? ` · ${extra}` : ''}`)), end);

  /**
   * Getting back what there was: the backup first, if there is one, so the
   * key can be checked against it before anything is stored; then the key,
   * from its words or its paper QR. Both come back in one step, and the
   * profile with them.
   */
  function restore() {
    /** @type {any} the identity the words or the paper give, once they do */
    let key = null;
    /** @type {{bytes: Uint8Array, name: string, owner: {hex: string, short: string}}|null} */
    let file = null;
    let fileError = '';
    /** What the key part has to say. @type {{text: string, wrong: boolean}} */
    let note = { text: '', wrong: false };

    const status = h('div', { class: 'onb-status', role: 'status' });
    const go = /** @type {HTMLButtonElement} */ (h('button', { class: 'btn key wide onb-go', disabled: true, onclick: () => finish() }, t('onb.restore.go')));
    /** Where things stand; the restore goes only with a key that fits the file. */
    function paint() {
      const k = key?.publicKey();
      const mismatch = !!(k && file && k.hex !== file.owner.hex);
      // A key that will do is shown as Profile shows it: its mark beside it,
      // the same mark as the backup's when they belong together.
      if (k && !mismatch) replace(status, idCard(k, t('onb.key.found'), file ? t('onb.key.fits') : ''));
      else replace(status, mismatch ? t('onb.key.mismatch', k.short) : note.text);
      status.classList.toggle('wrong', mismatch || note.wrong);
      go.disabled = !k || mismatch;
    }

    // ------------------------------------------------------- the backup --
    const fileInput = /** @type {HTMLInputElement} */ (h('input', { type: 'file', accept: '.pipsbak', hidden: true, onchange: () => pick() }));
    const fileBox = h('div', { class: 'onb-file' });
    async function pick() {
      const f = fileInput.files?.[0];
      fileInput.value = '';
      if (f) take(new Uint8Array(await f.arrayBuffer()), f.name);
    }
    /** @param {Uint8Array} bytes @param {string} name */
    function take(bytes, name) {
      try {
        file = { bytes, name, owner: app.core.backupOwner(bytes) };
        fileError = '';
      } catch (e) {
        caught(e, 'restore');
        file = null;
        fileError = reason('backup.err', e, /** @type {any} */ (e)?.message);
      }
      paintFile();
      paint();
    }
    function paintFile() {
      replace(fileBox,
        file
          ? idCard(file.owner, file.name, '', iconButton({ icon: 'close', label: t('onb.restore.file.drop'), onClick: () => { file = null; paintFile(); paint(); } }).el)
          : h('button', { type: 'button', class: 'btn wide', onclick: () => fileInput.click() }, t('onb.restore.file.pick')),
        fileError ? h('p', { class: 'onb-status wrong' }, fileError) : h('p', { class: 'hint' }, t(file ? 'onb.restore.file.on' : 'onb.restore.file.off')));
    }
    if (opts.switching?.file) take(opts.switching.file.bytes, opts.switching.file.name);
    else paintFile();

    // ---------------------------------------------------------- the key --
    /** @param {any} k @param {{text: string, wrong: boolean}} n */
    const setKey = (k, n) => { key = k; note = n; paint(); };
    
    const words = wordsEntry(app.core.recoveryWords(), (s) => {
      if (s.bad >= 0) return setKey(null, { text: t('onb.key.unknown', s.bad + 1), wrong: true });
      if (!s.words) return setKey(null, { text: s.named ? t('onb.key.count', s.named) : '', wrong: false });
      try {
        key = app.core.Identity.fromWords(s.words.join(' '));
        setKey(key, { text: '', wrong: false });
      } catch {
        setKey(null, { text: t('onb.key.sum'), wrong: true });
      }
    });
    const scan = scanner((text) => {
      if (key) return; // read already; the camera keeps reading until stopped
      if (app.core.classify(text).kind !== 'paper_key') return scan.say(t('onb.key.not-paper'));
      try {
        key = app.core.Identity.fromPaper(text);
        scan.stop();
        setKey(key, { text: '', wrong: false });
      } catch {
        scan.say(t('onb.key.bad-paper'));
      }
    }, t('onb.restore.paper.point'));
    const keyBox = h('div', {});
    /** @param {'words'|'paper'} how */
    function show(how) {
      scan.stop();
      setKey(null, { text: '', wrong: false });
      replace(keyBox, how === 'words' ? [h('p', { class: 'hint' }, t('onb.restore.words.lead')), words.el] : scan.el);
      if (how === 'words') words.refresh(); // what was typed is still there
    }
    const how = segmented({
      label: t('onb.restore.key'), value: /** @type {'words'|'paper'} */ ('words'), onChange: show,
      options: [{ value: 'words', label: t('onb.restore.words') }, { value: 'paper', label: t('onb.restore.paper') }],
    });
    show('words');

    async function finish() {
      if (go.disabled) return;
      go.disabled = true;
      let opened = null;
      if (file) {
        try {
          opened = key.openBackup(file.bytes); // every card and certificate checked, nothing stored yet
        } catch (e) {
          caught(e, 'restore');
          fileError = reason('backup.err', e, /** @type {any} */ (e)?.message);
          paintFile();
          return paint();
        }
      }
      scan.stop();
      await setIdentity(key);
      if (opened) await applyBackup(opened);
      if (app.profile.nick) {
        page.remove();
        done();
      } else name(key);
    }

    const back = () => {
      scan.stop();
      if (!opts.switching) return welcome();
      page.remove();
      opts.switching.cancel();
    };
    const switching = !!opts.switching;
    replace(page, h('h1', {}, t(switching ? 'onb.switch.title' : 'onb.restore.title')), h('p', {}, t(switching ? 'onb.switch.lead' : 'onb.restore.lead')),
      h('h2', {}, t('onb.restore.file')), fileBox, fileInput,
      h('h2', {}, t('onb.restore.key')), how.el, keyBox, status,
      h('div', { class: 'grow' }), go,
      h('div', { style: { height: '8px' } }), h('button', { class: 'btn wide', 'aria-label': t('onb.back'), onclick: back }, '←'));
  }

  /** The nick, for a new key or one restored without it. Whatever else the profile holds stays. @param {any} identity */
  function name(identity) {
    const nick = byteLimit(/** @type {HTMLInputElement} */ (h('input', { autocomplete: 'nickname', placeholder: 'kitsu' })), 24);
    const finish = async () => {
      await setIdentity(identity);
      await setProfile({ ...app.profile, nick: nick.value.trim() });
      page.remove();
      done();
    };
    replace(page, h('h1', {}, t('onb.nick.title')), h('p', {}, t('onb.nick.lead')),
      h('div', { class: 'field' }, nick), h('div', { class: 'grow' }), h('button', { class: 'btn key wide', onclick: finish }, t('onb.done')));
    nick.focus();
  }

  if (opts.switching) restore();
  else welcome();
}
