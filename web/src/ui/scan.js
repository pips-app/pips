// @ts-check
// A QR scanner: the camera, plus "from a picture" for when there is none.
// While the camera is off, the frame itself is the button that turns it on:
// the place where the picture will be is where one reaches for it.
// Hands every text it reads to `onText`; deciding what it means is the
// caller's job. Repeats of the same text are left for the caller too.

import { h, icon } from '../dom.js';
import { t } from '../i18n.js';
import { qrReader } from '../qrscan.js';

/** @param {(text: string) => void} onText @param {string} [hint] */
export function scanner(onText, hint = t('receive.point')) {
  const video = /** @type {HTMLVideoElement} */ (h('video', { playsInline: true, muted: true, hidden: true }));
  // Words have two places: inside the frame, under the button, while the
  // camera is off; along the bottom, over the picture, while it is on.
  const label = h('b', {}, t('receive.start'));
  const note = h('small', {}, hint);
  const message = h('p', { hidden: true }, hint);
  const frame = h('div', { class: 'scanner' }, video, h('div', { class: 'corners' }),
    h('button', { type: 'button', class: 'scanner-start', onclick: () => start() }, icon('camera'), label, note), message);
  const imageInput = /** @type {HTMLInputElement} */ (h('input', { type: 'file', accept: 'image/*', hidden: true, onchange: () => fromImage() }));
  const el = h('div', {},
    frame,
    h('div', { class: 'group row-btns' },
      h('button', { class: 'btn', onclick: () => imageInput.click() }, icon('image'), t('receive.image'))),
    imageInput);

  /** Tells the person something where the frame has room for it now. @param {string} text */
  const say = (text) => { (stream ? message : note).textContent = text; };
  /** @param {boolean} on */
  const live = (on) => {
    frame.classList.toggle('live', on);
    video.hidden = !on;
    message.hidden = !on;
    message.textContent = note.textContent = hint;
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
      say(t('scan.failed'));
      return null;
    }
  }

  async function start() {
    if (stream) return;
    say(t('scan.loading'));
    const r = await reader();
    if (!r) return;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
    } catch {
      // Refused, or none: the frame says so, and a tap asks again (the
      // permission may have been given in the browser's settings meanwhile).
      label.textContent = t('scan.no-camera');
      say(t('scan.no-camera.how'));
      return;
    }
    label.textContent = t('receive.start');
    video.srcObject = stream;
    live(true);
    await video.play();
    // The browser's detector is fast; ours is given more time per frame.
    timer = window.setInterval(async () => {
      if (busy || video.readyState < 2) return;
      busy = true;
      try {
        for (const text of await r.read(video)) onText(text);
      } catch { /* a frame that could not be read */ }
      busy = false;
    }, r.native ? 150 : 250);
  }

  function stop() {
    clearInterval(timer);
    stream?.getTracks().forEach((tr) => tr.stop());
    stream = null;
    live(false);
  }

  async function fromImage() {
    const f = imageInput.files?.[0];
    imageInput.value = '';
    if (!f) return;
    const r = await reader();
    if (!r) return;
    // A file that is not a picture, or one too big to decode, simply holds no code.
    const texts = await createImageBitmap(f).then((b) => r.read(b)).catch(() => /** @type {string[]} */ ([]));
    if (!texts.length) return say(t('scan.none'));
    for (const text of texts) onText(text);
  }

  return { el, stop, say };
}
