// @ts-check
// A QR scanner: the camera, plus "from a picture" for when there is none.
// While the camera is off, the frame itself is the button that turns it on:
// the place where the picture will be is where one reaches for it.
// Hands every text it reads to `onText`; deciding what it means is the
// caller's job. Repeats of the same text are left for the caller too.

import { h, icon } from '../dom.js';
import { t } from '../i18n.js';
import { qrReader } from '../qrscan.js';
import { envelopeIn } from '../png-card.js';

/** Pictures larger than this are only looked at for a code. */
const MAX_PICTURE = 16 * 1024 * 1024;

/**
 * @param {(text: string) => void} onText @param {string} [hint]
 * @param {{onEnvelope?: (envelope: Uint8Array) => void}} [o] onEnvelope: a picture
 * from Pips carries its card inside (png-card.js): taken before any code is read
 */
export function scanner(onText, hint = t('receive.point'), o = {}) {
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
        say(t('scan.no-camera.how'));
        return;
      }
      if (mine !== turn) { s.getTracks().forEach((tr) => tr.stop()); return; }
      stream = s;
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
          for (const text of await r.read(video)) onText(text);
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
    // A file that is not a picture, or one too big to decode, simply holds no code.
    const texts = await createImageBitmap(f).then(async (b) => {
      try { return await r.read(b); } finally { b.close(); } // a photo's pixels, freed at once
    }).catch(() => /** @type {string[]} */ ([]));
    if (!texts.length) return say(t('scan.none'));
    for (const text of texts) onText(text);
  }

  return { el, stop, say };
}
