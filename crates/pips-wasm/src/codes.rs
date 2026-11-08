//! Every error code the core can give the app, in one list.
//!
//! The app says what went wrong by the code, in the person's language, so
//! the list is a contract: a code the app has no words for would reach the
//! person as an English message. Keeping the codes in one enum makes the
//! list complete by construction, and [`Code::ALL`] lets the app check its
//! words against it.

use serde::{Serialize, Serializer};

macro_rules! codes {
    ($($(#[$doc:meta])* $name:ident = $text:literal,)*) => {
        /// An error's stable machine code; on the JavaScript side, the string.
        #[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
        pub enum Code {
            $($(#[$doc])* $name,)*
        }

        impl Code {
            /// Every code, in the order listed here.
            pub const ALL: &'static [Code] = &[$(Code::$name,)*];

            /// The code with this name, if there is one.
            #[must_use]
            pub fn named(name: &str) -> Option<Code> {
                Code::ALL.iter().copied().find(|c| c.as_str() == name)
            }

            /// The code as the app sees it, e.g. `"bad_signature"`.
            #[must_use]
            pub const fn as_str(self) -> &'static str {
                match self {
                    $(Code::$name => $text,)*
                }
            }
        }
    };
}

codes! {
    // Cards.
    /// A card, or a card's data from the app, that does not read.
    InvalidCard = "invalid_card",
    /// Made by a newer app: a higher version, a flag or extension that must
    /// not be skipped, a built-in palette not yet here, a backup or frame
    /// of a newer format.
    NewerVersion = "newer_version",
    /// A title the format does not take.
    BadTitle = "bad_title",
    /// A nickname on the card the format does not take.
    BadAuthor = "bad_author",
    /// A social handle the format does not take.
    BadHandle = "bad_handle",
    /// A site the format does not take.
    BadSite = "bad_site",

    // Signatures, envelopes, editions.
    /// A card with no author's signature.
    Unsigned = "unsigned",
    /// A signature that does not match.
    BadSignature = "bad_signature",
    /// Bytes that are not a public key.
    BadKey = "bad_key",
    /// Only a card's author can do this.
    NotAuthor = "not_author",
    /// An edition certificate that does not fit the card.
    BadEdition = "bad_edition",
    /// A recipient's nickname the format does not take.
    BadNick = "bad_nick",
    /// An envelope, certificate or recipient code that does not read.
    InvalidCode = "invalid_code",

    // Links and codes.
    /// A link that is not a card's link, or a site to link from that
    /// cannot carry one.
    BadLink = "bad_link",
    /// A carousel frame that does not read.
    BadFrame = "bad_frame",

    // Keys.
    /// Recovery words that are not a key.
    BadWords = "bad_words",
    /// A paper key that is not a key.
    BadPaperKey = "bad_paper_key",
    /// A secret key of the wrong length.
    BadSeed = "bad_seed",
    /// A backup nonce of the wrong length.
    BadNonce = "bad_nonce",

    // Backups.
    /// A file that is not a Pips backup.
    NotABackup = "not_a_backup",
    /// The backup of another key.
    OtherOwner = "other_owner",
    /// A backup changed after it was saved.
    Damaged = "damaged",
    /// A backup that opens but whose contents do not read.
    InvalidBackup = "invalid_backup",
    /// A backup or a picture file larger than the limits.
    TooLarge = "too_large",

    // The app's options.
    /// Options from the app that do not read.
    BadOptions = "bad_options",
    /// A palette that does not read, or a built-in palette that does not
    /// exist.
    BadPalette = "bad_palette",

    // Pictures to import.
    /// Not a PNG or Aseprite file.
    UnknownFormat = "unknown_format",
    /// A picture file damaged or written wrong.
    Malformed = "malformed",
    /// Something in the picture a card cannot show.
    Unsupported = "unsupported",
    /// Half-transparent pixels; args: x, y, frame.
    PartialAlpha = "partial_alpha",
    /// Larger than a card; args: width, height.
    TooBig = "too_big",
    /// More colours than a card holds; args: how many.
    TooManyColors = "too_many_colors",
    /// More frames than a card holds.
    TooManyFrames = "too_many_frames",
    /// Frames of different lengths.
    UnequalDelays = "unequal_delays",
    /// A frame too short or too long; args: its length in ms.
    DelayOutOfRange = "delay_out_of_range",
}

impl Serialize for Code {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(self.as_str())
    }
}

/// So that tests and callers can compare with the string the app sees.
impl PartialEq<&str> for Code {
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}

impl core::fmt::Display for Code {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        f.write_str(self.as_str())
    }
}

/// The code of a picture that would not import: the name `pips-raster`
/// gives it. Its errors may grow (`non_exhaustive`); one this list does not
/// have yet is said as a damaged file, and a test checks every error known
/// today has its own code.
#[must_use]
pub fn of_raster(e: &pips_raster::Error) -> Code {
    Code::named(e.code()).unwrap_or(Code::Malformed)
}

/// The code of a backup that would not open: the name `pips-store` gives
/// it, as for pictures.
#[must_use]
pub fn of_store(e: &pips_store::Error) -> Code {
    Code::named(e.code()).unwrap_or(Code::InvalidBackup)
}
