//! Text on a card, in a nickname, in a handle: what a person sees is all
//! that is there. One rule for every text field of every Pips structure.
//!
//! Refused, besides control characters: characters that are invisible or
//! that reorder the text around them — a right-to-left override turns
//! `ecila` into "alice", a zero-width space makes two names that look the
//! same differ. The two that compound emoji need stay where emoji need
//! them: the zero-width joiner only between two characters that are not
//! letters or digits (👩‍💻, 🏳️‍🌈), tag characters only in a flag that
//! starts with 🏴 (🏴󠁧󠁢󠁳󠁣󠁴󠁿).
//!
//! Limits are in characters, the same for every script: a byte limit
//! would give a Russian name half the room of an English one. The bytes
//! are bounded too, by four a character.
//!
//! The app cleans what is typed by the same rule (`plainText` in
//! `web/src/dom.js`), never more leniently; `tests/data/plain-text.txt`
//! holds the cases both are checked against.

/// Most bytes a character takes in UTF-8.
pub const BYTES_PER_CHAR: usize = 4;

const ZWJ: char = '\u{200D}';
const BLACK_FLAG: char = '\u{1F3F4}';
const TAGS: core::ops::RangeInclusive<char> = '\u{E0020}'..='\u{E007F}';

/// Invisible or reordering, and never wanted: Unicode's format characters
/// (category Cf) apart from the joiner and tags, and the Hangul fillers,
/// which are letters that show as nothing.
#[must_use]
pub const fn hidden(c: char) -> bool {
    matches!(c,
        '\u{AD}' | '\u{600}'..='\u{605}' | '\u{61C}' | '\u{6DD}' | '\u{70F}' | '\u{890}'..='\u{891}' | '\u{8E2}'
        | '\u{180E}' | '\u{200B}'..='\u{200C}' | '\u{200E}'..='\u{200F}' | '\u{202A}'..='\u{202E}'
        | '\u{2060}'..='\u{206F}' | '\u{FEFF}' | '\u{FFF9}'..='\u{FFFB}' | '\u{110BD}' | '\u{110CD}'
        | '\u{13430}'..='\u{1343F}' | '\u{1BCA0}'..='\u{1BCA3}' | '\u{1D173}'..='\u{1D17A}' | '\u{E0001}'
        | '\u{115F}' | '\u{1160}' | '\u{3164}' | '\u{FFA0}')
}

/// What a joiner may stand between: neither a letter nor a digit, nor
/// anything invisible.
fn joinable(c: char) -> bool {
    !c.is_alphanumeric() && !c.is_whitespace() && !c.is_control() && !hidden(c) && c != ZWJ
}

/// Whether `s` is plain text of at most `max_chars` characters: nothing
/// invisible or reordering (see the module), no whitespace at either end.
#[must_use]
pub fn plain(s: &str, max_chars: usize) -> bool {
    if s.trim() != s || s.len() > max_chars * BYTES_PER_CHAR || s.chars().count() > max_chars {
        return false;
    }
    let mut prev: Option<char> = None;
    for (i, c) in s.char_indices() {
        let next = s[i + c.len_utf8()..].chars().next();
        let ok = match c {
            _ if c.is_control() || hidden(c) => false,
            ZWJ => prev.is_some_and(joinable) && next.is_some_and(joinable),
            _ if TAGS.contains(&c) => prev.is_some_and(|p| p == BLACK_FLAG || TAGS.contains(&p)),
            _ => true,
        };
        if !ok {
            return false;
        }
        prev = Some(c);
    }
    true
}
