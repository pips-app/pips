// @ts-check
// The journal in Profile: a group that says whether anything went wrong,
// and a page with the entries. The report goes out the way the device
// offers — its share sheet (a messenger, mail), else the clipboard, else a
// file — and the person sees what it holds before it goes.

import { h, replace } from '../dom.js';
import { t, language, date } from '../i18n.js';
import { app } from '../state.js';
import { journal, fullReport } from '../diagnostics.js';
import { VERSION } from '../version.js';
import { fullSheet } from '../kit/full-sheet.js';
import { toast } from './shell.js';

/** @param {number} ms */
const when = (ms) => date(ms, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' });

/** The Profile group; it follows the journal while it is on screen. */
export function journalGroup() {
  const box = h('div', { class: 'group journal-group' });
  const paint = () => {
    const list = journal.entries, last = list[list.length - 1];
    const errors = list.filter((e) => e.kind === 'error').length;
    replace(box, h('h2', {}, t('journal.title')),
      h('p', { class: `hint lead${errors ? ' warn-text' : ''}` }, last ? t('journal.status', list.length, when(last.at)) : t('journal.none')),
      h('div', { class: 'row-btns' },
        h('button', { class: 'btn', onclick: () => openJournal() }, t('journal.open')),
        h('button', { class: 'btn', onclick: () => send() }, t('journal.send'))),
      h('p', { class: 'hint' }, t('journal.hint', VERSION)));
  };
  paint();
  const stop = journal.listen(() => { if (box.isConnected) paint(); else stop(); });
  return box;
}

/** The entries, newest first, and what can be done with them. */
export function openJournal() {
  /** @type {() => void} */
  let stop = () => {};
  const s = fullSheet(t('journal.title'), () => stop());
  // The whole report as it would go, on request: nothing is sent unseen.
  const preview = h('details', { class: 'journal-report' }, h('summary', {}, t('journal.preview')), h('pre', {}));
  preview.addEventListener('toggle', async () => {
    if (!(/** @type {HTMLDetailsElement} */ (preview)).open) return;
    /** @type {HTMLElement} */ (preview.querySelector('pre')).textContent = await reportText();
  });
  const paint = () => {
    const list = [...journal.entries].reverse();
    replace(s.body, preview, list.length
      ? list.map((e) => h('article', { class: `journal-row is-${e.kind}` },
        h('header', {},
          h('b', {}, t(e.kind === 'error' ? 'journal.error' : 'journal.warn')),
          e.count > 1 ? h('span', { class: 'journal-count' }, `×${e.count}`) : '',
          e.where ? h('span', {}, e.where) : '',
          h('time', {}, when(e.at))),
        h('p', {}, e.text),
        e.stack ? h('details', {}, h('summary', {}, t('journal.stack')), h('pre', {}, e.stack)) : ''))
      : h('p', { class: 'hint' }, t('journal.empty')));
  };
  paint();
  stop = journal.listen(paint);
  replace(s.foot,
    h('button', { class: 'btn key wide', onclick: () => send() }, t('journal.send')),
    h('button', { class: 'btn wide', onclick: () => { journal.clear(); toast(t('journal.cleared')); } }, t('journal.clear')));
}

/** The report's text, with today's facts. */
function reportText() {
  const own = [...app.cards.values()].filter((e) => e.rec.mine).length;
  return fullReport({ cards: app.cards.size, own, stub: app.stub, language: language() });
}

/** The report, the device's way: share sheet, clipboard, or a file. */
async function send() {
  const text = await reportText();
  if (navigator.share) {
    try {
      await navigator.share({ title: t('journal.share-title'), text });
      return;
    } catch (e) {
      if (/** @type {any} */ (e)?.name === 'AbortError') return; // the person changed their mind
    }
  }
  try {
    await navigator.clipboard.writeText(text);
    toast(t('journal.copied'));
    return;
  } catch { /* no clipboard here: a file instead */ }
  const a = /** @type {HTMLAnchorElement} */ (h('a', { href: URL.createObjectURL(new Blob([text], { type: 'text/plain' })), download: 'pips-report.txt' }));
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
  toast(t('journal.saved'));
}
