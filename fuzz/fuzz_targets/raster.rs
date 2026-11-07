//! PNG and Aseprite files, decoded and then converted the way the app does:
//! exact colours, the fitted palette offered for many-coloured pictures, and
//! the nearest colours of a built-in palette — with the app's other choices
//! (first frame only, upscaling kept) taken from the file's length, so that
//! every input tries one mix of them without slowing each run down.
#![no_main]
use libfuzzer_sys::fuzz_target;
use pips_format::PaletteRef;
use pips_raster::{import, Options, Target};

fuzz_target!(|data: &[u8]| {
    if pips_raster::decode(data).is_ok() {
        let n = data.len();
        // Ids up to 63 are built-in palettes' (some not yet made: refused).
        let id = u8::try_from(n % 64).unwrap_or(0);
        let fit = u8::try_from(n % 31).unwrap_or(0) + 2;
        let tries = [
            (Target::Auto, false),
            (Target::Reduce(16), false),
            (Target::Auto, true),
            (Target::Nearest(PaletteRef::Builtin(id)), n % 2 == 0),
            (Target::Reduce(fit), n % 3 == 0),
        ];
        for (i, (target, solid_alpha)) in tries.into_iter().enumerate() {
            let mixed = i >= 3;
            let options = Options {
                target,
                solid_alpha,
                unscale: !(mixed && n % 5 == 0),
                first_frame_only: mixed && n % 7 < 3,
            };
            if let Ok((picture, _)) = import(data, &options) {
                let mut card = pips_format::Card::new(1, 1);
                picture.apply_to(&mut card);
                pips_format::encode(&card).expect("an imported picture is a valid card");
            }
        }
    }
});
