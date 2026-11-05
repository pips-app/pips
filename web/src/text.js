// @ts-check
// Text as cards and nicknames take it: the core's rule (pips_format::text),
// applied to what is typed so that the core never has to refuse it.
//
// Refused: control characters, and characters that are invisible or reorder
// the text around them (a right-to-left override, a zero-width space…). The
// two that compound emoji need stay where emoji need them: the zero-width
// joiner between two characters that are not letters or digits, tag
// characters in a flag that starts with 🏴. JavaScript has the Unicode
// tables the core spells out by hand, so this removes all format characters
// (\p{Cf}) the core refuses, and any it may not know yet: never more lenient.
// Both are checked against crates/pips-format/tests/data/plain-text.txt.

/**
 * The format's text limits (pips_format::limits): title and names in
 * characters, the same for every script; handle and link in bytes, being
 * addresses. A unit test reads them from the Rust source.
 */
export const LIMITS = Object.freeze({ title: 32, name: 24, handle: 48, link: 64 });

const ZWJ = '‍';
const BLACK_FLAG = '\u{1F3F4}';
/** @param {string} c */
const isTag = (c) => c >= '\u{E0020}' && c <= '\u{E007F}';
/** Invisible or reordering, never wanted (as the core's `hidden`). @param {string} c */
const hidden = (c) => /^[\p{Cf}ᅟᅠㅤﾠ]$/u.test(c) && c !== ZWJ && !isTag(c);
/** What a joiner may stand between. @param {string|undefined} c */
const joinable = (c) => c !== undefined && !/^[\p{Alphabetic}\p{N}\s\p{Cc}]$/u.test(c) && !hidden(c) && c !== ZWJ;

/**
 * `s` with what the core would refuse taken out — not trimmed, so that a
 * space typed between words stays while typing. @param {string} s
 */
export function plainText(s) {
  let chars = Array.from(s);
  for (;;) {
    const kept = chars.filter((c, i) => {
      if (/^\p{Cc}$/u.test(c) || hidden(c)) return false;
      if (c === ZWJ) return joinable(chars[i - 1]) && joinable(chars[i + 1]);
      if (isTag(c)) return chars[i - 1] === BLACK_FLAG || isTag(chars[i - 1] ?? '');
      return true;
    });
    if (kept.length === chars.length) return kept.join('');
    chars = kept; // a joiner may have lost its neighbour: once more
  }
}

/** The first `max` characters of `s` (characters, not UTF-16 units). @param {string} s @param {number} max */
export const fitChars = (s, max) => Array.from(s).slice(0, max).join('');
