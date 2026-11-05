//! Camera frames: a width in the first byte, the rest RGBA rows.
#![no_main]
use libfuzzer_sys::fuzz_target;

fuzz_target!(|data: &[u8]| {
    let Some((&w, rgba)) = data.split_first() else { return };
    let w = usize::from(w).max(1);
    let h = rgba.len() / 4 / w;
    let _ = pips_qr::scan::read_rgba(&rgba[..w * h * 4], w, h);
});
