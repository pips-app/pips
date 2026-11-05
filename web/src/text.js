// @ts-check
// Text as cards and nicknames take it: the core's rule (pips_format::text),
// applied to what is typed so that the core never has to refuse it.
//
// Refused: control characters, and characters that are invisible or reorder
// the text around them (a right-to-left override, a zero-width space…). The
// few that writing needs stay where it needs them: joiners between emoji or
// between Arabic or Indic letters, variation selectors after an emoji, tags
// in a flag. The lists are the core's, written out the same way rather than
// read from the browser's Unicode tables, so that the app and every core
// agree on every character; tests/unit/text.test.mjs checks them against
// crates/pips-format/tests/data/plain-text.txt.

/**
 * The format's text limits (pips_format::limits): title and names in
 * characters, the same for every script; handle and link in bytes, being
 * addresses. A unit test reads them from the Rust source.
 */
export const LIMITS = Object.freeze({ title: 32, name: 24, handle: 48, link: 64 });

const ZWNJ = 0x200c, ZWJ = 0x200d, VS15 = 0xfe0e, VS16 = 0xfe0f;
const BLACK_FLAG = 0x1f3f4, CANCEL_TAG = 0xe007f;
/** Letters and digits in a flag's tags: subdivision codes are two to six. */
const FLAG_TAGS = { min: 2, max: 6 };

/**
 * Whether `c` is in one of `ranges`, given as [first, last] pairs.
 * @param {number[]} ranges @returns {(c: number) => boolean}
 */
const among = (ranges) => (c) => {
  for (let i = 0; i < ranges.length; i += 2) if (c >= ranges[i] && c <= ranges[i + 1]) return true;
  return false;
};

// The core's lists (crates/pips-format/src/text.rs), in the same order.
const control = among([0x0, 0x1f, 0x7f, 0x9f]);
const hidden = among([
  0xad, 0xad, 0x34f, 0x34f, 0x600, 0x605, 0x61c, 0x61c, 0x6dd, 0x6dd, 0x70f, 0x70f, 0x890, 0x891,
  0x8e2, 0x8e2, 0x115f, 0x115f, 0x1160, 0x1160, 0x17b4, 0x17b4, 0x17b5, 0x17b5, 0x180b, 0x180f,
  0x200b, 0x200b, 0x200e, 0x200f, 0x2028, 0x202e, 0x2060, 0x206f,
  0x2800, 0x2800, 0x3164, 0x3164, 0xfe00, 0xfe0d, 0xfeff, 0xfeff, 0xffa0, 0xffa0, 0xfff9, 0xfffb,
  0x110bd, 0x110bd, 0x110cd, 0x110cd, 0x13430, 0x1343f, 0x1bca0, 0x1bca3,
  0x1d173, 0x1d17a, 0xe0000, 0xe001f, 0xe0080, 0xe0fff,
]);
const tag = among([0xe0020, 0xe007f]);
const flagTag = among([0xe0030, 0xe0039, 0xe0061, 0xe007a]);
const emoji = among([
  0xa9, 0xa9, 0xae, 0xae, 0x203c, 0x203c, 0x2049, 0x2049, 0x2122, 0x2122, 0x2139, 0x2139, 0x2190, 0x2bff,
  0x3030, 0x3030, 0x303d, 0x303d, 0x3297, 0x3297, 0x3299, 0x3299, 0x1f000, 0x1faff,
]);
const script = among([0x600, 0x6ff, 0x750, 0x77f, 0x8a0, 0x8ff, 0x900, 0xdff, 0xfb50, 0xfdff, 0xfe70, 0xfefc]);
/** @param {number} c */
const joiningScript = (c) => !hidden(c) && script(c);
/** @param {number} c */
const emojiEnd = (c) => emoji(c) || c === VS16;
/** @param {number} c */
const selectable = (c) => emoji(c) || (c >= 0x30 && c <= 0x39) || c === 0x23 || c === 0x2a;
/** @param {number} prev @param {number} joiner @param {number} next */
const joins = (prev, joiner, next) => (joiningScript(prev) && joiningScript(next)) || (joiner === ZWJ && emojiEnd(prev) && emoji(next));

/**
 * `s` with what the core would refuse taken out, in one pass — not trimmed,
 * so that a space typed between words stays while typing. A joiner whose
 * neighbour goes stays only if what comes next can be joined to; a joiner
 * at the end goes, as the core would refuse it there. @param {string} s
 */
export function plainText(s) {
  const cs = Array.from(s, (ch) => /** @type {number} */ (ch.codePointAt(0)));
  /** @type {number[]} */
  const out = [];
  /** A joiner waiting for what comes after it. @type {number|null} */
  let joiner = null;
  for (let i = 0; i < cs.length; i++) {
    const c = cs[i];
    const prev = out.length ? out[out.length - 1] : -1;
    if (control(c) || hidden(c) || tag(c)) continue;
    if (c === ZWJ || c === ZWNJ) {
      // Kept back until what follows shows whether it joins; a second in a
      // row takes the place of the first, as they cannot both join.
      joiner = out.length && (joiningScript(prev) || (c === ZWJ && emojiEnd(prev))) ? c : null;
      continue;
    }
    if (joiner !== null) {
      if (joins(prev, joiner, c)) out.push(joiner);
      joiner = null;
    }
    if ((c === VS15 || c === VS16) && !selectable(out.length ? out[out.length - 1] : -1)) continue;
    out.push(c);
    if (c === BLACK_FLAG) {
      // A flag's tags are taken whole, or the flag stays bare.
      let n = 0;
      while (flagTag(cs[i + 1 + n] ?? -1)) n++;
      if (cs[i + 1 + n] === CANCEL_TAG && n >= FLAG_TAGS.min && n <= FLAG_TAGS.max) {
        out.push(...cs.slice(i + 1, i + 2 + n));
        i += n + 1;
      }
    }
  }
  return out.map((c) => String.fromCodePoint(c)).join('');
}

/** The first `max` characters of `s` (characters, not UTF-16 units). @param {string} s @param {number} max */
export const fitChars = (s, max) => Array.from(s).slice(0, max).join('');
