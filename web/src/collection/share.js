// @ts-check
// What the share sheet holds for a card: its code, ready to be scanned,
// and the ways for someone who is not in the room — the same envelope as
// a link, as a .pips file, or as a picture of the card that carries it
// (card-picture.js): its code drawn on it, the envelope inside.
// An own card goes out signed by its author, as a plain copy or as a
// numbered one; someone else's card goes out as a copy passed on by you.

import { h, icon } from '../dom.js';
import { t } from '../i18n.js';
import { linkBase, MAGIC } from '../links.js';
import { sendLink, sendFile, fileName } from '../ui/send.js';
import { cardPicture } from '../ui/card-picture.js';
import { toast } from '../ui/shell.js';
import { caught } from '../diagnostics.js';
import { app, subscribe } from '../state.js';
import { qrFor, keepAwake, codeSize } from '../ui/qr.js';
import { editionPanel } from '../ui/edition.js';
import { segmented } from '../kit/segmented.js';
import { topSheet } from '../kit/top-sheet.js';
import { FRAME_SHADES, cardTitle } from '../ui/card.js';

/**
 * Fills `body` and returns a function that stops what keeps running
 * (a QR carousel, the screen lock).
 * @param {HTMLElement} body @param {import('../state.js').Entry} entry
 * @param {{size?: number, hint?: string}} [o] size: the code's side; hint: what to
 * do with it — both where the room and the gesture are not the sheet's
 */
export function fillShare(body, entry, o = {}) {
  const size = o.size ?? codeSize();
  let stop = () => {};
  let release = () => {};
  keepAwake().then((r) => (release = r));
  // The code area is as tall as the code with its notes and ways: the
  // numbered-copy panel lies over it, in the same place, so switching
  // between them does not jump (and the code stays laid out under it).
  const face = h('div', { class: 'share-face' });
  const over = h('div', { class: 'share-over', hidden: true });
  const code = h('div', { class: 'share-code' }, face, over);

  /** @param {Uint8Array} env @param {string} note */
  const showCode = (env, note) => {
    stop();
    const q = qrFor(env, size);
    stop = q.stop;
    over.hidden = true;
    over.replaceChildren();
    face.classList.remove('under');
    face.replaceChildren(q.el,
      h('p', {}, note),
      h('p', { class: 'small' }, q.plan.kind === 'single' ? t('give.single', env.length) : t('give.carousel', q.plan.fragments)),
      ways(env));
  };
  const name = cardTitle(entry.card);
  /** @param {Uint8Array} env */
  const ways = (env) => h('div', { class: 'share-ways', role: 'group', 'aria-label': t('share.ways') },
    h('button', { type: 'button', class: 'share-link', onclick: () => sendLink(app.core.cardLink(linkBase(location), env), name, t('share.link.text', name)) }, icon('link'), t('share.link')),
    h('button', { type: 'button', class: 'share-link', onclick: () => sendFile(new File([new Uint8Array([...MAGIC, ...env])], fileName(name, 'pips'), { type: 'application/octet-stream' }), name) }, icon('file'), t('share.file')),
    h('button', { type: 'button', class: 'share-link', onclick: () => picture(env) }, icon('image'), t('share.png')));
  /** @param {Uint8Array} env */
  const picture = async (env) => {
    try {
      await sendFile(new File([await cardPicture(entry.card, env)], fileName(name, 'png'), { type: 'image/png' }), name);
    } catch (e) {
      caught(e, 'share');
      toast(t('err.generic'));
    }
  };
  const copy = () => showCode(app.identity.sealAsAuthor(entry.rec.payload, undefined), o.hint ?? t('share.hint'));

  const title = h('b', {}, name);
  if (entry.rec.mine) {
    const mode = segmented({
      label: t('share.title'), value: 'copy',
      options: [{ value: 'copy', label: t('give.mode.copy') }, { value: 'edition', label: t('give.mode.edition') }],
      onChange: (v) => {
        if (v === 'copy') return copy();
        stop();
        // The panel shows the issue log: drawn again whenever a copy is issued.
        const draw = () => over.replaceChildren(editionPanel(entry.rec.digest));
        draw();
        over.hidden = false;
        face.classList.add('under');
        const unsub = subscribe(draw);
        stop = () => { unsub(); };
      },
    });
    body.replaceChildren(title, mode.el, code);
    copy();
  } else {
    body.replaceChildren(title, code);
    showCode(app.identity.sealAsSender(entry.rec.payload, app.profile.nick || 'pips'), t('give.copy-of', entry.card.author ? `@${entry.card.author}` : '—'));
  }
  return () => { stop(); release(); };
}

/**
 * The sheet itself: filled as soon as a card is lifted (so the code is
 * ready when it comes down), opened for good, or let go.
 * @param {{busy: {n: number}, closed: () => void}} o
 * busy: held while the sheet is open; closed: after it went away.
 */
export function createShareSheet(o) {
  /** @type {null | (() => void)} */
  let stop = null;
  /** @type {string|null} */
  let of = null;
  const sheet = topSheet({
    label: t('share.title'),
    onClose: () => {
      stop?.();
      stop = null;
      of = null;
      o.busy.n--; // taken in show(): the sheet calls this only after it was open
      o.closed();
    },
  });
  const api = {
    els: sheet.els,
    get open() { return sheet.open; },
    /** @param {number} f @param {boolean} [anim] */
    follow: (f, anim) => sheet.follow(f, anim),
    close: () => sheet.close(),
    /** @param {string} id */
    prepare(id) {
      if (of === id) return;
      const e = app.cards.get(id);
      if (!e) return;
      api.drop();
      of = id;
      sheet.paint(FRAME_SHADES[e.card.frame] ?? FRAME_SHADES[0]);
      stop = fillShare(sheet.body, e);
    },
    /** Lets go of a code that was only being looked at. */
    drop() {
      if (sheet.open) return;
      stop?.();
      stop = null;
      of = null;
    },
    /** @param {string} id */
    show(id) {
      if (sheet.open) return;
      api.prepare(id);
      o.busy.n++;
      sheet.show();
    },
  };
  return api;
}
