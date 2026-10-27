// @ts-check
// Numbered copies. The recipient shows their recipient code (their key and
// nick); the author scans it, and the app issues the next number in the run
// as a certificate inside the envelope. Only the author's device counts, so
// the count lives beside the card and travels in backups.

import { h } from '../dom.js';
import { t, date } from '../i18n.js';
import { app, editionLog, issueEdition } from '../state.js';
import { nextNumber } from '../editions.js';
import { caught } from '../diagnostics.js';
import { fullSheet as sheet } from '../kit/full-sheet.js';
import { qrFor, qrText, keepAwake, codeSize } from './qr.js';
import { scanner } from './scan.js';
import { ask, toast } from './shell.js';

const DAY = 86_400_000;

/** The recipient's side: their code, to be scanned by the author. */
export async function showRecipientCode() {
  const nick = app.profile.nick;
  if (!nick) return toast(t('edition.need-nick'));
  const release = await keepAwake();
  const { body } = sheet(t('edition.my-code'), release);
  body.append(
    qrText(app.identity.recipientCode(nick), codeSize()),
    h('p', { class: 'qr-note' }, t('edition.my-code.hint', nick)));
}

/**
 * The author's side, for one own card: run size, what was issued, and the
 * button that scans the next recipient.
 * @param {string} digest
 */
export function editionPanel(digest) {
  const log = editionLog(digest);
  const n = log.issued.length;
  const run = /** @type {HTMLInputElement} */ (h('input', { type: 'number', min: '1', max: '65535', inputMode: 'numeric', placeholder: t('edition.run.open') }));
  const runOf = () => (n ? log.of : Math.min(65535, Math.max(0, Math.floor(Number(run.value) || 0))));
  const following = nextNumber(log);
  const out = log.of > 0 && following > log.of;

  const status = n
    ? h('p', { class: 'hint' }, log.of ? t('edition.status.of', n, log.of) : t('edition.status.open', n))
    : [h('div', { class: 'field' }, h('label', {}, t('edition.run')), run), h('p', { class: 'hint' }, t('edition.run.hint'))];

  const next = h('button', {
    class: 'btn key wide', disabled: out,
    onclick: () => scanRecipient(digest, runOf()),
  }, out ? t('edition.run-out') : t('edition.issue', following));

  const list = n
    ? h('div', { class: 'issued' }, ...[...log.issued].reverse().map((i) => h('div', { class: 'issued-row' },
      h('b', {}, `№${i.edition}`), h('span', {}, `@${i.nick}`), h('small', {}, date(i.day * DAY, { day: '2-digit', month: '2-digit' })))))
    : h('p', { class: 'hint' }, t('edition.how'));

  return h('div', { class: 'edition-panel' }, status, next, list);
}

/** Scans a recipient code, confirms, issues, then shows the envelope.
 * @param {string} digest @param {number} of */
function scanRecipient(digest, of) {
  let done = false;
  const s = scanner(async (text) => {
    if (done) return;
    let r;
    try {
      r = app.core.classify(text);
    } catch {
      return;
    }
    if (r.kind !== 'recipient') return toast(t('edition.not-recipient'));
    done = true;
    s.stop();
    const log = editionLog(digest);
    const n = nextNumber(log);
    const run = log.issued.length ? log.of : of;
    const label = run ? t('edition.copy.of', n, run) : t('edition.copy', n);
    if (!(await ask(t('edition.confirm', label, r.nick, r.key.short), { yes: t('edition.yes') }))) {
      done = false;
      return;
    }
    try {
      const res = await issueEdition(digest, of, r);
      sh.close();
      showEnvelope(res.envelope, label, r.nick);
    } catch (e) {
      done = false;
      caught(e, 'edition');
      toast(/** @type {any} */ (e)?.code === 'run_out' ? t('edition.run-out') : `${t('err.generic')}: ${/** @type {any} */ (e)?.message ?? e}`);
    }
  }, t('edition.point'));
  const sh = sheet(t('edition.scan.title'), () => s.stop());
  sh.body.append(s.el);
}

/** @param {Uint8Array} envelope @param {string} label @param {string} nick */
async function showEnvelope(envelope, label, nick) {
  const release = await keepAwake();
  const q = qrFor(envelope, codeSize());
  const { body, close } = sheet(label, () => {
    q.stop();
    release();
  });
  body.append(q.el,
    h('p', { class: 'qr-note' }, t('edition.show', label, nick)),
    h('button', { class: 'btn wide', style: { marginTop: '16px' }, onclick: () => close() }, t('edition.done')));
}
