//! Camera frames: a width in the first two bytes (little-endian), the rest
//! RGBA rows. Two bytes, so widths reach past the reader's own limit
//! (`pips_qr::scan::MAX_SIDE`, 2560): wide frames, and their refusal.
#![no_main]
use libfuzzer_sys::fuzz_target;

fuzz_target!(|data: &[u8]| {
    let [lo, hi, rgba @ ..] = data else { return };
    let w = usize::from(u16::from_le_bytes([*lo, *hi])).max(1);
    let h = rgba.len() / 4 / w;
    let _ = pips_qr::scan::read_rgba(&rgba[..w * h * 4], w, h);
});
