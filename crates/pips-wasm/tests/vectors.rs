//! The bytes Pips puts into the world, pinned.
//!
//! A card, once given, is read by every later version of the app, and its
//! signatures checked. The other tests make something and read it back,
//! which still passes if the writing and the reading change together — and
//! every card already given would then fail. Here fixed keys and cards give
//! fixed bytes, written down once. **A failure here is never fixed by
//! changing the expected value**: it means a change broke the format, and
//! the change is what goes. A new version of a structure gets new vectors
//! beside these; these stay.
//!
//! Longer outputs are pinned by their SHA-256; short ones in full. Those
//! pinned in full are also read back, by today's reader, as what they were
//! made from: a reader that drifts from the writer is caught as well.

use pips_format::{canonical_bytes, decode, digest, encode, Animation, Card, Extension, Handle, Network, PaletteRef};
use pips_palette::{Palette, Rgb, BUILTINS};
use pips_sign::recovery::{from_paper, from_words, to_paper, to_words};
use pips_sign::{open, seal, sign_card, verify_card, Certificate, RecipientCode, SecretKey};
use pips_store::{Backup, Entry, Place, Profile};
use pips_wasm::api::{card_link, classify, parse_link, qr_plan, Carousel, QrPlan, Scanned};
use sha2::{Digest as _, Sha256};

fn hex(b: &[u8]) -> String {
    const DIGITS: &[u8; 16] = b"0123456789abcdef";
    b.iter().flat_map(|x| [DIGITS[usize::from(x >> 4)], DIGITS[usize::from(x & 15)]]).map(char::from).collect()
}
fn unhex(s: &str) -> Vec<u8> {
    (0..s.len()).step_by(2).map(|i| u8::from_str_radix(&s[i..i + 2], 16).unwrap()).collect()
}
fn sha(b: &[u8]) -> String {
    hex(&Sha256::digest(b))
}
const fn rgb(r: u8, g: u8, b: u8) -> Rgb {
    Rgb { r, g, b }
}
fn key(n: u8) -> SecretKey {
    SecretKey::from_seed(&[n; 32])
}

/// A still card with everything on its back.
fn still() -> Card {
    let mut c = Card::new(16, 16);
    c.opaque = true;
    c.palette = PaletteRef::Builtin(1);
    c.pixels = (0..256u16).map(|i| u8::try_from((i * 7 + i / 16) % 32).unwrap()).collect();
    c.title = "Сова в ночи 🦉".into();
    c.author = "kitsu".into();
    c.handle = Some(Handle { network: Network::Bluesky, text: "@kitsu.bsky.social".into() });
    c.link = "kitsu.art/owl".into();
    c
}

/// An animated card in a palette of its own, with an extension to skip.
fn animated() -> Card {
    let mut c = Card::new(8, 4);
    c.palette = PaletteRef::Inline(Palette::new(&[rgb(0, 0, 0), rgb(255, 0, 77), rgb(41, 173, 255)]).unwrap());
    c.animation = Some(Animation { frames: 3, delay_ms: 120 });
    c.pixels = (0..96u8).map(|i| i % 3).collect();
    c.title = "Мигалка".into();
    c.author = "щука".into();
    c.extensions = vec![Extension { critical: false, tag: "acme.foil".into(), data: vec![1, 2, 3] }];
    c
}

fn signed(mut c: Card, by: &SecretKey) -> Card {
    sign_card(&mut c, by).unwrap();
    c
}

/// Every pinned value, by name.
fn computed() -> Vec<(&'static str, String)> {
    let (author, holder, friend) = (key(1), key(2), key(3));
    let card = signed(still(), &author);
    let anim = signed(animated(), &author);
    let payload = encode(&card).unwrap();
    let recipient = RecipientCode { key: holder.public_key(), nick: "мох".into() };
    let cert = Certificate::issue(&author, &card, 3, 10, holder.public_key(), 20_747).unwrap();
    let by_author = seal(&card, None, None).unwrap();
    let numbered = seal(&card, Some(&cert), None).unwrap();
    let passed = seal(&card, Some(&cert), Some((&friend, "друг"))).unwrap();
    let QrPlan::Single { text: qr } = qr_plan(&by_author).unwrap() else { panic!("one code") };

    // A card too big for one code: its first frames.
    let mut big = Card::new(64, 64);
    big.palette = PaletteRef::Builtin(1); // 32 colours
    let mut s = 1u32;
    big.pixels = (0..64 * 64)
        .map(|_| {
            s = s.wrapping_mul(1_103_515_245).wrapping_add(12_345);
            u8::try_from(s >> 27).unwrap()
        })
        .collect();
    let big = seal(&signed(big, &author), None, None).unwrap();
    let carousel = Carousel::new(&big).unwrap();

    let backup = Backup {
        created_ms: 1_790_000_000_000,
        profile: Profile {
            nick: "kitsu".into(),
            handle: Some(Handle { network: Network::Telegram, text: "@kitsu".into() }),
            link: "kitsu.art".into(),
        },
        cards: vec![Entry {
            payload: payload.clone(),
            mine: true,
            place: Place::Collection,
            received_ms: 1_790_000_000_000,
            binned_ms: None,
            certificate: None,
            sender: None,
            note: "первая".into(),
            issued: None,
            tags: vec!["совы".into()],
        }],
    };
    let mut palettes = Vec::new();
    for b in BUILTINS {
        palettes.push(b.id);
        for c in b.palette().colors() {
            palettes.extend_from_slice(&[c.r, c.g, c.b]);
        }
    }

    vec![
        ("public key 1", hex(&author.public_key().to_bytes())),
        ("words 1", to_words(&author).to_string()),
        ("paper key 1", to_paper(&author).to_string()),
        ("still: payload", hex(&payload)),
        ("still: canonical sha", sha(&canonical_bytes(&card).unwrap())),
        ("still: digest", hex(&digest(&card).unwrap())),
        ("still: signature", hex(&card.signature.unwrap().bytes)),
        ("animated: payload", hex(&encode(&anim).unwrap())),
        ("animated: digest", hex(&digest(&anim).unwrap())),
        ("recipient code", hex(&recipient.to_bytes().unwrap())),
        ("certificate", hex(&cert.to_bytes())),
        ("envelope by author", hex(&by_author)),
        ("envelope numbered sha", sha(&numbered)),
        ("envelope passed on sha", sha(&passed)),
        ("qr text", qr),
        ("link", card_link("https://pips-app.github.io/pips/", &by_author).unwrap()),
        ("carousel frames 0-1 sha", sha(format!("{}\n{}", carousel.frame_text(0), carousel.frame_text(1)).as_bytes())),
        ("backup sha", sha(&pips_store::seal(&backup, &author, [7; 24]).unwrap())),
        ("built-in palettes sha", sha(&palettes)),
    ]
}

/// Written once, from the code of November 2026; see the top of the file.
#[rustfmt::skip]
const EXPECTED: &[(&str, &str)] = &[
    ("public key 1", "8a88e3dd7409f195fd52db2d3cba5d72ca6709bf1d94121bf3748801b40f6f5c"),
    ("words 1", "absurd amount doctor acoustic avoid letter advice cage absurd amount doctor acoustic avoid letter advice cage absurd amount doctor acoustic avoid letter advice comic"),
    ("paper key 1", "PIPS:KEY:1:W50W50W50W50W50W50W50W50W50W50W50W50W50W50W50W500XH"),
    ("still: payload", "01051010010019d0a1d0bed0b2d0b020d0b220d0bdd0bed187d0b820f09fa689056b697473750412406b697473752e62736b792e736f6369616c0d6b697473752e6172742f6f776c0054005d8e590e802010c5705744dc5744ee7f4b87844c32efaf3f6daa1abbbf859eaf500f9bcb3b86e9fc2ab33e0c593b1ebeec19965b45952135448c54112355c448153152458c540d430e860c0c7918b2301460e8078a88e3dd7409f195fd52db2d3cba5d72ca6709bf1d94121bf3748801b40f6f5cec28ce851a8e4ffd7e0272529ed880d61667316bcde0932bd7bc09764c90d1183bbffec644d5e0b769ab961181edb98bab381d5962854ce80a49bedbfe76c708"),
    ("still: canonical sha", "069345310227ecf9bac7425d7fb90150b8495e495aabf3c954bab311c99c723c"),
    ("still: digest", "112db28c85de338660ced3d189b50a00185516c5cdd3046c32931993884992bf"),
    ("still: signature", "ec28ce851a8e4ffd7e0272529ed880d61667316bcde0932bd7bc09764c90d1183bbffec644d5e0b769ab961181edb98bab381d5962854ce80a49bedbfe76c708"),
    ("animated: payload", "01060804ff03000000ff004d29adff000378000ed09cd0b8d0b3d0b0d0bbd0bad0b008d189d183d0bad0b00000010961636d652e666f696c03000102031100b5c2010d0000008230b47f6852b09d9d928a88e3dd7409f195fd52db2d3cba5d72ca6709bf1d94121bf3748801b40f6f5c4497270064fd3bf19659869025eeac2b1bc0d50f304bd4d507d3311d113f6db03ecd0896e2f917611be835d429450eb4822edef27f1df69274160d6035d87f0b"),
    ("animated: digest", "5c3ec13f359c5f13970a40f654d2f2b95b86841f311d24f9d4868b4c5147e487"),
    ("recipient code", "52018139770ea87d175f56a35466c34c7ecccb8d8a91b4ee37a25df60f5b8fc9b39406d0bcd0bed185"),
    ("certificate", "0103000a008139770ea87d175f56a35466c34c7ecccb8d8a91b4ee37a25df60f5b8fc9b3940b51000071954e9bae4c29d22cee134d939741dcddfb9a14355f9f31fc7621e8ae0f0803dca25cfe0884170a884e86e745541680b2d1a98edc81f408ad4c5f1ff5f7e404"),
    ("envelope by author", "450100ff0001051010010019d0a1d0bed0b2d0b020d0b220d0bdd0bed187d0b820f09fa689056b697473750412406b697473752e62736b792e736f6369616c0d6b697473752e6172742f6f776c0054005d8e590e802010c5705744dc5744ee7f4b87844c32efaf3f6daa1abbbf859eaf500f9bcb3b86e9fc2ab33e0c593b1ebeec19965b45952135448c54112355c448153152458c540d430e860c0c7918b2301460e8078a88e3dd7409f195fd52db2d3cba5d72ca6709bf1d94121bf3748801b40f6f5cec28ce851a8e4ffd7e0272529ed880d61667316bcde0932bd7bc09764c90d1183bbffec644d5e0b769ab961181edb98bab381d5962854ce80a49bedbfe76c708"),
    ("envelope numbered sha", "d85743b8b85309c09826c3a88ebc4f8553052fe39bd6cfe05daa2c34a11c2f85"),
    ("envelope passed on sha", "37396cc8d0af0c062d365996d533b430a84a2c7f73f801526264e9ad46baff1f"),
    ("qr text", "PW8U50100 S0212P00*GQNHQBHQ9HQU64FNMMHQNHQ:LQHHQH74A8KMEH2QDLWEVZE$D22QDLWES E3KCIQDB*5U3EMEDVTD2QDLWES EGEC/UE54EITD*RAA$BSBB+8GI5249EXV8K1BZ6UUO9SWGYJ6/6M*%D3H3O9OX2KK5ADVJSN75QT-H5:$7SCB+*36%TG0J%Z8-84/T8BSA0L4S OPU21IAEXHKU1S$1ON1+DFVNM-P2:ET4NHD S5UEFOU51W*VRLU7R BKQPKA1CX30D2:YUW8HFYMN3EL%T*4Q3G325A%-FGKET3K.CGK$26B691QARIDCR$81PU9NJQ+O7H9WQV8HIS6GDW/I6JGOKN2TL/V3LKCNW9ND1Y5OR7WC7P"),
    ("link", "https://pips-app.github.io/pips/#RQEA_wABBRAQAQAZ0KHQvtCy0LAg0LIg0L3QvtGH0Lgg8J-miQVraXRzdQQSQGtpdHN1LmJza3kuc29jaWFsDWtpdHN1LmFydC9vd2wAVABdjlkOgCAQxXBXRNxXRO5_S4eETDLvrz9tqhq7v4Wer1APm8s7hun8KrM-DFk7Hr7sGZZbRZUhNUSMVBEjVcRIFTFSRYxUDUMOhgwMeRiyMBRg6AeKiOPddAnxlf1S2y08ul1yymcJvx2UEhvzdIgBtA9vXOwozoUajk_9fgJyUp7YgNYWZzFrzeCTK9e8CXZMkNEYO7_-xkTV4Ldpq5YRge25i6s4HVlihUzoCkm-2_52xwg"),
    ("carousel frames 0-1 sha", "0c1ca64017385e4efde3ba37a5dd42042756a446939dc4aa23fc07ca9ea11cdd"),
    ("backup sha", "98dd07bf8595dc8cd86c2e5df7b1f8a9440bd8a5f105dc3490560cbfef759ecc"),
    ("built-in palettes sha", "564dc544fcfdca32032e0de11cff4e4abf04893bb5dc684acea7d46db62515fb"),
];

#[test]
fn the_bytes_given_out_never_change() {
    let got = computed();
    assert_eq!(got.len(), EXPECTED.len(), "every value pinned");
    for ((name, value), (want_name, want)) in got.iter().zip(EXPECTED) {
        assert_eq!((name, value.as_str()), (want_name, *want), "{name} changed: the format broke");
    }
}

/// The value pinned under `name`.
fn pinned(name: &str) -> &'static str {
    EXPECTED.iter().find(|(n, _)| *n == name).unwrap().1
}

#[test]
fn the_bytes_given_out_are_read_as_they_were() {
    let (author, holder) = (key(1), key(2));
    let card = signed(still(), &author);

    assert_eq!(from_words(pinned("words 1")).unwrap().seed(), author.seed());
    assert_eq!(from_paper(pinned("paper key 1")).unwrap().seed(), author.seed());

    let still_back = decode(&unhex(pinned("still: payload"))).unwrap();
    assert_eq!(still_back, card);
    assert_eq!(verify_card(&still_back).unwrap(), author.public_key());
    let anim_back = decode(&unhex(pinned("animated: payload"))).unwrap();
    assert_eq!(anim_back, signed(animated(), &author), "the extension kept, to be signed with");
    assert_eq!(verify_card(&anim_back).unwrap(), author.public_key());

    let r = RecipientCode::from_bytes(&unhex(pinned("recipient code"))).unwrap();
    assert_eq!((r.key, r.nick.as_str()), (holder.public_key(), "мох"));
    let cert = Certificate::from_bytes(&unhex(pinned("certificate"))).unwrap();
    cert.verify(&card).unwrap();
    assert!(cert.is_held_by(&holder.public_key()));

    let envelope = unhex(pinned("envelope by author"));
    let opened = open(&envelope).unwrap();
    assert_eq!((opened.card, opened.author), (card, Some(author.public_key())));
    assert_eq!((opened.certificate, opened.sender), (None, None));
    let Scanned::Envelope { bytes } = classify(pinned("qr text")) else { panic!("the code is a card") };
    assert_eq!(bytes, envelope);
    assert_eq!(parse_link(pinned("link")).unwrap(), envelope);
}
