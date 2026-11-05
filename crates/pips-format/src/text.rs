//! Text on a card, in a nickname, in a handle: what a person sees is all
//! that is there. One rule for every text field of every Pips structure.
//!
//! Refused: control characters, and characters that are invisible or that
//! reorder the text around them — a right-to-left override turns `ecila`
//! into "alice", a zero-width space makes two names that look the same
//! differ. The few that writing needs stay only where it needs them:
//!
//! - the zero-width joiner between two emoji (👩‍💻, 🏳️‍🌈), and it or the
//!   non-joiner between two letters of Arabic or Indic script (Persian
//!   «می‌خواهم», Hindi conjuncts), where they change how letters connect;
//! - variation selectors 15 and 16 after an emoji or a keycap base (❤️, 1️⃣);
//! - tag characters only in a flag: 🏴, two to six letters or digits, the
//!   cancel tag (🏴󠁧󠁢󠁳󠁣󠁴󠁿).
//!
//! Every list here is written out and frozen, not read from the Unicode
//! tables of the compiler or the browser: whether a card is valid must not
//! depend on which version of Unicode the reader was built with. The app
//! cleans what is typed by exactly these lists (`web/src/text.js`), and
//! `tests/data/plain-text.txt` holds the cases and the fingerprint of every
//! character that both are checked against.
//!
//! Limits are in characters, the same for every script: a byte limit
//! would give a Russian name half the room of an English one. The bytes
//! are bounded too, by four a character.

/// Most bytes a character takes in UTF-8.
pub const BYTES_PER_CHAR: usize = 4;

const ZWNJ: char = '\u{200C}';
const ZWJ: char = '\u{200D}';
const VS15: char = '\u{FE0E}';
const VS16: char = '\u{FE0F}';
const BLACK_FLAG: char = '\u{1F3F4}';
const CANCEL_TAG: char = '\u{E007F}';
/// Letters and digits in a flag's tags (`gbsct` in 🏴󠁧󠁢󠁳󠁣󠁴󠁿): subdivision
/// codes are two to six of them.
const FLAG_TAGS: core::ops::RangeInclusive<usize> = 2..=6;

/// Control characters (category Cc, fixed since Unicode 1.1).
#[must_use]
pub const fn control(c: char) -> bool {
    matches!(c, '\0'..='\u{1F}' | '\u{7F}'..='\u{9F}')
}

/// Spaces, which a text may hold but not begin or end with: Unicode's
/// `White_Space` apart from the controls.
#[must_use]
pub const fn space(c: char) -> bool {
    matches!(c, ' ' | '\u{A0}' | '\u{1680}' | '\u{2000}'..='\u{200A}' | '\u{202F}' | '\u{205F}' | '\u{3000}')
}

/// Invisible, reordering or breaking the line, and never wanted: the format
/// characters (category Cf) apart from the joiners, the variation selectors
/// and characters that show as nothing (Hangul fillers, the blank Braille
/// cell, the grapheme joiner, Khmer inherent vowels, Mongolian selectors),
/// the line and paragraph separators, and the whole tag block outside a
/// flag's tags, unassigned parts included.
#[must_use]
pub const fn hidden(c: char) -> bool {
    matches!(c,
        '\u{AD}' | '\u{34F}' | '\u{600}'..='\u{605}' | '\u{61C}' | '\u{6DD}' | '\u{70F}' | '\u{890}'..='\u{891}'
        | '\u{8E2}' | '\u{115F}' | '\u{1160}' | '\u{17B4}' | '\u{17B5}' | '\u{180B}'..='\u{180F}'
        | '\u{200B}' | '\u{200E}'..='\u{200F}' | '\u{2028}'..='\u{202E}' | '\u{2060}'..='\u{206F}'
        | '\u{2800}' | '\u{3164}' | '\u{FE00}'..='\u{FE0D}' | '\u{FEFF}' | '\u{FFA0}' | '\u{FFF9}'..='\u{FFFB}'
        | '\u{110BD}' | '\u{110CD}' | '\u{13430}'..='\u{1343F}' | '\u{1BCA0}'..='\u{1BCA3}'
        | '\u{1D173}'..='\u{1D17A}' | '\u{E0000}'..='\u{E001F}' | '\u{E0080}'..='\u{E0FFF}')
}

/// A character of the tag block, which only a flag may hold.
const fn tag(c: char) -> bool {
    matches!(c, '\u{E0020}'..='\u{E007F}')
}

/// A letter or digit tag, as a flag's subdivision code is spelt.
const fn flag_tag(c: char) -> bool {
    matches!(c, '\u{E0030}'..='\u{E0039}' | '\u{E0061}'..='\u{E007A}')
}

/// Emoji, and the symbols that emoji sequences are made of: arrows to
/// miscellaneous symbols, the emoji planes, and the few elsewhere that take
/// a variation selector (©, ®, ‼, ⁉, ™, ℹ, 〰, 〽, ㊗, ㊙).
#[must_use]
pub const fn emoji(c: char) -> bool {
    matches!(c,
        '\u{A9}' | '\u{AE}' | '\u{203C}' | '\u{2049}' | '\u{2122}' | '\u{2139}' | '\u{2190}'..='\u{2BFF}'
        | '\u{3030}' | '\u{303D}' | '\u{3297}' | '\u{3299}' | '\u{1F000}'..='\u{1FAFF}')
}

/// What may stand before the joiner in an emoji: an emoji, or one made to
/// show as emoji (🏳️‍🌈 is 🏳, VS16, the joiner, 🌈).
const fn emoji_end(c: char) -> bool {
    emoji(c) || c == VS16
}

/// Arabic (with Persian and Urdu) and the Indic scripts, Devanagari to
/// Malayalam: the scripts whose letters the joiners connect or keep apart.
#[must_use]
pub const fn joining_script(c: char) -> bool {
    !hidden(c)
        && matches!(c,
            '\u{600}'..='\u{6FF}' | '\u{750}'..='\u{77F}' | '\u{8A0}'..='\u{8FF}' | '\u{900}'..='\u{DFF}'
            | '\u{FB50}'..='\u{FDFF}' | '\u{FE70}'..='\u{FEFC}')
}

/// What may take a variation selector: an emoji, or a keycap's base (1️⃣).
const fn selectable(c: char) -> bool {
    emoji(c) || matches!(c, '0'..='9' | '#' | '*')
}

/// Whether a joiner may stand between `prev` and `next`.
const fn joins(prev: char, joiner: char, next: char) -> bool {
    (joining_script(prev) && joining_script(next)) || (joiner == ZWJ && emoji_end(prev) && emoji(next))
}

/// How many characters from the start of `rest` a flag's tags take (the
/// cancel tag included), or 0 if they are not a flag's tags.
fn flag_tags(rest: &str) -> usize {
    let letters = rest.chars().take_while(|&c| flag_tag(c)).count();
    let ends = rest.chars().nth(letters) == Some(CANCEL_TAG);
    if ends && FLAG_TAGS.contains(&letters) {
        letters + 1
    } else {
        0
    }
}

/// Whether `s` is plain text of at most `max_chars` characters: nothing
/// invisible or reordering (see the module), no space at either end.
#[must_use]
pub fn plain(s: &str, max_chars: usize) -> bool {
    let mut chars = s.chars();
    let ends = |c: Option<char>| c.is_some_and(space);
    if ends(s.chars().next()) || ends(s.chars().next_back()) {
        return false;
    }
    if s.len() > max_chars * BYTES_PER_CHAR || s.chars().count() > max_chars {
        return false;
    }
    let mut prev: Option<char> = None;
    while let Some(c) = chars.next() {
        let next = chars.clone().next();
        let ok = match c {
            _ if control(c) || hidden(c) || tag(c) => false,
            ZWJ | ZWNJ => matches!((prev, next), (Some(p), Some(n)) if joins(p, c, n)),
            VS15 | VS16 => prev.is_some_and(selectable),
            BLACK_FLAG => {
                // A flag's tags are taken whole, or the flag is bare.
                let n = flag_tags(chars.as_str());
                for _ in 0..n {
                    chars.next();
                }
                if n > 0 {
                    prev = Some(CANCEL_TAG);
                    continue;
                }
                true
            }
            _ => true,
        };
        if !ok {
            return false;
        }
        prev = Some(c);
    }
    true
}
