// @ts-check
// Numbered copies, the author's side. The recipient shows their recipient
// code (their key and nick); the author scans it, says yes to the number
// it will take, and the app issues it as a certificate inside the envelope
// (state.js, issueEdition — one at a time across tabs). The recipient then
// scans the envelope's code. Only the author's device counts, so the log
// lives beside the card and travels in backups. From web/src/ui/edition.js.

import { h, replace } from '../dom.js';
import { t } from '../i18n.js';
import { say } from '../errors.js';
import { EMPTY_LOG, nextNumber } from '../rules/editions.js';
import { codeShow, keepAwake } from './qr.js';
import { scanner } from './scanner.js';
import { sheet } from './sheet.js';

/** @typedef {ReturnType<typeof import('../state.js').createState>} State */
/** @typedef {{ call(op: string, ...args: unknown[]): Promise<any> }} Core */

/** A numbered copy, as it is named: its number, and the run when there is one (0 is no limit). @param {number} edition @param {number} of */
export const copyLabel = (edition, of) => (of ? t('edition.copy.of', edition, of) : t('edition.copy', edition));

/** The largest run a certificate holds (pips-sign: a 16-bit count). */
const MAX_RUN = 65535;
const DAY = 86_400_000;

/**
 * The panel for one own card: the run, what was issued, and the button
 * that scans the next recipient. Drawn again by the caller when the log
 * changes.
 * @param {{ core: Core, app: State, tell: import('./shell.js').Tell, digest: string }} o
 */
export function editionPanel({ core, app, tell, digest }) {
  const log = app.cards.get(digest)?.rec.editions ?? EMPTY_LOG;
  const n = log.issued.length;
  const run = /** @type {HTMLInputElement} */ (h('input', { type: 'number', min: '1', max: String(MAX_RUN), inputMode: 'numeric', placeholder: t('edition.run.open'), 'aria-label': t('edition.run') }));
  // The run is fixed by the first copy: before it, as typed (0 is no limit); after, as the log has it.
  const runOf = () => (n ? log.of : Math.min(MAX_RUN, Math.max(0, Math.floor(Number(run.value) || 0))));
  const following = nextNumber(log);
  const out = log.of > 0 && following > log.of;
  const status = n
    ? h('p', { class: 'hint' }, log.of ? t('edition.status.of', n, log.of) : t('edition.status.open', n))
    : [h('div', { class: 'field' }, h('label', {}, t('edition.run')), run), h('p', { class: 'hint' }, t('edition.run.hint'))];
  const next = h('button', { type: 'button', class: 'btn key wide', disabled: out, onclick: () => scanRecipient({ core, app, tell, digest }, runOf()) },
    out ? t('edition.run-out') : t('edition.issue', following));
  const list = n
    ? h('ol', { class: 'ed-issued', 'aria-label': t('edition.issued') }, [...log.issued].reverse().map((i) => h('li', {},
      h('b', {}, t('edition.copy', i.edition)), h('span', {}, `@${i.nick}`), h('small', {}, new Date(i.day * DAY).toLocaleDateString(undefined, { day: '2-digit', month: '2-digit' })))))
    : h('p', { class: 'hint' }, t('edition.how'));
  return h('div', { class: 'ed-panel' }, status, next, list);
}

/**
 * Scans a recipient code, asks, issues, then shows the envelope's code.
 * @param {{ core: Core, app: State, tell: import('./shell.js').Tell, digest: string }} o @param {number} of
 */
function scanRecipient({ core, app, tell, digest }, of) {
  /** Whether a recipient was read and is being answered: the camera's next frames wait. */
  let busy = false;
  const s = scanner({
    hint: t('edition.point'),
    onText: async (text, from) => {
      if (busy) return;
      /** @type {any} */
      let r;
      try {
        r = await core.call('classify', text);
      } catch {
        return;
      }
      // Said in the frame, where the eyes are: a message would be put up again for every camera frame.
      if (r.kind !== 'recipient') return s.say(t('edition.not-recipient'), true, from.picture);
      busy = true;
      s.stop();
      const log = app.cards.get(digest)?.rec.editions ?? EMPTY_LOG;
      const number = nextNumber(log);
      const runSize = log.issued.length ? log.of : of;
      const label = copyLabel(number, runSize);
      if (!(await confirm(t('edition.confirm.title', label), t('edition.confirm', label, r.nick, r.key.short)))) { busy = false; return; }
      try {
        const res = await app.issueEdition(digest, of, { bytes: r.bytes, nick: r.nick, key: r.key });
        scan.close();
        if ('code' in res) return tell(t('edition.run-out'), { wrong: true });
        const issued = copyLabel(res.edition, res.of);
        await showEnvelope(core, res.envelope, issued, r.nick);
      } catch (e) {
        busy = false;
        tell(say(e), { wrong: true });
      }
    },
  });
  const scan = sheet({ title: t('edition.scan.title'), onClose: () => s.stop() }, s.frame,
    h('div', { class: 'row-btns' }, s.imageButton), s.imageInput,
    h('button', { type: 'button', class: 'btn plain wide', onclick: () => scan.close() }, t('ask.cancel')));
}

/** A question with a yes that takes a number, and a cancel. @param {string} title @param {string} question @returns {Promise<boolean>} */
function confirm(title, question) {
  return new Promise((answer) => {
    let said = false;
    /** @param {boolean} v */
    const pick = (v) => { said = true; answer(v); s.close(); };
    const s = sheet({ title, onClose: () => { if (!said) answer(false); } }, h('p', {}, question),
      h('div', { class: 'row-btns' },
        h('button', { type: 'button', class: 'btn', onclick: () => pick(false) }, t('ask.cancel')),
        h('button', { type: 'button', class: 'btn key', onclick: () => pick(true) }, t('edition.yes'))));
  });
}

/** The numbered copy's code, for its recipient to scan. @param {Core} core @param {Uint8Array} envelope @param {string} label @param {string} nick */
async function showEnvelope(core, envelope, label, nick) {
  const release = keepAwake();
  const code = await codeShow(core, envelope, label);
  const s = sheet({ title: label, onClose: () => { code.stop(); release(); } },
    h('div', { class: 'ed-code' }, code.el), h('p', {}, t('edition.show', label, nick)),
    h('button', { type: 'button', class: 'btn wide', onclick: () => s.close() }, t('edition.done')));
}

/** Replaces `el`'s content with the panel, now and whenever the app changes, until `el` leaves the page. @param {HTMLElement} el @param {Parameters<typeof editionPanel>[0]} o */
export function livePanel(el, o) {
  const draw = () => replace(el, editionPanel(o));
  draw();
  const stop = o.app.subscribe(() => { if (!el.isConnected) return stop(); draw(); });
  return stop;
}
