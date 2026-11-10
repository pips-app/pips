// @ts-check
// Receive: the camera reads codes by itself; a picture, a .pips file or a
// pasted link work too. Whatever arrives is checked by the core — every
// signature — before it is kept, and what came of it is said in the same
// words wherever it came from (rules/incoming.js). A card from a link is
// kept only when the person says so (linkArrival). From web/src/ui/receive.js
// and web/src/ui/arrival.js.

import { h, replace } from '../dom.js';
import { icon } from '../icons.js';
import { t } from '../i18n.js';
import { say as sayError } from '../errors.js';
import { MAX_FILE, fileHolds, refusal, sameLook, tally } from '../rules/incoming.js';
import { PUBLISHED, linkBase } from '../formats/links.js';
import { scanner } from './scanner.js';
import { sheet } from './sheet.js';
import { qrCanvas } from './qr.js';

/** @typedef {ReturnType<typeof import('../state.js').createState>} State */
/** @typedef {{ call(op: string, ...args: unknown[]): Promise<any> }} Core */
/** @typedef {import('./shell.js').Tell} Tell */
/** @typedef {import('../rules/incoming.js').Refusal} Refusal */
/** @typedef {import('../rules/incoming.js').FileProblem} FileProblem */

/** The words for why a card was not taken. @type {Record<Exclude<Refusal, 'other' | 'full'>, import('../i18n.js').Key>} */
const REFUSED = {
  newer: 'receive.newer', forged: 'receive.forged',
  damaged_code: 'receive.damaged', damaged_link: 'link.bad', damaged_file: 'receive.file-damaged',
};
/** The words for why a file holds no card. @type {Record<FileProblem, import('../i18n.js').Key>} */
const FILE_PROBLEM = { not_pips: 'receive.not-pips', no_card: 'receive.no-card-in-picture', newer: 'receive.newer', damaged: 'receive.file-damaged' };

/**
 * Why a card was not taken, in words. @param {unknown} e @param {import('../rules/incoming.js').Via} via
 */
function refused(e, via) {
  const r = refusal(e, via);
  return r === 'other' || r === 'full' ? sayError(e) : t(REFUSED[r]);
}

/**
 * What came of keeping a card, in words: a numbered copy over a plain
 * one, a name known here with another key, a card already here.
 * @param {State} app @param {{ status: string, digest: string }} r
 */
export function arrivedWords(app, r) {
  const e = app.cards.get(r.digest);
  const ed = e?.rec.edition;
  if (r.status === 'numbered' && ed) return t('receive.numbered', t('edition.copy.of', ed.edition, ed.of));
  if (r.status !== 'added' || !e) return t(r.status === 'added' ? 'receive.got' : 'receive.dup');
  const note = nameNotes(app, e.card.author, e.author?.hex, e.rec.from)[0];
  return note ? t('receive.got-note', note) : t('receive.got');
}

/**
 * What is to be said about the artist's name and the sender's, against the
 * names here (rules/names.js); the sender only when not the artist.
 * @param {State} app @param {string} author @param {string | undefined} authorKey @param {{ nick: string, key: string } | null} from
 * @returns {string[]}
 */
function nameNotes(app, author, authorKey, from) {
  /** @param {string} name @param {string} hex */
  const note = (name, hex) => {
    const c = app.clashOf(name, hex);
    return !c ? null : c.own ? t('clash.own', name) : t('clash.other', name, c.other);
  };
  const out = [authorKey ? note(author, authorKey) : null, from && from.key !== authorKey ? note(from.nick, from.key) : null];
  return /** @type {string[]} */ (out.filter(Boolean));
}

/** Whether a card from a link waits for the person's answer: one question at a time. */
let asking = false;

/**
 * A card from a link, kept only when the person says so. A scan or a file
 * is their own doing; a link may not be: a page that opened Pips keeps a
 * handle on its window and can change its address as often as it likes,
 * and each change would bring in another card. A link that comes while a
 * question is open is not opened, and that is said.
 * @param {{ app: State, tell: Tell }} o @param {Uint8Array} envelope
 * @returns {Promise<void>}
 */
export async function linkArrival({ app, tell }, envelope) {
  if (asking) return tell(t('link.busy'));
  const seen = await app.peek(envelope);
  // What does not open is refused in its own words.
  if (!seen) return keep({ app, tell }, envelope, 'link');
  asking = true;
  const title = seen.card.title || t('card.untitled');
  const question = [t('link.ask', title, seen.card.author), ...nameNotes(app, seen.card.author, seen.author?.hex, seen.from)].join(' ');
  /** @type {boolean} */
  const yes = await new Promise((answer) => {
    let said = false;
    /** @param {boolean} v */
    const pick = (v) => { said = true; answer(v); s.close(); };
    const s = sheet({ title: t('link.title'), onClose: () => { if (!said) answer(false); } },
      h('p', {}, question),
      h('div', { class: 'row-btns' },
        h('button', { type: 'button', class: 'btn', onclick: () => pick(false) }, t('link.skip')),
        h('button', { type: 'button', class: 'btn key', onclick: () => pick(true) }, t('link.keep'))));
  });
  asking = false;
  if (yes) await keep({ app, tell }, envelope, 'link');
}

/**
 * Opens, checks and keeps one envelope, and says what came of it.
 * @param {{ app: State, tell: Tell }} o @param {Uint8Array} envelope @param {import('../rules/incoming.js').Via} via
 */
async function keep({ app, tell }, envelope, via) {
  try {
    tell(arrivedWords(app, await app.takeEnvelope(envelope)));
  } catch (e) {
    tell(refused(e, via), { wrong: true });
  }
}

/**
 * @param {import('./shell.js').Frame & { core: Core, app: State }} o
 */
export function receive({ root, tell, core, app }) {
  const scan = scanner({ onText: (text, from) => void handle(text, from.picture), onEnvelope: (env) => { scan.stop(); void keep({ app, tell }, env, 'file'); } });
  const bar = h('i', {});
  const progress = h('div', { class: 'recv-progress', hidden: true }, bar);
  const progressText = h('small', { class: 'recv-parts', 'aria-live': 'polite' });
  const fileInput = /** @type {HTMLInputElement} */ (h('input', { type: 'file', accept: '.pips,application/octet-stream,image/png', multiple: true, hidden: true, onchange: () => void fromFiles() }));
  const linkInput = /** @type {HTMLInputElement} */ (h('input', { type: 'url', placeholder: t('receive.paste.placeholder'), autocomplete: 'off', 'aria-label': t('receive.paste.placeholder') }));
  const page = h('main', { class: 'recv' },
    h('h1', {}, t('receive.title')),
    scan.frame,
    h('div', { class: 'recv-progress-wrap' }, progress, progressText),
    h('div', { class: 'row-btns stack recv-btns' }, scan.imageButton, h('button', { type: 'button', class: 'btn', onclick: () => fileInput.click() }, icon('file'), t('receive.file'))),
    h('div', { class: 'row-btns recv-btns' }, h('button', { type: 'button', class: 'btn', onclick: () => void showRecipientCode() }, icon('key'), t('edition.my-code'))),
    h('div', { class: 'field recv-paste' }, linkInput,
      h('button', { type: 'button', class: 'recv-paste-btn', 'aria-label': t('receive.paste'), title: t('receive.paste'), onclick: () => void pasteLink() }, icon('link'))),
    scan.imageInput, fileInput);
  replace(root, page);
  // Leaving the screen turns the camera off: a camera filming a screen no one sees is not left on.
  const leave = new MutationObserver(() => { if (!page.isConnected) { scan.stop(); void core.call('joinReset'); leave.disconnect(); } });
  leave.observe(document.body, { childList: true, subtree: true });

  // Whatever lands in the field is read at once: pasted, or typed and Enter.
  const submit = () => {
    const v = linkInput.value.trim();
    linkInput.value = '';
    if (v) void handle(v, true);
  };
  linkInput.addEventListener('input', (e) => { if (/** @type {InputEvent} */ (e).inputType === 'insertFromPaste') submit(); });
  linkInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });

  /** Straight from the clipboard where the browser allows it; otherwise the field takes focus for a paste by hand. */
  async function pasteLink() {
    try {
      const text = (await navigator.clipboard.readText()).trim();
      if (!text) return tell(t('receive.clipboard-empty'));
      void handle(text, true);
    } catch {
      linkInput.focus();
      tell(t('receive.paste-here'));
    }
  }

  /** The person's recipient code, for an artist to issue them a numbered copy. */
  async function showRecipientCode() {
    try {
      const code = await core.call('recipientCode', app.profile.nick);
      const matrix = await core.call('qrMatrix', code);
      const s = sheet({ title: t('edition.my-code') }, h('p', {}, t('edition.my-code.hint', app.profile.nick)), h('div', { class: 'recv-code' }, qrCanvas(matrix, t('edition.my-code'))),
        h('button', { type: 'button', class: 'btn wide', onclick: () => s.close() }, t('sheet.close')));
    } catch (e) {
      tell(sayError(e), { wrong: true });
    }
  }

  /** @type {{ text: string, at: number } | null} */
  let last = null;

  /** @param {string} text @param {boolean} picked chosen by the person now (a picture, a paste): never a repeat */
  async function handle(text, picked) {
    const now = Date.now();
    if (!picked && sameLook(last, text, now)) return;
    last = { text, at: now };
    // A link to a card, pasted: one cut short on the way is called that, as when it is opened.
    if ([PUBLISHED, linkBase(location)].some((b) => text.startsWith(`${b}#`))) {
      try {
        return await keep({ app, tell }, await core.call('parseLink', text), 'link');
      } catch (e) {
        return tell(refused(e, 'link'), { wrong: true });
      }
    }
    /** @type {any} */
    let s;
    try {
      s = await core.call('classify', text);
    } catch (e) {
      return tell(sayError(e), { wrong: true });
    }
    if (s.kind === 'envelope') return keep({ app, tell }, s.bytes, 'code');
    if (s.kind === 'frame') return frameIn(s.bytes);
    if (s.kind === 'recipient') return tell(t('receive.recipient'));
    if (s.kind === 'paper_key') return tell(t('receive.paper'), { wrong: true });
    scan.say(t('receive.not-pips'), true, picked);
  }

  /** One frame of a carousel: how far it is, or its card once whole. @param {Uint8Array} frame */
  async function frameIn(frame) {
    /** @type {any} */
    let p;
    try {
      p = await core.call('joinFrame', frame);
    } catch (e) {
      return tell(refused(e, 'code'), { wrong: true });
    }
    progress.hidden = false;
    if (p.kind === 'partial') {
      bar.style.setProperty('width', `${(100 * p.have) / p.need}%`);
      progressText.textContent = t('receive.parts', p.have, p.need);
      return;
    }
    progress.hidden = true;
    progressText.textContent = '';
    scan.stop();
    await keep({ app, tell }, p.bytes, 'code');
  }

  /** One file or several, chosen at once: every card in them, each checked alone. */
  async function fromFiles() {
    const files = [...(fileInput.files ?? [])];
    fileInput.value = '';
    if (!files.length) return;
    // One at a time: a dozen large files read together would all sit in memory at once.
    const got = [];
    for (const f of files) got.push(f.size > MAX_FILE ? /** @type {const} */ ({ problem: 'not_pips' }) : fileHolds(new Uint8Array(await f.arrayBuffer())));
    const one = got.length === 1 ? got[0] : null;
    if (one && 'problem' in one) return tell(t(FILE_PROBLEM[one.problem]), { wrong: true });
    if (one && 'payload' in one) {
      // A bare card from before envelopes, refused for what it is, as any
      // file is: it is a Pips file, so «not Pips» would not be true.
      try {
        return tell(arrivedWords(app, await app.addPayload(one.payload)));
      } catch (e) {
        return tell(refused(e, 'file'), { wrong: true });
      }
    }
    // Several files: a bare card from long ago, or a file with nothing in it, counts as not taken.
    const envelopes = got.flatMap((g) => ('envelopes' in g ? g.envelopes : []));
    const failed = got.filter((g) => !('envelopes' in g)).length;
    if (!envelopes.length) return tell(t('receive.not-pips'), { wrong: true });
    scan.stop();
    if (envelopes.length === 1 && !failed) return keep({ app, tell }, envelopes[0], 'file');
    try {
      const { added, had, bad } = tally(await app.takeMany(envelopes));
      tell(t('receive.many', added, had, bad + failed));
    } catch (e) {
      tell(sayError(e), { wrong: true });
    }
  }
}
