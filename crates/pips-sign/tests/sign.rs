//! Keys, recovery, signatures, certificates, envelopes — and attempts to fool them.
#![allow(clippy::cast_possible_truncation, clippy::type_complexity)]

use pips_format::{Card, Handle, Network};
use pips_sign::recovery::{from_paper, from_words, to_paper, to_words, word_list, RecoveryError, PAPER_PREFIX};
use pips_sign::{
    open, seal, sign_card, verify_card, Certificate, Error, Opened, PublicKey, RecipientCode, SecretKey,
    CERTIFICATE_LEN,
};

fn key(n: u8) -> SecretKey {
    SecretKey::from_seed(&[n; 32])
}

/// A real sample artwork with a full back side.
fn card() -> Card {
    let line = include_str!("../../pips-format/tests/data/samples.txt").lines().nth(1).unwrap();
    let mut c = Card::new(32, 32);
    c.opaque = true;
    c.pixels = line.rsplit(' ').next().unwrap().bytes().map(|b| (b as char).to_digit(16).unwrap() as u8).collect();
    c.title = "Лис у костра".into();
    c.author = "kitsu".into();
    c.handle = Some(Handle { network: Network::Telegram, text: "@kitsu".into() });
    c.link = "kitsu.art".into();
    c
}

fn signed(by: &SecretKey) -> Card {
    let mut c = card();
    sign_card(&mut c, by).unwrap();
    c
}

// ---------------------------------------------------------------- recovery --

#[test]
fn bip39_reference_vectors() {
    // From the BIP39 reference test vectors (256-bit entropy).
    let zero = format!("{} art", "abandon ".repeat(23).trim_end());
    assert_eq!(*to_words(&SecretKey::from_seed(&[0; 32])), zero);
    let ones = format!("{} vote", "zoo ".repeat(23).trim_end());
    assert_eq!(*to_words(&SecretKey::from_seed(&[0xFF; 32])), ones);
}

#[test]
fn words_round_trip_and_forgive_only_case_and_spacing() {
    let k = key(7);
    let words = to_words(&k);
    assert_eq!(from_words(&words).unwrap().public_key(), k.public_key());
    let sloppy = format!("  {}\n", words.to_uppercase().replace(' ', "   \t"));
    assert_eq!(from_words(&sloppy).unwrap().public_key(), k.public_key());

    let list: Vec<&str> = words.split(' ').collect();
    assert_eq!(from_words(&list[..23].join(" ")).unwrap_err(), RecoveryError::WordCount(23));
    let mut typo = list.clone();
    typo[5] = "abandonn";
    assert_eq!(from_words(&typo.join(" ")).unwrap_err(), RecoveryError::UnknownWord(5));
    let mut cyrillic = list.clone();
    cyrillic[0] = "аbandon"; // first letter is Cyrillic
    assert_eq!(from_words(&cyrillic.join(" ")).unwrap_err(), RecoveryError::UnknownWord(0));
    let mut swapped = list.clone();
    swapped.swap(0, 1);
    if swapped != list {
        assert_eq!(from_words(&swapped.join(" ")).unwrap_err(), RecoveryError::Checksum);
    }
}

#[test]
fn paper_key_round_trips_and_detects_damage() {
    let k = key(9);
    let paper = to_paper(&k);
    assert!(paper.starts_with(PAPER_PREFIX));
    assert!(paper.len() < 64, "{}", paper.len());
    assert!(paper.bytes().all(|b| b"0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:".contains(&b)));
    assert_eq!(from_paper(&paper).unwrap().public_key(), k.public_key());

    // Any single-character change is caught.
    let alphabet = b"0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:";
    let body = PAPER_PREFIX.len();
    for at in body..paper.len() {
        let mut b = paper.as_bytes().to_vec();
        b[at] = *alphabet.iter().find(|&&c| c != b[at]).unwrap();
        let s = String::from_utf8(b).unwrap();
        assert!(from_paper(&s).map(|k2| k2.public_key()) != Ok(k.public_key()), "change at {at} accepted");
    }
    assert_eq!(from_paper("PIPS:KEY:2:AAAA").unwrap_err(), RecoveryError::BadPaperKey);
}

#[test]
fn secret_key_debug_does_not_leak() {
    let k = key(3);
    let shown = format!("{k:?}");
    assert!(!shown.contains(&format!("{:02x}", k.seed()[0]).repeat(4)));
    assert!(shown.contains(&k.public_key().to_string()));
}

// ------------------------------------------------------------------- cards --

#[test]
fn card_signature_verifies_and_survives_reencoding() {
    let author = key(1);
    let c = signed(&author);
    assert_eq!(verify_card(&c).unwrap(), author.public_key());
    let again = pips_format::decode(&pips_format::encode(&c).unwrap()).unwrap();
    assert_eq!(verify_card(&again).unwrap(), author.public_key());
    assert_eq!(verify_card(&card()), Err(Error::Unsigned));
}

#[test]
fn any_change_to_a_signed_card_breaks_it() {
    let author = key(1);
    let edits: Vec<Box<dyn Fn(&mut Card)>> = vec![
        Box::new(|c| c.pixels[100] ^= 1),
        Box::new(|c| c.title.push('!')),
        Box::new(|c| c.author = "k1tsu".into()),
        Box::new(|c| c.link = "evil.example".into()),
        Box::new(|c| c.handle = Some(Handle { network: Network::X, text: "@kitsu".into() })),
        Box::new(|c| c.frame = 3),
        Box::new(|c| c.opaque = false),
        Box::new(|c| c.unknown_flags = 0x10),
        // Someone else's key attached to the author's signature.
        Box::new(|c| c.signature.as_mut().unwrap().public_key = key(2).public_key().to_bytes()),
    ];
    for (i, edit) in edits.iter().enumerate() {
        let mut c = signed(&author);
        edit(&mut c);
        assert_eq!(verify_card(&c), Err(Error::BadSignature), "edit {i}");
    }
}

#[test]
fn weak_keys_are_refused() {
    // The identity point: every signature "verifies" under it.
    let mut identity = [0u8; 32];
    identity[0] = 1;
    assert_eq!(PublicKey::from_bytes(&identity), Err(Error::BadKey));
    let mut c = signed(&key(1));
    c.signature.as_mut().unwrap().public_key = identity;
    assert_eq!(verify_card(&c), Err(Error::BadKey));
}

/// A key has one spelling. y + p (p = 2^255 - 19) names the same point as
/// y, and for these y it is a valid, strong key — it used to be taken, the
/// same key then comparing unequal to itself.
#[test]
fn a_key_written_a_second_way_is_refused() {
    for y in [3u8, 4, 5, 6, 9, 10, 14, 15, 16, 18] {
        // p + y, little-endian: 0x7FFF…FFED + y.
        let mut b = [0xFF; 32];
        b[31] = 0x7F;
        b[0] = 0xED + y; // no carry: y < 0x13
        assert_eq!(PublicKey::from_bytes(&b), Err(Error::BadKey), "y = {y}");
    }
    let real = key(1).public_key();
    assert_eq!(PublicKey::from_bytes(&real.to_bytes()).unwrap(), real);
}

// ------------------------------------------------------------ certificates --

#[test]
fn certificates() {
    let author = key(1);
    let holder = key(5).public_key();
    let c = signed(&author);
    let cert = Certificate::issue(&author, &c, 3, 50, holder, 20_745).unwrap();
    cert.verify(&c).unwrap();
    assert!(cert.is_held_by(&holder));
    assert!(!cert.is_held_by(&key(6).public_key()));

    let bytes = cert.to_bytes();
    assert_eq!(bytes.len(), CERTIFICATE_LEN);
    assert_eq!(Certificate::from_bytes(&bytes).unwrap(), cert);

    // Open runs, and the edition bounds.
    assert!(Certificate::issue(&author, &c, 17, 0, holder, 0).is_ok());
    assert_eq!(Certificate::issue(&author, &c, 0, 10, holder, 0), Err(Error::BadEdition));
    assert_eq!(Certificate::issue(&author, &c, 11, 10, holder, 0), Err(Error::BadEdition));

    // Only the author can issue.
    assert_eq!(Certificate::issue(&key(2), &c, 1, 10, holder, 0), Err(Error::NotAuthor));
    assert_eq!(Certificate::issue(&author, &card(), 1, 10, holder, 0), Err(Error::Unsigned));

    // A certificate belongs to one card.
    let mut other = card();
    other.title = "Другая".into();
    sign_card(&mut other, &author).unwrap();
    assert_eq!(cert.verify(&other), Err(Error::BadSignature));

    // Rewriting any field breaks it; the holder's key most of all.
    for at in 1..41 {
        let mut b = bytes;
        b[at] ^= 0x01;
        let verdict = Certificate::from_bytes(&b).and_then(|x| x.verify(&c));
        assert!(verdict.is_err(), "flipped byte {at} still verifies");
    }
    assert!(Certificate::from_bytes(&bytes[..104]).is_err());
}

// ---------------------------------------------------------- recipient code --

#[test]
fn recipient_codes() {
    let r = RecipientCode { key: key(5).public_key(), nick: "mossfern".into() };
    let b = r.to_bytes().unwrap();
    assert_eq!(b[0], b'R');
    assert_eq!(RecipientCode::from_bytes(&b).unwrap(), r);
    let text = pips_base45::encode(&b);
    assert!(text.len() < 100, "{}", text.len());

    let mut wrong = b.clone();
    wrong[0] = b'E';
    assert_eq!(RecipientCode::from_bytes(&wrong), Err(Error::WrongKind));
    let bad = RecipientCode { key: r.key, nick: "a\nb".into() };
    assert_eq!(bad.to_bytes(), Err(Error::BadNick));
    let mut long = b.clone();
    long.push(0);
    assert_eq!(RecipientCode::from_bytes(&long), Err(Error::TrailingBytes));
}

// --------------------------------------------------------------- envelopes --

#[test]
fn envelope_from_the_author() {
    let author = key(1);
    let c = signed(&author);
    let o = open(&seal(&c, None, None).unwrap()).unwrap();
    assert_eq!(o.card, c);
    assert_eq!(o.payload, pips_format::encode(&c).unwrap(), "the card's bytes as they came");
    assert_eq!(o.author, Some(author.public_key()));
    assert_eq!((o.certificate, o.sender), (None, None));

    // An unsigned card still travels; the app labels it.
    let o = open(&seal(&card(), None, None).unwrap()).unwrap();
    assert_eq!(o.author, None);
}

#[test]
fn envelope_with_certificate_and_sender_fits_one_code() {
    let author = key(1);
    let holder = key(5);
    let c = signed(&author);
    let cert = Certificate::issue(&author, &c, 3, 50, holder.public_key(), 20_745).unwrap();

    let direct = seal(&c, Some(&cert), None).unwrap();
    let o = open(&direct).unwrap();
    assert_eq!(o.certificate, Some(cert));

    // Passed on by someone else: signed "from".
    let passed = seal(&c, Some(&cert), Some((&holder, "mossfern"))).unwrap();
    let o = open(&passed).unwrap();
    let s = o.sender.unwrap();
    assert_eq!((s.nick.as_str(), s.key), ("mossfern", holder.public_key()));

    // The largest case still fits the 600-byte budget of one QR code.
    assert!(passed.len() <= 600, "{} bytes", passed.len());
}

#[test]
fn envelope_tampering_is_caught() {
    let author = key(1);
    let holder = key(5);
    let c = signed(&author);
    let cert = Certificate::issue(&author, &c, 3, 50, holder.public_key(), 1).unwrap();
    let env = seal(&c, Some(&cert), Some((&holder, "mossfern"))).unwrap();

    // Every single-bit flip is either refused or changes nothing that
    // matters. Deflate ignores a few padding bits, so a flip there leaves the
    // same pixels — and signatures cover the content, not the compression.
    // The payload bytes do differ then: they are kept as they came, and the
    // card's identity (its digest) is what tells two copies apart.
    let content = |o: &Opened| (o.card.clone(), o.author, o.certificate, o.sender.clone());
    let original = content(&open(&env).unwrap());
    let mut harmless = 0;
    for at in 0..env.len() {
        for bit in [0x01, 0x02, 0x40, 0x80] {
            let mut b = env.clone();
            b[at] ^= bit;
            if let Ok(o) = open(&b) {
                assert_eq!(content(&o), original, "flip at {at} changed the content");
                assert!((5..5 + c.pixels.len()).contains(&at), "flip at {at} outside the pixel stream");
                harmless += 1;
            }
        }
    }
    assert!(harmless < 8, "{harmless} harmless flips");
    // Truncation at every length, and trailing bytes.
    for n in 0..env.len() {
        assert!(open(&env[..n]).is_err());
    }
    let mut long = env.clone();
    long.push(0);
    assert_eq!(open(&long), Err(Error::TrailingBytes));

    // The reserved expiry bit is refused, not ignored.
    let mut future = seal(&c, None, None).unwrap();
    future[2] |= 1 << 2;
    assert_eq!(open(&future), Err(Error::UnknownFlag(4)));

    // A certificate cannot be sealed onto a card it was not issued for.
    let mut other = card();
    other.title = "Другая".into();
    sign_card(&mut other, &author).unwrap();
    assert_eq!(seal(&other, Some(&cert), None), Err(Error::BadSignature));
}

/// What the app's word entry relies on: the list is sorted, and a word's
/// first four letters (all of it, if shorter) tell it from every other.
/// A sender vouches for the card as it came to them, author and all: the
/// same picture re-signed by someone else, or with its signature stripped,
/// cannot be slipped under their signed "from".
#[test]
fn a_sender_vouches_for_the_author_too() {
    let (alice, bob, mallory) = (key(1), key(2), key(3));
    let original = signed(&alice);
    let env = seal(&original, None, Some((&bob, "bob"))).unwrap();
    assert_eq!(open(&env).unwrap().author.unwrap(), alice.public_key());

    // The card in the envelope swapped for one of the same picture
    // (the same digest), Bob's nick, key and signature kept.
    let swapped = |other: &Card| {
        let (payload, theirs) = (pips_format::encode(&original).unwrap(), pips_format::encode(other).unwrap());
        let at = env.windows(payload.len()).position(|w| w == payload.as_slice()).unwrap();
        let mut out = env[..at - 2].to_vec();
        out.extend_from_slice(&u16::try_from(theirs.len()).unwrap().to_le_bytes());
        out.extend_from_slice(&theirs);
        out.extend_from_slice(&env[at + payload.len()..]);
        out
    };
    assert_eq!(open(&swapped(&signed(&mallory))).unwrap_err(), Error::BadSignature, "re-signed by someone else");
    assert_eq!(open(&swapped(&card())).unwrap_err(), Error::BadSignature, "the author's signature stripped");
    // Sealed again by Mallory herself, it is honest: her card, her "from".
    let o = open(&seal(&signed(&mallory), None, Some((&mallory, "mallory"))).unwrap()).unwrap();
    assert_eq!((o.author.unwrap(), o.sender.unwrap().key), (mallory.public_key(), mallory.public_key()));
}

#[test]
fn four_letters_name_a_word() {
    let list = word_list();
    assert!(list.windows(2).all(|w| w[0] < w[1]));
    let mut prefixes: Vec<&str> = list.iter().map(|w| &w[..w.len().min(4)]).collect();
    prefixes.dedup();
    assert_eq!(prefixes.len(), 2048);
}

/// A key kept elsewhere, as a browser keeps one: it signs bytes and gives
/// back the signature, and nothing else of it is seen.
fn elsewhere(n: u8) -> impl Fn(&[u8]) -> [u8; 64] {
    use ed25519_dalek::Signer;
    let key = ed25519_dalek::SigningKey::from_bytes(&[n; 32]);
    move |m| key.sign(m).to_bytes()
}

#[test]
fn signing_in_two_steps_makes_the_same_bytes_as_signing_in_one() {
    use pips_sign::{attach_card_signature, card_message, seal_signed, sender_message_for};
    let (author, holder) = (key(1), key(2));
    let (sign_author, sign_holder) = (elsewhere(1), elsewhere(2));

    // The card.
    let mut one = card();
    sign_card(&mut one, &author).unwrap();
    let mut two = card();
    let sig = sign_author(&card_message(&two).unwrap());
    attach_card_signature(&mut two, &author.public_key(), &sig).unwrap();
    assert_eq!(pips_format::encode(&two).unwrap(), pips_format::encode(&one).unwrap());

    // A numbered copy.
    let cert = Certificate::issue(&author, &one, 3, 10, holder.public_key(), 20_400).unwrap();
    let m = Certificate::message_to_issue(&author.public_key(), &one, 3, 10, holder.public_key(), 20_400).unwrap();
    let cert2 =
        Certificate::with_signature(&author.public_key(), &one, 3, 10, holder.public_key(), 20_400, &sign_author(&m))
            .unwrap();
    assert_eq!(cert2.to_bytes(), cert.to_bytes());

    // Handed on by its holder.
    let env = seal(&one, Some(&cert), Some((&holder, "mira"))).unwrap();
    let m = sender_message_for(&one, Some(&cert), "mira").unwrap();
    let env2 = seal_signed(&one, Some(&cert), Some((&holder.public_key(), "mira", &sign_holder(&m)))).unwrap();
    assert_eq!(env2, env);
    assert!(open(&env2).unwrap().sender.is_some());
}

#[test]
fn a_signature_made_elsewhere_is_checked_before_it_is_used() {
    use pips_sign::{attach_card_signature, card_message, seal_signed, sender_message_for};
    let (author, holder) = (key(1), key(2));
    let wrong = elsewhere(9);

    let mut c = card();
    let bad = wrong(&card_message(&c).unwrap());
    assert_eq!(attach_card_signature(&mut c, &author.public_key(), &bad), Err(Error::BadSignature));
    assert_eq!(c.signature, None, "nothing attached");

    sign_card(&mut c, &author).unwrap();
    let m = Certificate::message_to_issue(&author.public_key(), &c, 1, 0, holder.public_key(), 1).unwrap();
    assert_eq!(
        Certificate::with_signature(&author.public_key(), &c, 1, 0, holder.public_key(), 1, &wrong(&m)),
        Err(Error::BadSignature)
    );
    // Only the card's author issues copies, in two steps as in one.
    assert_eq!(
        Certificate::message_to_issue(&holder.public_key(), &c, 1, 0, holder.public_key(), 1),
        Err(Error::NotAuthor)
    );

    let m = sender_message_for(&c, None, "mira").unwrap();
    assert_eq!(seal_signed(&c, None, Some((&holder.public_key(), "mira", &wrong(&m)))), Err(Error::BadSignature));
    // Signed for one nick, it does not pass for another.
    let good = elsewhere(2)(&m);
    assert_eq!(seal_signed(&c, None, Some((&holder.public_key(), "mila", &good))), Err(Error::BadSignature));
}
