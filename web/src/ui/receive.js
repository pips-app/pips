// @ts-check
// Receive: the camera reads codes by itself; a picture, a .pips file or a
// pasted link work too. Whatever arrives is verified by the core before it
// is stored, and nothing needs confirming.

import { h, icon } from '../dom.js';
import { t } from '../i18n.js';
import { app, receive, receivePayload } from '../state.js';
import { toast } from './shell.js';
import { scanner } from './scan.js';
import { caught } from '../diagnostics.js';
import { showRecipientCode } from './edition.js';
import { FORGED, arrived, arrive, arriveMany } from './arrival.js';
import { MAGIC } from '../links.js';
import { isPng, envelopeIn } from '../png-card.js';
import { isBundle, unpackBundle } from '../bundle.js';

/** The first byte of an envelope (pips-wasm). */
const ENVELOPE = 0x45; // 'E'
/** Larger than any file of cards (a thousand of them at most, bundle.js). */
const MAX_FILE = 16 * 1024 * 1024;

export function receiveView() {
  const scan = scanner((text, from) => handle(text, from.picture), undefined, { onEnvelope: (env) => { stopCamera(); arrive(env); } });
  const bar = h('i');
  const progress = h('div', { class: 'progress', hidden: true }, bar);
  const fileInput = /** @type {HTMLInputElement} */ (h('input', { type: 'file', accept: '.pips,application/octet-stream,image/png', multiple: true, hidden: true, onchange: () => fromFile() }));
  const linkInput = /** @type {HTMLInputElement} */ (h('input', { type: 'url', placeholder: t('receive.paste.placeholder'), autocomplete: 'off' }));
  const progressText = h('small', {});
  const el = h('section', { class: 'view' },
    h('div', { class: 'bar' }, h('div', { class: 'title' }, h('h1', {}, t('receive.title')))),
    h('div', { class: 'scroll' },
      scan.el,
      h('div', { class: 'progress-wrap' }, progress, progressText),
      h('div', { class: 'group row-btns' },
        h('button', { class: 'btn', onclick: () => fileInput.click() }, icon('file'), t('receive.file')),
        h('button', { class: 'btn', onclick: () => showRecipientCode() }, icon('key'), t('edition.my-code'))),
      h('div', { class: 'group' },
        h('div', { class: 'field' },
          linkInput,
          h('button', { class: 'icon-btn field-btn', 'aria-label': t('receive.paste'), title: t('receive.paste'), onclick: () => pasteLink() }, icon('link')))),
      fileInput));

  // Whatever lands in the field is read at once: pasted, or typed and Enter.
  const submit = () => {
    const v = linkInput.value.trim();
    linkInput.value = '';
    if (v) handle(v, true);
  };
  // A paste is read once it is in the field.
  linkInput.addEventListener('input', (e) => { if (/** @type {InputEvent} */ (e).inputType === 'insertFromPaste') submit(); });
  linkInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });

  /** The chain button: straight from the clipboard where the browser allows
   * it; otherwise the field takes focus for a manual paste. */
  async function pasteLink() {
    try {
      const text = (await navigator.clipboard.readText()).trim();
      if (!text) return toast(t('receive.clipboard-empty'));
      handle(text, true);
    } catch {
      linkInput.focus();
      toast(t('receive.paste-here'));
    }
  }

  /** @type {any} */
  let joiner = null;
  let lastText = '';
  let lastAt = 0;
  const stopCamera = () => scan.stop();

  /**
   * What one file holds: envelopes (a card's picture, a .pips file of one
   * card or of several), a bare card from before envelopes, or why nothing.
   * @param {File} f @returns {Promise<{envelopes: Uint8Array[]} | {payload: Uint8Array} | {problem: string}>}
   */
  async function read(f) {
    if (f.size > MAX_FILE) return { problem: 'receive.not-pips' };
    const bytes = new Uint8Array(await f.arrayBuffer());
    // A picture of a card from Pips holds the card itself.
    if (isPng(bytes)) {
      const env = envelopeIn(bytes);
      return env ? { envelopes: [env] } : { problem: 'receive.no-card-in-picture' };
    }
    if (isBundle(bytes)) {
      const all = unpackBundle(bytes);
      return all ? { envelopes: all } : { problem: 'receive.file-damaged' };
    }
    if (bytes.length > 70 * 1024 || !MAGIC.every((b, i) => bytes[i] === b)) return { problem: 'receive.not-pips' };
    const body = bytes.subarray(MAGIC.length);
    // A file holds what a code holds — an envelope, every signature in it
    // checked — or, from before envelopes, a bare signed card.
    return body[0] === ENVELOPE ? { envelopes: [body] } : { payload: body };
  }

  /** One file or several, chosen at once: every card in them, each checked alone. */
  async function fromFile() {
    const files = [...(fileInput.files ?? [])];
    fileInput.value = '';
    if (!files.length) return;
    // One at a time: a dozen large files read together would all sit in memory at once.
    const got = [];
    for (const f of files) got.push(await read(f));
    const one = got.length === 1 ? got[0] : null;
    if (one && 'problem' in one) return toast(t(one.problem));
    if (one && 'payload' in one) {
      // A bare card from before envelopes, refused for what it is, as any
      // file is: it is a Pips file, so «not Pips» would not be true.
      try {
        done(await receivePayload(one.payload));
      } catch (e) {
        caught(e, 'receive');
        const code = /** @type {any} */ (e)?.code;
        toast(t(/** @type {any} */ (e)?.name === 'QuotaExceededError' ? 'err.storage-full' : FORGED.has(code) ? 'receive.forged' : 'receive.file-damaged'));
      }
      return;
    }
    // Several files: a bare card from long ago, or a file with nothing in it, counts as not taken.
    const envelopes = got.flatMap((g) => ('envelopes' in g ? g.envelopes : []));
    const failed = got.filter((g) => !('envelopes' in g)).length;
    if (!envelopes.length) return toast(t('receive.not-pips'));
    stopCamera();
    await arriveMany(envelopes, failed);
  }

  /** @param {string} text */
  /** @param {string} text @param {boolean} [picked] chosen by the person now (a picture, a paste): never a repeat */
  async function handle(text, picked = false) {
    // A camera sees the same code many times a second; a picture chosen
    // again is chosen on purpose, and answered again.
    const now = Date.now();
    if (!picked && text === lastText && now - lastAt < 2500) return;
    lastText = text;
    lastAt = now;

    let looksPips = false;
    try {
      const s = app.core.classify(text);
      looksPips = s.kind === 'envelope' || s.kind === 'frame';
      if (s.kind === 'envelope') return await accept(s.bytes);
      if (s.kind === 'frame') {
        joiner ??= new app.core.Joiner();
        let p;
        try {
          p = joiner.push(s.bytes);
        } catch {
          joiner = new app.core.Joiner(); // a different carousel: start over with it
          p = joiner.push(s.bytes);
        }
        progress.hidden = false;
        if (p.kind === 'partial') {
          bar.style.width = `${(100 * p.have) / p.need}%`;
          progressText.textContent = t('receive.parts', p.have, p.need);
          return;
        }
        joiner = null;
        progress.hidden = true;
        progressText.textContent = '';
        return await accept(p.bytes);
      }
      if (s.kind === 'recipient') return toast(t('receive.recipient'));
      if (s.kind === 'paper_key') return toast(t('receive.paper'));
      toast(t('receive.not-pips'));
    } catch (e) {
      // A damaged or forged code lands here: openEnvelope checks every signature.
      caught(e, 'receive');
      const code = /** @type {any} */ (e)?.code;
      toast(t(FORGED.has(code) ? 'receive.forged' : looksPips ? 'receive.damaged' : 'receive.not-pips'));
    }
  }

  /** @param {Uint8Array} envelope */
  async function accept(envelope) {
    const opened = app.core.openEnvelope(envelope); // throws unless every signature checks out
    done(await receive(opened));
  }

  /** @param {{status: string, digest: string}} r */
  function done(r) {
    stopCamera();
    arrived(r); // it opens large in the collection, where it now is
  }

  return { el, hide: stopCamera };
}
