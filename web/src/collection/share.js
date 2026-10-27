// @ts-check
// What the share sheet holds for a card: its code, ready to be scanned,
// and the same envelope as a link, for someone who is not in the room.
// An own card goes out signed by its author, as a plain copy or as a
// numbered one; someone else's card goes out as a copy passed on by you.

import { h, icon } from '../dom.js';
import { t } from '../i18n.js';
import { linkBase } from '../links.js';
import { toast } from '../ui/shell.js';
import { caught } from '../diagnostics.js';
import { app, subscribe } from '../state.js';
import { qrFor, keepAwake, codeSize } from '../ui/qr.js';
import { editionPanel } from '../ui/edition.js';
import { segmented } from '../kit/segmented.js';
import { topSheet } from '../kit/top-sheet.js';
import { FRAME_SHADES } from '../ui/card.js';

/**
 * Fills `body` and returns a function that stops what keeps running
 * (a QR carousel, the screen lock).
 * @param {HTMLElement} body @param {import('../state.js').Entry} entry
 */
export function fillShare(body, entry) {
  let stop = () => {};
  let release = () => {};
  keepAwake().then((r) => (release = r));
  // The code area keeps one height whether it shows a code or the
  // numbered-copy panel, so switching between them does not jump.
  const size = codeSize();
  const code = h('div', { class: 'share-code' });
  code.style.height = `${size + 28 + 72 + 44}px`; // + the link button

  /** @param {Uint8Array} env @param {string} note */
  const showCode = (env, note) => {
    stop();
    const q = qrFor(env, size);
    stop = q.stop;
    code.replaceChildren(q.el,
      h('p', {}, note),
      h('p', { class: 'small' }, q.plan.kind === 'single' ? t('give.single', env.length) : t('give.carousel', q.plan.fragments)),
      h('button', { type: 'button', class: 'share-link', onclick: () => sendLink(env, entry.card.title) }, icon('link'), t('share.link')));
  };
  const copy = () => showCode(app.identity.sealAsAuthor(entry.rec.payload, undefined), t('share.hint'));

  const title = h('b', {}, entry.card.title || '—');
  if (entry.rec.mine) {
    const mode = segmented({
      label: t('share.title'), value: 'copy',
      options: [{ value: 'copy', label: t('give.mode.copy') }, { value: 'edition', label: t('give.mode.edition') }],
      onChange: (v) => {
        if (v === 'copy') return copy();
        stop();
        // The panel shows the issue log: drawn again whenever a copy is issued.
        const draw = () => code.replaceChildren(editionPanel(entry.rec.digest));
        draw();
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
 * The envelope as a link, the device's way: its share sheet (a messenger),
 * else the clipboard. Links point at this app (or the published one, when
 * this one is not on https), with the card after '#'.
 * @param {Uint8Array} env @param {string} title
 */
async function sendLink(env, title) {
  const url = app.core.cardLink(linkBase(location), env);
  if (navigator.share) {
    try {
      await navigator.share({ title: title || 'Pips', text: t('share.link.text', title || '—'), url });
      return;
    } catch (e) {
      if (/** @type {any} */ (e)?.name === 'AbortError') return; // the person changed their mind
    }
  }
  try {
    await navigator.clipboard.writeText(url);
    toast(t('share.link.copied'));
  } catch (e) {
    caught(e, 'share');
    toast(t('share.link.failed'));
  }
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
