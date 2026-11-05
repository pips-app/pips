//! Text as it comes from a scanned code or a pasted or opened link: what it
//! is, and the card a link carries.
#![no_main]
use libfuzzer_sys::fuzz_target;
use pips_wasm::api::{classify, parse_link, Scanned};

fuzz_target!(|data: &[u8]| {
    let Ok(text) = core::str::from_utf8(data) else { return };
    if let Ok(bytes) = parse_link(text) {
        assert_eq!(bytes.first(), Some(&b'E'), "a link gives only an envelope");
    }
    if let Scanned::Envelope { bytes } = classify(text) {
        assert_eq!(bytes.first(), Some(&b'E'));
    }
});
