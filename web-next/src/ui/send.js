// @ts-check
// Sending something out of the app, the device's way: its share sheet (a
// messenger, mail, nearby devices) where there is one, otherwise the
// clipboard for a link and a download for a file. The person changing
// their mind in the share sheet is not a failure. From web/src/ui/send.js.

import { h } from '../dom.js';
import { t } from '../i18n.js';

/** @typedef {import('./shell.js').Tell} Tell */

const aborted = (/** @type {unknown} */ e) => /** @type {any} */ (e)?.name === 'AbortError';

/** @param {Tell} tell @param {string} url @param {string} title @param {string} text */
export async function sendLink(tell, url, title, text) {
  if (navigator.share) {
    try {
      await navigator.share({ title, text, url });
      return;
    } catch (e) {
      if (aborted(e)) return;
    }
  }
  try {
    await navigator.clipboard.writeText(url);
    tell(t('share.link.copied'));
  } catch {
    // Refused (the page has no permission, or no focus): an answer, told to the person.
    tell(t('share.link.failed'), { wrong: true });
  }
}

/** @param {Tell} tell @param {File} file @param {string} title */
export async function sendFile(tell, file, title) {
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title });
      return;
    } catch (e) {
      if (aborted(e)) return;
    }
  }
  tell(t('share.file.saved', download(file)));
}

/** How long a download's address is kept: the browser has started reading it by then. */
const DOWNLOAD_URL_MS = 10_000;

/**
 * Saves a file as a download; returns the name it got. A download keeps to
 * Latin letters: some browsers drop any other name for a plain «download»,
 * with no extension to open it by. @param {File} file
 */
export function download(file) {
  const a = /** @type {HTMLAnchorElement} */ (h('a', { href: URL.createObjectURL(file), download: latin(file.name), hidden: true }));
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), DOWNLOAD_URL_MS);
  return a.download;
}

/** A name a file system takes: the title without what paths forbid. @param {string} title @param {string} ext */
export function fileName(title, ext) {
  const base = title.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60) || 'pips';
  return `${base}.${ext}`;
}

const CYR = 'а:a б:b в:v г:g д:d е:e ё:yo ж:zh з:z и:i й:y к:k л:l м:m н:n о:o п:p р:r с:s т:t у:u ф:f х:kh ц:ts ч:ch ш:sh щ:shch ъ: ы:y ь: э:e ю:yu я:ya';
const TO_LATIN = new Map(CYR.split(' ').map((p) => /** @type {[string, string]} */ (p.split(':'))));

/** A file name in Latin letters: Cyrillic spelled out, anything else left out. @param {string} name */
export function latin(name) {
  const dot = name.lastIndexOf('.');
  const [base, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ''];
  const out = [...base].map((c) => {
    const l = TO_LATIN.get(c.toLowerCase());
    if (l == null) return /[\x20-\x7e]/.test(c) ? c : '';
    return c === c.toLowerCase() ? l : l.charAt(0).toUpperCase() + l.slice(1);
  }).join('').replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  return `${out || 'pips'}${ext}`;
}
