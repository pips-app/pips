// @ts-check
// A QR scanner: the camera, plus "from a picture" for when there is none.
// While the camera is off, the frame itself is the button that turns it on:
// the place where the picture will be is where one reaches for it.
// Hands every text it reads to `onText`; deciding what it means is the
// caller's job. Repeats of the same text are left for the caller too.

import { h, icon, shake } from '../dom.js';
import { t } from '../i18n.js';
import { qrReader } from '../qrscan.js';
import { envelopeIn } from '../png-card.js';

/** Pictures larger than this are only looked at for a code. */
const MAX_PICTURE = 16 * 1024 * 1024;

/**
 * @param {(text: string, from: {picture: boolean}) => void} onText picture:
 * read from a picture the person chose, not a camera frame — said once, and
 * a choice made again is a new one @param {string} [hint]
 * @param {{onEnvelope?: (envelope: Uint8Array) => void}} [o] onEnvelope: a picture
 * from Pips carries its card inside (png-card.js): taken before any code is read
 */
export function scanner(onText, hint = t('receive.point'), o = {}) {
  const video = /** @type {HTMLVideoElement} */ (h('video', { playsInline: true, muted: true, hidden: true }));
  // Words have two places: inside the frame, under the button, while the
  // camera is off; along the bottom, over the picture, while it is on.
  const label = h('b', {}, t('receive.start'));
  const note = h('small', { 'aria-live': 'polite' }, hint);
  const message = h('p', { hidden: true, 'aria-live': 'polite' }, hint);
  const frame = h('div', { class: 'scanner' }, video, h('div', { class: 'corners' }),
    h('button', { type: 'button', class: 'scanner-start', onclick: () => start() }, icon('camera'), label, note), message);
  const imageInput = /** @type {HTMLInputElement} */ (h('input', { type: 'file', accept: 'image/*', hidden: true, onchange: () => fromImage() }));
  const el = h('div', {},
    frame,
    h('div', { class: 'group row-btns' },
      h('button', { class: 'btn', onclick: () => imageInput.click() }, icon('image'), t('receive.image'))),
    imageInput);

  /**
   * Tells the person something where the frame has room for it now. What
   * went wrong (`bad`) is coloured, and moves once when it is new — or,
   * with `again`, when the person did something again (a second wrong
   * picture must be seen to be answered). A camera seeing the same wrong
   * code frame after frame does not shake it.
   * @param {string} text @param {boolean} [bad] @param {boolean} [again]
   */
  const say = (text, bad = false, again = false) => {
    const at = stream ? message : note;
    const fresh = at.textContent !== text || !at.classList.contains('bad');
    at.textContent = text;
    at.classList.toggle('bad', bad);
    if (bad && (fresh || again)) shake(at);
  };
  /** @param {boolean} on */
  const live = (on) => {
    frame.classList.toggle('live', on);
    video.hidden = !on;
    message.hidden = !on;
    message.textContent = note.textContent = hint;
    message.classList.remove('bad');
    note.classList.remove('bad');
  };

  /** @type {MediaStream|null} */
  let stream = null;
  let timer = 0;
  let busy = false;

  /** @returns {Promise<import('../qrscan.js').Reader|null>} */
  async function reader() {
    try {
      return await qrReader();
    } catch {
      say(t('scan.failed'), true);
      return null;
    }
  }

  // Each start is a turn; stop() ends the turn. A camera granted after its
  // turn ended (the person left the scanner while the browser asked) is
  // switched off at once instead of filming a hidden screen.
  let turn = 0, starting = false;

  async function start() {
    if (stream || starting) return;
    const mine = ++turn;
    starting = true;
    try {
      say(t('scan.loading'));
      const r = await reader();
      if (!r || mine !== turn) return;
      /** @type {MediaStream} */
      let s;
      try {
        s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
      } catch {
        if (mine !== turn) return;
        // Refused, or none: the frame says so, and a tap asks again (the
        // permission may have been given in the browser's settings meanwhile).
        label.textContent = t('scan.no-camera');
        say(t('scan.no-camera.how'), true);
        return;
      }
      if (mine !== turn) { s.getTracks().forEach((tr) => tr.stop()); return; }
      stream = s;
      // The camera taken away while it films (another app, a revoked
      // permission, a cable): stopped and said, not a frozen picture read on.
      for (const tr of s.getVideoTracks()) tr.addEventListener('ended', () => { if (stream === s) { stop(); say(t('scan.camera-lost'), true); } });
      label.textContent = t('receive.start');
      video.srcObject = stream;
      live(true);
      // Stopped while starting to play: nothing to report.
      await video.play().catch(() => {});
      if (mine !== turn) return;
      // The browser's detector is fast; ours is given more time per frame.
      timer = window.setInterval(async () => {
        if (busy || video.readyState < 2) return;
        busy = true;
        try {
          for (const text of await r.read(video)) onText(text, { picture: false });
        } catch { /* a frame that could not be read */ }
        busy = false;
      }, r.native ? 150 : 250);
    } finally {
      if (mine === turn) starting = false;
    }
  }

  function stop() {
    turn++;
    starting = false;
    clearInterval(timer);
    stream?.getTracks().forEach((tr) => tr.stop());
    stream = null;
    video.srcObject = null;
    live(false);
  }

  async function fromImage() {
    const f = imageInput.files?.[0];
    imageInput.value = '';
    if (!f) return;
    if (o.onEnvelope && f.size <= MAX_PICTURE) {
      const env = envelopeIn(new Uint8Array(await f.arrayBuffer()));
      if (env) return o.onEnvelope(env);
    }
    const r = await reader();
    if (!r) return;
    // A file the browser cannot open as a picture (damaged, or something
    // else) is told apart from a picture with no code in it.
    const bitmap = await createImageBitmap(f).catch(() => null);
    if (!bitmap) return say(t('scan.unreadable'), true, true);
    let texts;
    try {
      texts = await r.read(bitmap);
    } finally {
      bitmap.close(); // a photo's pixels, freed at once
    }
    if (!texts.length) return say(t('scan.none'), true, true);
    for (const text of texts) onText(text, { picture: true });
  }

  return { el, stop, say };
}
