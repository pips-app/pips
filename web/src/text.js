// @ts-check
// Text as cards and nicknames take it: the core's rule (pips_format::text),
// applied to what is typed so that the core never has to refuse it.
//
// Refused: control characters, and characters that are invisible or reorder
// the text around them (a right-to-left override, a zero-width space…). The
// few that writing needs stay where it needs them (see the core's module):
// joiners between emoji, between Arabic, Indic or Myanmar letters, after a
// virama; selectors after an emoji or in a keycap, Mongolian ones after a
// Mongolian letter; tags in a flag. The lists are the core's, written out
// the same way rather than read from the browser's Unicode tables, so that
// the app and every core agree on every character; tests/unit/text.test.mjs
// checks them against crates/pips-format/tests/data/plain-text.txt.

/**
 * The format's text limits (pips_format::limits): title and names in
 * characters, the same for every script; handle and link in bytes, being
 * addresses. A unit test reads them from the Rust source.
 */
export const LIMITS = Object.freeze({ title: 32, name: 24, handle: 48, link: 64 });

const ZWNJ = 0x200c, ZWJ = 0x200d, MVS = 0x180e, VS15 = 0xfe0e, VS16 = 0xfe0f, KEYCAP = 0x20e3;
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
  0x8e2, 0x8e2, 0x115f, 0x115f, 0x1160, 0x1160, 0x17b4, 0x17b4, 0x17b5, 0x17b5,
  0x200b, 0x200b, 0x200e, 0x200f, 0x2028, 0x202e, 0x2060, 0x206f,
  0x2800, 0x2800, 0x3164, 0x3164, 0xfe00, 0xfe0d, 0xfeff, 0xfeff, 0xffa0, 0xffa0, 0xfff0, 0xfffb,
  0x110bd, 0x110bd, 0x110cd, 0x110cd, 0x13430, 0x1343f, 0x1bca0, 0x1bca3,
  0x1d173, 0x1d17a, 0xe0000, 0xe001f, 0xe0080, 0xe0fff,
]);
const tag = among([0xe0020, 0xe007f]);
const flagTag = among([0xe0030, 0xe0039, 0xe0061, 0xe007a]);
const emoji = among([
  0xa9, 0xa9, 0xae, 0xae, 0x203c, 0x203c, 0x2049, 0x2049, 0x2122, 0x2122, 0x2139, 0x2139, 0x2194, 0x2199,
  0x21a9, 0x21aa, 0x231a, 0x231b, 0x2328, 0x2328, 0x23cf, 0x23cf, 0x23e9, 0x23f3,
  0x23f8, 0x23fa, 0x24c2, 0x24c2, 0x25aa, 0x25ab, 0x25b6, 0x25b6, 0x25c0, 0x25c0,
  0x25fb, 0x25fe, 0x2600, 0x27bf, 0x2934, 0x2935, 0x2b05, 0x2b07,
  0x2b1b, 0x2b1c, 0x2b50, 0x2b50, 0x2b55, 0x2b55, 0x3030, 0x3030, 0x303d, 0x303d, 0x3297, 0x3297, 0x3299, 0x3299,
  0x1f000, 0x1faff,
]);
/** @param {number} c */
const emojiEnd = (c) => emoji(c) || c === VS16;
const script = among([0x600, 0x6ff, 0x750, 0x77f, 0x8a0, 0x8ff, 0x900, 0xdff, 0x1000, 0x109f, 0xfb50, 0xfdff, 0xfe70, 0xfefc]);
/** @param {number} c */
const joiningScript = (c) => !hidden(c) && script(c);
const virama = among([0x94d, 0x94d, 0x9cd, 0x9cd, 0xa4d, 0xa4d, 0xacd, 0xacd, 0xb4d, 0xb4d, 0xbcd, 0xbcd, 0xc4d, 0xc4d, 0xccd, 0xccd, 0xd4d, 0xd4d, 0xdca, 0xdca]);
const mongolian = among([0x1820, 0x1878, 0x1880, 0x18aa]);
const keycapBase = among([0x30, 0x39, 0x23, 0x23, 0x2a, 0x2a]);
const mongolianSelector = among([0x180b, 0x180d, 0x180f, 0x180f]);
const surrogate = among([0xd800, 0xdfff]);

/**
 * Whether a joiner (or the Mongolian vowel separator) may stand between
 * `prev` and `next`; `next` null: the end of the text.
 * @param {number} prev @param {number} joiner @param {number|null} next
 */
function joins(prev, joiner, next) {
  const both = next !== null && joiningScript(prev) && joiningScript(next);
  if (joiner === ZWJ) return both || virama(prev) || (emojiEnd(prev) && next !== null && emoji(next));
  if (joiner === ZWNJ) return both;
  return mongolian(prev) && next !== null && mongolian(next);
}

/**
 * Whether a joiner after `prev` could still join, once the next character
 * is typed. @param {number} prev @param {number} joiner
 */
const opens = (prev, joiner) =>
  joiner === MVS ? mongolian(prev) : joiningScript(prev) || (joiner === ZWJ && (virama(prev) || emojiEnd(prev)));

/**
 * `s` with what the core would refuse taken out, in one pass. Not trimmed,
 * so that a space typed between words stays while typing. A joiner is kept
 * back until what follows shows whether it joins: one whose neighbour goes
 * stays only if what comes next can be joined to. At the end a joiner goes
 * as the core would refuse it there — unless the text is still being typed
 * (`typing`), and the next character may yet join it: a Persian half-space
 * is typed before the letter after it. @param {string} s @param {boolean} [typing]
 */
export function plainText(s, typing = false) {
  const cs = Array.from(s, (ch) => /** @type {number} */ (ch.codePointAt(0)));
  /** @type {number[]} */
  const out = [];
  /** A joiner waiting for what comes after it. @type {number|null} */
  let joiner = null;
  const last = () => (out.length ? out[out.length - 1] : -1);
  for (let i = 0; i < cs.length; i++) {
    const c = cs[i];
    // A lone surrogate (only a paste brings one) would be saved as U+FFFD.
    if (control(c) || hidden(c) || tag(c) || surrogate(c)) continue;
    if (c === ZWJ || c === ZWNJ || c === MVS) {
      // A second in a row takes the place of the first: they cannot both join.
      joiner = out.length ? c : null;
      continue;
    }
    if (joiner !== null) {
      if (joins(last(), joiner, c)) out.push(joiner);
      joiner = null;
    }
    if ((c === VS15 || c === VS16) && !(emoji(last()) || (keycapBase(last()) && cs[i + 1] === KEYCAP))) continue;
    if (mongolianSelector(c) && !mongolian(last())) continue;
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
  if (joiner !== null && (typing ? opens(last(), joiner) : joins(last(), joiner, null))) out.push(joiner);
  return out.map((c) => String.fromCodePoint(c)).join('');
}

/**
 * What a typed field gives to be kept: cleaned for good — no joiner left
 * waiting at the end — and trimmed. @param {string} s
 */
export const finished = (s) => plainText(s).trim();

const utf8 = new TextEncoder();

/**
 * A field's text as it is being typed, kept to the rule and to `max` —
 * characters for a title or a name, the same room in every script; bytes
 * of UTF-8 for a handle or a link, which are addresses. What is too much
 * goes where it was typed, just before the caret, as `maxLength` refuses a
 * key: typing in the middle of a full title never cuts its end. The caret
 * stays after what was typed. Being typed, a joiner at the end waits for
 * the next letter (`plainText`'s `typing`); `finished()` lets it go.
 * @param {string} value @param {number} caret in UTF-16 units, as the field gives it
 * @param {number} max @param {'chars'|'bytes'} unit
 * @returns {{value: string, caret: number, full: boolean}} full: something typed did not fit
 */
export function keepTyped(value, caret, max, unit) {
  const head = Array.from(plainText(value.slice(0, caret), true));
  const tail = Array.from(plainText(value.slice(caret), true));
  const size = unit === 'chars' ? () => head.length + tail.length : () => utf8.encode(head.join('') + tail.join('')).length;
  const full = size() > max;
  while (size() > max) {
    if (head.length) head.pop();
    else tail.pop();
  }
  // Once more as one text: a joiner either side of the caret meets its neighbour.
  const kept = plainText(head.join('') + tail.join(''), true);
  return { value: kept, caret: Math.min(head.join('').length, kept.length), full };
}
