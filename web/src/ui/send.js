// @ts-check
// Sending something out of the app, the device's way: its share sheet (a
// messenger, mail, nearby devices) where there is one, otherwise the
// clipboard for a link and a download for a file. The person changing
// their mind in the share sheet is not a failure.

import { h } from '../dom.js';
import { t } from '../i18n.js';
import { toast } from './shell.js';
import { caught } from '../diagnostics.js';

const aborted = (/** @type {unknown} */ e) => /** @type {any} */ (e)?.name === 'AbortError';

/** @param {string} url @param {string} title @param {string} text */
export async function sendLink(url, title, text) {
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
    toast(t('share.link.copied'));
  } catch (e) {
    caught(e, 'share');
    toast(t('share.link.failed'));
  }
}

/** @param {File} file @param {string} title */
export async function sendFile(file, title) {
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title });
      return;
    } catch (e) {
      if (aborted(e)) return;
    }
  }
  // A download keeps to Latin letters: some browsers drop any other name
  // for a plain «download», with no extension to open it by.
  const a = /** @type {HTMLAnchorElement} */ (h('a', { href: URL.createObjectURL(file), download: latin(file.name) }));
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
  toast(t('share.file.saved', a.download));
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
