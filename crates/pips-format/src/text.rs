//! Text on a card, in a nickname, in a handle: what a person sees is all
//! that is there. One rule for every text field of every Pips structure.
//!
//! Refused: control characters, and characters that are invisible or that
//! reorder the text around them — a right-to-left override turns `ecila`
//! into "alice", a zero-width space makes two names that look the same
//! differ. The few that writing needs stay only where it needs them:
//!
//! - the zero-width joiner between two emoji (👩‍💻, 🏳️‍🌈), and it or the
//!   non-joiner between two letters of Arabic, Indic or Myanmar script
//!   (Persian «می‌خواهم», Hindi conjuncts), where they change how letters
//!   connect; the joiner also after a virama, where it makes a half form or
//!   a Malayalam chillu, at the end of a word too;
//! - variation selectors 15 and 16 after an emoji (❤️), or in a keycap
//!   (1️⃣: a digit, the selector, the keycap);
//! - the Mongolian free variation selectors after a Mongolian letter, and
//!   the vowel separator between two;
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
//! Known and accepted: without the emoji and joining tables, a joiner
//! between two emoji that make no sequence (🙂‍🙂), a non-joiner after an
//! Arabic letter that does not connect anyway, a selector on an emoji that
//! shows as emoji without it — each draws as nothing extra, and each is
//! taken. Nothing invisible can stand between ordinary letters.
//!
//! Limits are in characters, the same for every script: a byte limit
//! would give a Russian name half the room of an English one. The bytes
//! are bounded too, by four a character.

/// Most bytes a character takes in UTF-8.
pub const BYTES_PER_CHAR: usize = 4;

const ZWNJ: char = '\u{200C}';
const ZWJ: char = '\u{200D}';
const MVS: char = '\u{180E}';
const VS15: char = '\u{FE0E}';
const VS16: char = '\u{FE0F}';
const KEYCAP: char = '\u{20E3}';
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
/// characters (category Cf) apart from the joiners, the selectors that
/// writing needs (see the module) and characters that show as nothing
/// (Hangul fillers, the blank Braille cell, the grapheme joiner, Khmer
/// inherent vowels, the default-ignorable specials FFF0–FFF8), the line and
/// paragraph separators, and the whole tag block outside a flag's tags,
/// unassigned parts included.
#[must_use]
pub const fn hidden(c: char) -> bool {
    matches!(c,
        '\u{AD}' | '\u{34F}' | '\u{600}'..='\u{605}' | '\u{61C}' | '\u{6DD}' | '\u{70F}' | '\u{890}'..='\u{891}'
        | '\u{8E2}' | '\u{115F}' | '\u{1160}' | '\u{17B4}' | '\u{17B5}'
        | '\u{200B}' | '\u{200E}'..='\u{200F}' | '\u{2028}'..='\u{202E}' | '\u{2060}'..='\u{206F}'
        | '\u{2800}' | '\u{3164}' | '\u{FE00}'..='\u{FE0D}' | '\u{FEFF}' | '\u{FFA0}' | '\u{FFF0}'..='\u{FFFB}'
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

/// Emoji, and the symbols that emoji sequences are made of: the emoji
/// planes, and outside them the symbols that are emoji too (☀, ❤, ↔, ⬅, ©…)
/// — not the arrows, maths and box drawing around them.
#[must_use]
pub const fn emoji(c: char) -> bool {
    matches!(c,
        '\u{A9}' | '\u{AE}' | '\u{203C}' | '\u{2049}' | '\u{2122}' | '\u{2139}' | '\u{2194}'..='\u{2199}'
        | '\u{21A9}'..='\u{21AA}' | '\u{231A}'..='\u{231B}' | '\u{2328}' | '\u{23CF}' | '\u{23E9}'..='\u{23F3}'
        | '\u{23F8}'..='\u{23FA}' | '\u{24C2}' | '\u{25AA}'..='\u{25AB}' | '\u{25B6}' | '\u{25C0}'
        | '\u{25FB}'..='\u{25FE}' | '\u{2600}'..='\u{27BF}' | '\u{2934}'..='\u{2935}' | '\u{2B05}'..='\u{2B07}'
        | '\u{2B1B}'..='\u{2B1C}' | '\u{2B50}' | '\u{2B55}' | '\u{3030}' | '\u{303D}' | '\u{3297}' | '\u{3299}'
        | '\u{1F000}'..='\u{1FAFF}')
}

/// What may stand before the joiner in an emoji: an emoji, or one made to
/// show as emoji (🏳️‍🌈 is 🏳, VS16, the joiner, 🌈).
const fn emoji_end(c: char) -> bool {
    emoji(c) || c == VS16
}

/// Arabic (with Persian and Urdu), the Indic scripts from Devanagari to
/// Sinhala, and Myanmar: the scripts whose letters the joiners connect or
/// keep apart.
#[must_use]
pub const fn joining_script(c: char) -> bool {
    !hidden(c)
        && matches!(c,
            '\u{600}'..='\u{6FF}' | '\u{750}'..='\u{77F}' | '\u{8A0}'..='\u{8FF}' | '\u{900}'..='\u{DFF}'
            | '\u{1000}'..='\u{109F}' | '\u{FB50}'..='\u{FDFF}' | '\u{FE70}'..='\u{FEFC}')
}

/// The viramas of the Indic scripts, after which the joiner makes a half
/// form or a chillu — whatever follows, the end of the text included.
const fn virama(c: char) -> bool {
    matches!(
        c,
        '\u{94D}'
            | '\u{9CD}'
            | '\u{A4D}'
            | '\u{ACD}'
            | '\u{B4D}'
            | '\u{BCD}'
            | '\u{C4D}'
            | '\u{CCD}'
            | '\u{D4D}'
            | '\u{DCA}'
    )
}

/// A letter of Mongolian script, which its selectors and separator follow.
const fn mongolian(c: char) -> bool {
    matches!(c, '\u{1820}'..='\u{1878}' | '\u{1880}'..='\u{18AA}')
}

/// A keycap's base (1️⃣ is 1, VS16, the keycap).
const fn keycap_base(c: char) -> bool {
    matches!(c, '0'..='9' | '#' | '*')
}

/// Whether a joiner — or the Mongolian vowel separator, which stands
/// between letters as one does — may stand between `prev` and `next`
/// (`None`: the end of the text).
const fn joins(prev: char, joiner: char, next: Option<char>) -> bool {
    let (both, emoji_next) = match next {
        Some(n) => (joining_script(prev) && joining_script(n), emoji(n)),
        None => (false, false),
    };
    match joiner {
        ZWJ => both || virama(prev) || (emoji_end(prev) && emoji_next),
        ZWNJ => both,
        _ => mongolian(prev) && matches!(next, Some(n) if mongolian(n)),
    }
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
            ZWJ | ZWNJ | MVS => prev.is_some_and(|p| joins(p, c, next)),
            VS15 | VS16 => prev.is_some_and(|p| emoji(p) || (keycap_base(p) && next == Some(KEYCAP))),
            '\u{180B}'..='\u{180D}' | '\u{180F}' => prev.is_some_and(mongolian),
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
