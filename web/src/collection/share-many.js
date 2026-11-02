// @ts-check
// Sharing the cards chosen in the collection, all at once. A code holds
// one card and a link would be far too long for many, so they go as files:
//
//   - one .pips file with every card in it (bundle.js): opened in Pips
//     (Scan → .pips file), it brings them all, each checked on its own;
//   - a picture of each card (card-picture.js), for a messenger: each
//     carries its card inside, and its code on it when the card fits one.
//
// Each card goes as a copy, exactly as one shared alone would: one's own
// signed by its author, someone else's passed on by this person.

import { h, icon } from '../dom.js';
import { t } from '../i18n.js';
import { app } from '../state.js';
import { bottomSheet } from '../kit/bottom-sheet.js';
import { artCanvas, cardTitle, FRAME_SHADES } from '../ui/card.js';
import { cardPicture } from '../ui/card-picture.js';
import { sendFile, sendFiles, fileName } from '../ui/send.js';
import { toast } from '../ui/shell.js';
import { caught } from '../diagnostics.js';
import { packBundle, MAX_CARDS } from '../bundle.js';
import { copyEnvelope } from './share.js';

/** Pictures are made one by one and sent together: more would be slow to make and heavy to send. */
export const MAX_PICTURES = 20;
/** Small cards shown of what goes. */
const SHOWN = 6;

export function shareManySheet() {
  const sheet = bottomSheet({ label: t('share.many.title', 0) });
  const minis = h('div', { class: 'many-minis', 'aria-hidden': 'true' });
  const fileNote = h('small', {}, t('share.many.file.note'));
  const picNote = h('small', {});
  /** @param {any} ic @param {string} label @param {HTMLElement} note @param {() => Promise<void>} run */
  const way = (ic, label, note, run) => /** @type {HTMLButtonElement} */ (h('button', { type: 'button', class: 'many-way', onclick: () => go(run) },
    icon(ic), h('span', {}, h('b', {}, label), note)));
  const asFile = way('file', t('share.many.file'), fileNote, () => file());
  const asPictures = way('image', t('share.many.pictures'), picNote, () => pictures());
  sheet.body.append(minis, asFile, asPictures);

  /** @type {import('../state.js').Entry[]} */
  let entries = [];
  let busy = false;

  /** Runs one way out; the sheet waits, then goes. @param {() => Promise<void>} run */
  async function go(run) {
    if (busy) return;
    busy = true;
    asFile.disabled = asPictures.disabled = true;
    try {
      await run();
      sheet.close();
    } catch (e) {
      caught(e, 'share');
      toast(t('err.generic'));
    } finally {
      busy = false;
      paint();
    }
  }

  async function file() {
    const bundle = packBundle(entries.map(copyEnvelope));
    const name = t('share.many.name', entries.length);
    await sendFile(new File([bundle], fileName(name, 'pips'), { type: 'application/octet-stream' }), name);
  }

  async function pictures() {
    picNote.textContent = t('share.many.making');
    const files = [];
    for (const e of entries) {
      const png = await cardPicture(e.card, copyEnvelope(e));
      files.push(new File([png], fileName(cardTitle(e.card), 'png'), { type: 'image/png' }));
    }
    await sendFiles(files, t('share.many.name', entries.length));
  }

  function paint() {
    const n = entries.length;
    sheet.retitle(t('share.many.title', n));
    minis.replaceChildren(...entries.slice(0, SHOWN).map((e) => {
      const m = h('div', { class: 'many-mini' }, artCanvas(e.card, e.rec.digest));
      m.style.setProperty('--shade', (FRAME_SHADES[e.card.frame] ?? FRAME_SHADES[0]).paper);
      return m;
    }), n > SHOWN ? h('span', { class: 'many-more' }, `+${n - SHOWN}`) : '');
    asFile.disabled = busy || !n || n > MAX_CARDS;
    asPictures.disabled = busy || !n || n > MAX_PICTURES;
    picNote.textContent = n > MAX_PICTURES ? t('share.many.pictures.max', MAX_PICTURES) : t('share.many.pictures.note');
  }

  return {
    els: sheet.els,
    get open() { return sheet.open; },
    /** @param {string[]} ids the chosen cards, in the order they lie */
    show(ids) {
      entries = ids.map((id) => app.cards.get(id)).filter((e) => e != null).map((e) => /** @type {import('../state.js').Entry} */ (e));
      if (!entries.length) return;
      paint();
      sheet.show();
    },
    close: () => sheet.close(),
  };
}
