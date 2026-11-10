// @ts-check
// A QR scanner: the camera, and "from a picture" for when there is none.
// While the camera is off, the frame itself is the button that turns it
// on: the place where the picture will be is where one reaches for it.
// Every text it reads goes to `onText`; what it means is the caller's, and
// so are repeats of the same text. From web/src/ui/scan.js.

import { h, shake } from '../dom.js';
import { icon } from '../icons.js';
import { t } from '../i18n.js';
import { qrReader } from '../reader.js';
import { envelopeIn } from '../formats/png-card.js';

/** Pictures larger than this are only looked at for a code, not for a card inside (formats/png-card.js keeps one far smaller). */
const MAX_PICTURE = 16 * 1024 * 1024;
/**
 * How often a camera frame is read: the browser's detector is fast; the
 * core's reader is given more time per frame. From web/src/ui/scan.js.
 */
const NATIVE_EVERY_MS = 150;
const CORE_EVERY_MS = 250;

/**
 * @param {object} o
 * @param {(text: string, from: { picture: boolean }) => void} o.onText picture: read from a
 *   picture the person chose, not a camera frame — a choice made again is a new one
 * @param {(envelope: Uint8Array) => void} [o.onEnvelope] a picture from Pips carries its card
 *   inside (formats/png-card.js): taken before any code is read
 * @param {string} [o.hint]
 */
export function scanner({ onText, onEnvelope, hint = t('receive.point') }) {
  const video = /** @type {HTMLVideoElement} */ (h('video', { playsInline: true, muted: true, hidden: true }));
  // Words have two places: inside the frame, under the button, while the
  // camera is off; along the bottom, over the picture, while it is on.
  const label = h('b', {}, t('receive.start'));
  const note = h('small', { 'aria-live': 'polite' }, hint);
  const message = h('p', { hidden: true, 'aria-live': 'polite' }, hint);
  const frame = h('div', { class: 'scan-frame' }, video, h('div', { class: 'scan-corners' }),
    h('button', { type: 'button', class: 'scan-start', onclick: () => start() }, icon('camera'), label, note), message);
  const imageInput = /** @type {HTMLInputElement} */ (h('input', { type: 'file', accept: 'image/*', hidden: true, onchange: () => fromImage() }));
  const imageButton = h('button', { type: 'button', class: 'btn', onclick: () => imageInput.click() }, icon('image'), t('receive.image'));

  /**
   * Tells the person something where the frame has room for it now. What
   * went wrong (`bad`) is coloured, and moves once when it is new — or,
   * with `again`, when the person did something again (a second wrong
   * picture must be seen to be answered). A camera seeing the same wrong
   * code frame after frame does not shake it.
   * @param {string} text @param {boolean} [bad] @param {boolean} [again]
   */
  function say(text, bad = false, again = false) {
    const at = stream ? message : note;
    const fresh = at.textContent !== text || !at.classList.contains('wrong');
    at.textContent = text;
    at.classList.toggle('wrong', bad);
    if (bad && (fresh || again)) shake(at);
  }
  /** @param {boolean} on */
  function live(on) {
    frame.classList.toggle('live', on);
    video.hidden = !on;
    message.hidden = !on;
    message.textContent = note.textContent = hint;
    message.classList.remove('wrong');
    note.classList.remove('wrong');
  }

  /** @type {MediaStream | null} */
  let stream = null;
  let timer = 0;
  let busy = false;
  /** @type {Promise<import('../reader.js').Reader> | null} */
  let reading = null;

  /** The reader, made once; a failure is said, and tried again next time. */
  async function reader() {
    reading ??= qrReader();
    try {
      return await reading;
    } catch {
      reading = null;
      say(t('scan.failed'), true);
      return null;
    }
  }

  // Each start is a turn; stop() ends the turn. A camera granted after its
  // turn ended (the person left the scanner while the browser asked) is
  // switched off at once instead of filming a hidden screen.
  let turn = 0;
  let starting = false;

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
      timer = window.setInterval(async () => {
        if (busy || video.readyState < 2) return;
        busy = true;
        try {
          for (const text of await r.read(video)) onText(text, { picture: false });
        } catch { /* a frame that could not be read: the next one is */ }
        busy = false;
      }, r.native ? NATIVE_EVERY_MS : CORE_EVERY_MS);
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
    if (onEnvelope && f.size <= MAX_PICTURE) {
      const env = envelopeIn(new Uint8Array(await f.arrayBuffer()));
      if (env) return onEnvelope(env);
    }
    const r = await reader();
    if (!r) return;
    // A file the browser cannot open as a picture (damaged, or something
    // else) is told apart from a picture with no code in it.
    const bitmap = await createImageBitmap(f).catch(() => null);
    if (!bitmap) return say(t('scan.unreadable'), true, true);
    /** @type {string[]} */
    let texts = [];
    try {
      texts = await r.read(bitmap);
    } catch {
      // The reader's worker stopped on it: as good as no code found.
    } finally {
      bitmap.close(); // a photo's pixels, freed at once
    }
    if (!texts.length) return say(t('scan.none'), true, true);
    for (const text of texts) onText(text, { picture: true });
  }

  return { frame, imageButton, imageInput, stop, say };
}
