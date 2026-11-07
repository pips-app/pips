//! Everything a scanned code can be: envelope, certificate, recipient code.
//! And what the app does with an envelope that opens: it stores the card's
//! bytes and reads them back on the next start, so they must read back as
//! the same card by the same author.
#![no_main]
use libfuzzer_sys::fuzz_target;
use pips_wasm::api::{inspect_card, open_envelope};

fuzz_target!(|data: &[u8]| {
    let _ = pips_sign::open(data);
    if let Ok(opened) = open_envelope(data) {
        let stored = inspect_card(&opened.payload).expect("a card that opened reads back");
        assert_eq!(stored.digest, opened.digest);
        assert_eq!(stored.author, opened.author);
        assert_eq!(stored.card, opened.card);
    }
    let _ = pips_sign::Certificate::from_bytes(data);
    let _ = pips_sign::RecipientCode::from_bytes(data);
    if let Ok(text) = core::str::from_utf8(data) {
        let _ = pips_sign::recovery::from_words(text);
        let _ = pips_sign::recovery::from_paper(text);
    }
});
