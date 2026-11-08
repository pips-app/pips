//! The app's journeys through the facade, end to end.

use pips_wasm::api::{
    card_link, classify, inspect_card, open_envelope, palettes, parse_link, parse_palette, qr_matrix, qr_plan, render,
    share_size, CardData, Carousel, HandleData, Identity, JoinProgress, Joiner, PaletteData, QrPlan, Scanned,
};

fn editor_card() -> CardData {
    CardData {
        width: 16,
        height: 16,
        opaque: true,
        palette: PaletteData::Builtin(1),
        frame: 2,
        frames: 1,
        delay_ms: 0,
        title: "Сова".into(),
        author: "kitsu".into(),
        handle: Some(HandleData { network: "bluesky".into(), text: "@kitsu.bsky.social".into() }),
        link: "kitsu.art".into(),
        pixels: (0..256u16).map(|i| u8::try_from(i % 32).unwrap()).collect(),
    }
}

fn id(n: u8) -> Identity {
    Identity::from_seed(&[n; 32]).unwrap()
}

/// Draw, sign, share as one code, scan, open.
#[test]
fn draw_share_scan_open() {
    let me = id(1);
    let card = editor_card();
    let size = share_size(&card).unwrap();
    let payload = me.sign_card(&card).unwrap();
    let envelope = me.seal_as_author(&payload, None).unwrap();
    assert_eq!(size, envelope.len());

    let QrPlan::Single { text } = qr_plan(&envelope).unwrap() else { panic!("expected one code") };
    let m = qr_matrix(&text).unwrap();
    assert_eq!(m.modules.len(), m.size * m.size);

    let Scanned::Envelope { bytes } = classify(&text) else { panic!() };
    let o = open_envelope(&bytes).unwrap();
    assert_eq!(o.card, card);
    assert_eq!(o.payload, payload);
    assert_eq!(o.author.unwrap(), me.public_key());
    assert_eq!(o.digest.len(), 64);
    assert!(o.certificate.is_none() && o.sender.is_none());
}

/// Recipient shows a code, author issues copy 3 of 50, recipient sees it is theirs.
#[test]
fn certified_copy() {
    let (author, friend) = (id(1), id(2));
    let payload = author.sign_card(&editor_card()).unwrap();

    let Scanned::Recipient { nick, bytes: code, .. } = classify(&friend.recipient_code("mossfern").unwrap()) else {
        panic!()
    };
    assert_eq!(nick, "mossfern");
    let cert = author.issue(&payload, 3, 50, &code, 20_746).unwrap();
    let env = author.seal_as_author(&payload, Some(&cert)).unwrap();
    let o = open_envelope(&env).unwrap();
    let c = o.certificate.unwrap();
    assert_eq!((c.edition, c.of, c.issued_day), (3, 50, 20_746));
    assert_eq!(c.holder, friend.public_key());
    assert_eq!(c.bytes, cert);

    // Only the author issues.
    assert_eq!(friend.issue(&payload, 1, 1, &code, 0).unwrap_err().code, "not_author");
}

/// Passing someone else's card on: a signed "from", never the certificate.
#[test]
fn pass_on_a_copy() {
    let (author, friend) = (id(1), id(2));
    let payload = author.sign_card(&editor_card()).unwrap();
    let env = friend.seal_as_sender(&payload, "mossfern").unwrap();
    let o = open_envelope(&env).unwrap();
    assert_eq!(o.author.unwrap(), author.public_key());
    let s = o.sender.unwrap();
    assert_eq!((s.nick.as_str(), s.key), ("mossfern", friend.public_key()));
    assert_eq!(o.payload, payload, "the card goes on byte for byte");
}

/// A card too large for one code goes on a carousel and comes back.
#[test]
fn large_card_over_carousel() {
    let me = id(1);
    let mut card = editor_card();
    card.width = 64;
    card.height = 64;
    // Noise does not compress: well over one code.
    let mut s = 1u32;
    card.pixels = (0..64 * 64)
        .map(|_| {
            s = s.wrapping_mul(1_103_515_245).wrapping_add(12_345);
            u8::try_from(s >> 27).unwrap()
        })
        .collect();
    let env = me.seal_as_author(&me.sign_card(&card).unwrap(), None).unwrap();
    let QrPlan::Carousel { fragments } = qr_plan(&env).unwrap() else { panic!("expected a carousel") };
    let c = Carousel::new(&env).unwrap();
    assert_eq!(c.fragments(), fragments);

    let mut j = Joiner::new();
    let mut seq = 7;
    let joined = loop {
        let Scanned::Frame { bytes } = classify(&c.frame_text(seq)) else { panic!() };
        if let JoinProgress::Done { bytes } = j.push(&bytes).unwrap() {
            break bytes;
        }
        seq += 2; // a camera that sees every other frame
    };
    assert_eq!(open_envelope(&joined).unwrap().card, card);
}

/// The code a refusal comes with.
fn code<T>(r: Result<T, pips_wasm::api::ApiError>) -> &'static str {
    r.map(drop).unwrap_err().code.as_str()
}

/// What a newer app made is said as such — not as damage — so the person
/// knows to update, not to ask for the card again. Version 0 is damage.
#[test]
fn a_newer_version_is_told_apart_from_damage() {
    let me = id(1);
    let payload = me.sign_card(&editor_card()).unwrap();
    let env = me.seal_as_author(&payload, None).unwrap();
    let with = |b: &[u8], at: usize, v: u8| {
        let mut b = b.to_vec();
        b[at] = v;
        b
    };
    // A card: its version byte, a flag not to be skipped, a palette not built in yet.
    assert_eq!(code(inspect_card(&with(&payload, 0, 2))), "newer_version");
    assert_eq!(code(inspect_card(&with(&payload, 0, 0))), "invalid_card");
    // The fifth byte is the palette: version, flags, width, height, palette.
    assert_eq!(code(inspect_card(&with(&payload, 4, 200))), "newer_version");
    // An envelope: its version byte, then a flag this core does not know.
    assert_eq!(env[0], b'E');
    assert_eq!(code(open_envelope(&with(&env, 1, 2))), "newer_version");
    assert_eq!(code(open_envelope(&with(&env, 1, 0))), "invalid_code");
    assert_eq!(code(open_envelope(&with(&env, 2, env[2] | 0x80))), "newer_version");
    // A carousel frame of a newer carousel.
    let mut card = editor_card();
    (card.width, card.height) = (64, 64);
    let mut s = 1u32;
    card.pixels = (0..64 * 64)
        .map(|_| {
            s = s.wrapping_mul(1_103_515_245).wrapping_add(12_345);
            u8::try_from(s >> 27).unwrap()
        })
        .collect();
    let big = me.seal_as_author(&me.sign_card(&card).unwrap(), None).unwrap();
    let Scanned::Frame { bytes } = classify(&Carousel::new(&big).unwrap().frame_text(0)) else { panic!() };
    assert_eq!(Joiner::new().push(&with(&bytes, 1, 2)).unwrap_err().code, "newer_version");
    assert_eq!(Joiner::new().push(&with(&bytes, 1, 0)).unwrap_err().code, "bad_frame");
    // A link: after the #, the first byte names what follows — 'E' (R in
    // base64url), a card. 'I' (S) is some newer kind; 0x01 (A) is nothing.
    let link = card_link("https://pips.example/c", &env).unwrap();
    let kind = |c: char| link.replacen("#R", &format!("#{c}"), 1);
    assert_eq!(code(parse_link(&kind('S'))), "newer_version");
    assert_eq!(code(parse_link(&kind('A'))), "bad_link");
    // What this version knows — a recipient code ('R'), a carousel frame
    // ('F') — is no link's, and not called newer.
    assert_eq!(code(parse_link("https://pips.example/#UgE")), "bad_link");
    assert_eq!(code(parse_link("https://pips.example/#RgE")), "bad_link");
    assert_eq!(parse_link(&link).unwrap(), env);
}

/// A scanned code is trimmed: one whose text began with Base45's space
/// would lose it. That happens only for some kind-and-version pairs, which
/// are therefore never used (listed at `classify`).
#[test]
fn no_code_begins_with_a_space() {
    const SPACE: u32 = 36; // its place in the Base45 alphabet
    let first = |kind: u8, version: u8| (u32::from(kind) * 256 + u32::from(version)) % 45;
    let reserved = |kind: u8| (1..=255u8).filter(|&v| first(kind, v) == SPACE).collect::<Vec<_>>();
    assert_eq!(reserved(b'E'), [12, 57, 102, 147, 192, 237]);
    assert_eq!(reserved(b'F'), [26, 71, 116, 161, 206, 251]);
    assert_eq!(reserved(b'R'), [14, 59, 104, 149, 194, 239]);
    // Today's codes, as made: their text keeps its first character.
    let me = id(1);
    let env = me.seal_as_author(&me.sign_card(&editor_card()).unwrap(), None).unwrap();
    let QrPlan::Single { text } = qr_plan(&env).unwrap() else { panic!() };
    for t in [text, me.recipient_code("kitsu").unwrap()] {
        assert!(!t.starts_with(' ') && !t.ends_with(' '), "{t:?}");
    }
    assert!(!reserved(b'E').contains(&env[1]));
}

#[test]
fn links_round_trip_and_refuse_tampering() {
    let me = id(1);
    let env = me.seal_as_author(&me.sign_card(&editor_card()).unwrap(), None).unwrap();
    let link = card_link("https://pips.example/c", &env).unwrap();
    assert!(link.starts_with("https://pips.example/c#R")); // b'E' in base64url
    assert_eq!(parse_link(&link).unwrap(), env);
    let Scanned::Envelope { bytes } = classify(&link) else { panic!("printed-card links scan") };
    assert_eq!(bytes, env);

    assert_eq!(card_link("http://pips.example", &env).unwrap_err().code, "bad_link");
    assert_eq!(card_link("https://a.example/#x", &env).unwrap_err().code, "bad_link");
    assert_eq!(parse_link("https://pips.example/c").unwrap_err().code, "bad_link");
    // A changed character either fails to decode or fails verification.
    let mut bad = link.clone().into_bytes();
    let i = bad.len() - 10;
    bad[i] = if bad[i] == b'A' { b'B' } else { b'A' };
    let bad = String::from_utf8(bad).unwrap();
    assert!(parse_link(&bad).map_or(true, |b| open_envelope(&b).is_err()));
}

#[test]
fn identity_recovery_paths_agree() {
    let me = id(9);
    assert_eq!(Identity::from_words(&me.words()).unwrap().public_key(), me.public_key());
    assert_eq!(Identity::from_paper(&me.paper()).unwrap().public_key(), me.public_key());
    assert_eq!(Identity::from_seed(&me.seed()).unwrap().public_key(), me.public_key());
    assert_eq!(classify(&me.paper()), Scanned::PaperKey);
    assert_eq!(Identity::from_seed(&[0; 31]).err().unwrap().code, "bad_seed");
    assert_eq!(Identity::from_words("cat dog").err().unwrap().code, "bad_words");
}

#[test]
fn render_and_palettes() {
    let mut card = editor_card();
    card.opaque = false;
    let img = render(&card, 0).unwrap();
    assert_eq!(img.rgba.len(), 16 * 16 * 4);
    assert_eq!(&img.rgba[..4], &[0, 0, 0, 0], "index 0 transparent");
    let p1 = &palettes()[1];
    assert_eq!(&img.rgba[4..8], &[p1.colors[1][0], p1.colors[1][1], p1.colors[1][2], 255]);
    assert_eq!(render(&card, 1).unwrap_err().code, "invalid_card");

    // A card too large to share still shows (it is checked, not
    // compressed); a pixel outside the palette does not.
    let mut big = editor_card();
    big.width = 128;
    big.height = 128;
    big.frames = 16;
    big.delay_ms = 100;
    big.palette = PaletteData::Inline((0..32).map(|i| [i * 8, 0, 0]).collect());
    let mut s = 1u32;
    big.pixels = (0..128 * 128 * 16)
        .map(|_| {
            s = s.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
            u8::try_from(s >> 27).unwrap()
        })
        .collect();
    assert!(share_size(&big).is_err(), "too large to share");
    assert_eq!(render(&big, 15).unwrap().rgba.len(), 128 * 128 * 4);
    big.pixels[7] = 200;
    assert_eq!(render(&big, 0).unwrap_err().code, "invalid_card");

    assert_eq!(palettes().len(), 33);
    let imported = parse_palette(b"GIMP Palette\nName: Two\n0 0 0\n255 255 255\n").unwrap();
    assert_eq!(imported.colors, vec![[0, 0, 0], [255, 255, 255]]);
    assert_eq!(parse_palette(b"nope").unwrap_err().code, "bad_palette");
}

#[test]
fn editor_errors_have_codes() {
    // A field the person typed is named, so that the app can say which.
    let mut card = editor_card();
    card.link = "javascript:alert(1)".into();
    assert_eq!(share_size(&card).unwrap_err().code, "bad_site");
    let mut card = editor_card();
    card.title = "a\u{202E}b".into();
    assert_eq!(share_size(&card).unwrap_err().code, "bad_title");
    let mut card = editor_card();
    card.author = " kitsu".into();
    assert_eq!(share_size(&card).unwrap_err().code, "bad_author");
    let mut card = editor_card();
    card.handle = Some(HandleData { network: "telegram".into(), text: "two words".into() });
    assert_eq!(share_size(&card).unwrap_err().code, "bad_handle");
    let mut card = editor_card();
    card.handle = Some(HandleData { network: "myspace".into(), text: "@x".into() });
    assert_eq!(share_size(&card).unwrap_err().code, "invalid_card");
    let mut card = editor_card();
    card.palette = PaletteData::Inline(vec![[0, 0, 0]]);
    assert_eq!(share_size(&card).unwrap_err().code, "bad_palette");
}

#[test]
fn unknown_and_hostile_scans() {
    for text in ["", "hello", "https://example.com", "https://example.com/#!!!", "PIPS", "ZZZZZZ"] {
        assert_eq!(classify(text), Scanned::Unknown, "{text:?}");
    }
    assert!(open_envelope(b"E").is_err());
    assert!(open_envelope(&[]).is_err());
}

#[test]
fn inspect_stored_payloads() {
    let me = id(1);
    let payload = me.sign_card(&editor_card()).unwrap();
    let i = inspect_card(&payload).unwrap();
    assert_eq!(i.card, editor_card());
    assert_eq!(i.author.unwrap(), me.public_key());
    let env = me.seal_as_author(&payload, None).unwrap();
    assert_eq!(open_envelope(&env).unwrap().digest, i.digest);
    let mut bad = payload.clone();
    let n = bad.len() - 1;
    bad[n] ^= 1;
    assert_eq!(inspect_card(&bad).unwrap_err().code, "bad_signature");
}

#[test]
fn imported_picture_becomes_a_signable_card() {
    use pips_wasm::api::{self, import_picture, ImportOptions};
    let file =
        std::fs::read(concat!(env!("CARGO_MANIFEST_DIR"), "/../pips-raster/tests/aseprite/linked_cels.aseprite"))
            .unwrap();
    let mut got = import_picture(&file, ImportOptions::default()).unwrap();
    assert_eq!((got.card.width, got.card.frames, got.scale), (16, 3, 1));
    got.card.title = "linked".into();
    assert!(api::share_size(&got.card).unwrap() < 600);
    let id = api::Identity::from_seed(&[7; 32]).unwrap();
    let payload = id.sign_card(&got.card).unwrap();
    assert_eq!(api::inspect_card(&payload).unwrap().card.title, "linked");
}

#[test]
fn import_errors_carry_their_numbers() {
    use pips_wasm::api::{import_picture, ImportOptions};
    let file =
        std::fs::read(concat!(env!("CARGO_MANIFEST_DIR"), "/../pips-raster/tests/aseprite/transparency.aseprite"))
            .unwrap();
    let e = import_picture(&file, ImportOptions::default()).unwrap_err();
    assert_eq!((e.code.as_str(), e.args.as_slice()), ("partial_alpha", &[3, 4, 1][..]));
    assert_eq!(import_picture(b"nope", ImportOptions::default()).unwrap_err().code, "unknown_format");
}

#[test]
fn backup_round_trip_restores_records_and_editions() {
    use pips_wasm::api::{backup_owner, BackupCard, BackupData, FromData, IssueLogData, IssuedData, ProfileData};
    let me = Identity::from_seed(&[1; 32]).unwrap();
    let artist = Identity::from_seed(&[2; 32]).unwrap();
    let own = me.sign_card(&editor_card()).unwrap();
    let theirs = artist.sign_card(&editor_card()).unwrap();
    let rc = classify(&me.recipient_code("me").unwrap());
    let Scanned::Recipient { bytes: recipient, .. } = rc else { panic!("{rc:?}") };
    let cert = artist.issue(&theirs, 2, 5, &recipient, 20_381).unwrap();
    let opened = open_envelope(&artist.seal_as_author(&theirs, Some(&cert)).unwrap()).unwrap();
    let card = |payload: Vec<u8>, mine: bool| BackupCard {
        payload,
        mine,
        state: "collection".into(),
        received: 1_760_000_000_123,
        trashed_at: None,
        cert: None,
        from: None,
        note: String::new(),
        edition: None,
        editions: None,
        tags: vec!["свои".into()],
    };
    let data = BackupData {
        created: 1_760_000_000_999,
        profile: ProfileData { nick: "me".into(), handle: None, link: "me.art".into() },
        cards: vec![
            BackupCard {
                editions: Some(IssueLogData {
                    of: 0,
                    issued: vec![IssuedData { edition: 1, nick: "x".into(), holder: artist.public_key().hex, day: 7 }],
                }),
                ..card(own, true)
            },
            BackupCard {
                cert: opened.certificate.as_ref().map(|c| c.bytes.clone()),
                from: Some(FromData { nick: "dapple".into(), key: artist.public_key().hex }),
                note: "заметка".into(),
                // A stale bin time outside the bin is dropped, not refused.
                trashed_at: Some(5),
                ..card(opened.payload.clone(), false)
            },
            BackupCard { state: "trash".into(), trashed_at: Some(1_760_000_500_000), ..card(theirs, false) },
        ],
    };
    let file = me.seal_backup(&data, &[9; 24]).unwrap();
    assert_eq!(backup_owner(&file).unwrap(), me.public_key());
    let back = me.open_backup(&file).unwrap();
    assert_eq!(back.cards[1].trashed_at, None);
    let ed = back.cards[1].edition.as_ref().unwrap();
    assert_eq!((ed.edition, ed.of, ed.day, ed.holder.as_str()), (2, 5, 20_381, me.public_key().hex.as_str()));
    assert_eq!(back.cards[2].trashed_at, Some(1_760_000_500_000));
    assert_eq!(back.cards[1].note, "заметка");
    assert_eq!(back.cards[0].editions.as_ref().unwrap().issued[0].holder, artist.public_key().hex);

    let e = artist.open_backup(&file).unwrap_err();
    assert_eq!((e.code.as_str(), e.message), ("other_owner", me.public_key().short));
}

/// Every error a picture or a backup can fail with today has a code of its
/// own in the core's list, not the fallback for an error the list does not
/// know; and the list names each code once.
#[test]
fn every_error_has_its_own_code() {
    use pips_raster::Error as R;
    use pips_store::Error as S;
    use pips_wasm::codes::{of_raster, of_store, Code};
    let raster = [
        R::UnknownFormat,
        R::TooLarge,
        R::Malformed("x"),
        R::Unsupported("x"),
        R::PartialAlpha { x: 0, y: 0, frame: 0 },
        R::TooBig { width: 1, height: 1 },
        R::TooManyColors(33),
        R::TooManyFrames,
        R::UnequalDelays,
        R::DelayOutOfRange(1),
    ];
    for e in &raster {
        assert_eq!(of_raster(e).as_str(), e.code(), "{e:?}");
    }
    let store = [S::NotABackup, S::NewerVersion(2), S::OtherOwner([0; 32]), S::Damaged, S::TooLarge, S::Invalid("x")];
    for e in &store {
        assert_eq!(of_store(e).as_str(), e.code(), "{e:?}");
    }
    let mut names: Vec<_> = Code::ALL.iter().map(|c| c.as_str()).collect();
    names.sort_unstable();
    names.dedup();
    assert_eq!(names.len(), Code::ALL.len(), "a code listed twice");
    assert!(Code::ALL.iter().all(|&c| Code::named(c.as_str()) == Some(c)));
}

/// The bytes of a key from its hex.
fn key_bytes(hex: &str) -> Vec<u8> {
    (0..hex.len()).step_by(2).map(|i| u8::from_str_radix(&hex[i..i + 2], 16).unwrap()).collect()
}

/// A key kept elsewhere, as a browser keeps one: it signs bytes, nothing
/// more of it is seen.
fn elsewhere(seed: [u8; 32]) -> impl Fn(&[u8]) -> Vec<u8> {
    use ed25519_dalek::Signer;
    let key = ed25519_dalek::SigningKey::from_bytes(&seed);
    move |m| key.sign(m).to_bytes().to_vec()
}

/// With the key kept elsewhere, every signing in two steps — card,
/// numbered copy, envelope passed on — and every backup gives the same
/// bytes as an Identity holding the secret.
#[test]
fn a_key_kept_elsewhere_makes_the_same_bytes_as_one_held() {
    use pips_wasm::api::{
        card_to_sign, edition, edition_to_sign, open_backup_with, recipient_code, seal_backup_with, seal_own,
        sealed_by, sender_to_sign, signed_card, BackupData, ProfileData,
    };
    let held = Identity::from_seed(&[3; 32]).unwrap();
    let sign = elsewhere([3; 32]);
    let me = key_bytes(&held.public_key().hex);
    let other = Identity::from_seed(&[4; 32]).unwrap();

    let card = editor_card();
    let payload = signed_card(&card, &me, &sign(&card_to_sign(&card).unwrap())).unwrap();
    assert_eq!(payload, held.sign_card(&card).unwrap());

    assert_eq!(recipient_code(&me, "me").unwrap(), held.recipient_code("me").unwrap());
    let rc = classify(&other.recipient_code("dapple").unwrap());
    let Scanned::Recipient { bytes: to, .. } = rc else { panic!("{rc:?}") };
    let m = edition_to_sign(&payload, 1, 3, &to, 20_400, &me).unwrap();
    let cert = edition(&payload, 1, 3, &to, 20_400, &me, &sign(&m)).unwrap();
    assert_eq!(cert, held.issue(&payload, 1, 3, &to, 20_400).unwrap());
    assert_eq!(seal_own(&payload, Some(&cert)).unwrap(), held.seal_as_author(&payload, Some(&cert)).unwrap());

    let theirs = other.sign_card(&card).unwrap();
    let env = sealed_by(&theirs, "me", &me, &sign(&sender_to_sign(&theirs, "me").unwrap())).unwrap();
    assert_eq!(env, held.seal_as_sender(&theirs, "me").unwrap());

    let data = BackupData {
        created: 1_760_000_000_999,
        profile: ProfileData { nick: "me".into(), handle: None, link: String::new() },
        cards: vec![],
    };
    let kept = held.backup_key();
    let file = seal_backup_with(&data, &me, &kept, &[9; 24]).unwrap();
    assert_eq!(file, held.seal_backup(&data, &[9; 24]).unwrap());
    assert_eq!(open_backup_with(&file, &me, &kept).unwrap(), held.open_backup(&file).unwrap());
}

/// A signature made elsewhere is checked before it is used; bytes of the
/// wrong length are told apart.
#[test]
fn a_signature_from_elsewhere_that_does_not_fit_is_refused() {
    use pips_wasm::api::{card_to_sign, sealed_by, sender_to_sign, signed_card};
    let held = Identity::from_seed(&[3; 32]).unwrap();
    let me = key_bytes(&held.public_key().hex);
    let card = editor_card();
    let wrong = elsewhere([5; 32])(&card_to_sign(&card).unwrap());
    assert_eq!(signed_card(&card, &me, &wrong).unwrap_err().code, "bad_signature");
    assert_eq!(signed_card(&card, &me, &wrong[..63]).unwrap_err().code, "bad_signature");
    assert_eq!(signed_card(&card, &me[..31], &wrong).unwrap_err().code, "bad_key");
    let theirs = Identity::from_seed(&[4; 32]).unwrap().sign_card(&card).unwrap();
    let good = elsewhere([3; 32])(&sender_to_sign(&theirs, "me").unwrap());
    assert_eq!(sealed_by(&theirs, "not me", &me, &good).unwrap_err().code, "bad_signature");
}
