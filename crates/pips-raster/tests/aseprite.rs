//! The decoder against Aseprite's own exports.

use pips_raster::{decode, Error, Raster};

fn load(name: &str) -> Vec<u8> {
    std::fs::read(format!("{}/tests/aseprite/{name}", env!("CARGO_MANIFEST_DIR"))).unwrap()
}

/// Every exported frame equals the PNG Aseprite exported for it. Colour under a
/// fully transparent pixel is not compared: it is invisible and exporters
/// differ.
fn matches_exports(stem: &str, exports: &[&str]) {
    let r: Raster = decode(&load(&format!("{stem}.aseprite"))).unwrap();
    assert!(exports.len() <= r.frames.len(), "{stem}: more exports than frames");
    for (i, png) in exports.iter().enumerate() {
        let want = decode(&load(png)).unwrap();
        assert_eq!((want.width, want.height), (r.width, r.height), "{png}");
        for (n, (a, b)) in want.frames[0].pixels.iter().zip(&r.frames[i].pixels).enumerate() {
            assert!(a[3] == 0 && b[3] == 0 || a == b, "{stem} frame {i} pixel {n}: want {a:?}, got {b:?}");
        }
    }
}

#[test]
fn rgba() {
    matches_exports("basic-16x16", &["basic-16x16.png"]);
}

#[test]
fn background_layer() {
    matches_exports("background", &["background.png"]);
}

#[test]
fn grayscale() {
    matches_exports("grayscale", &["grayscale.png"]);
}

#[test]
fn indexed_with_transparent_index() {
    matches_exports("indexed", &["indexed_01.png"]); // only frame 1 was exported
}

#[test]
fn old_palette_chunk() {
    matches_exports("256_color_old_palette_chunk", &["256_color_old_palette_chunk.png"]);
}

#[test]
fn groups_and_hidden_layers() {
    let f = ["layers_and_tags_01.png", "layers_and_tags_02.png", "layers_and_tags_03.png", "layers_and_tags_04.png"];
    matches_exports("layers_and_tags", &f);
}

#[test]
fn linked_cels() {
    matches_exports("linked_cels", &["linked_cels_01.png", "linked_cels_02.png", "linked_cels_03.png"]);
}

#[test]
fn semi_transparent_blending_matches_aseprite_exactly() {
    matches_exports("transparency", &["transparency_01.png", "transparency_02.png"]);
}

#[test]
fn tilemaps_are_refused() {
    assert_eq!(decode(&load("tilemap.aseprite")), Err(Error::Unsupported("tilemap layers")));
}

/// Start and kind of each chunk in the first frame.
fn chunks(b: &[u8]) -> Vec<(usize, u16)> {
    let u32_at = |p: usize| u32::from_le_bytes(b[p..p + 4].try_into().unwrap()) as usize;
    let n = match u32_at(128 + 12) {
        0 => usize::from(u16::from_le_bytes([b[128 + 6], b[128 + 7]])),
        n => n,
    };
    let mut at = 128 + 16;
    let mut out = Vec::new();
    for _ in 0..n {
        out.push((at, u16::from_le_bytes([b[at + 4], b[at + 5]])));
        at += u32_at(at);
    }
    out
}

/// Offsets of the layer chunks' data in the first frame.
fn layer_chunks(b: &[u8]) -> Vec<usize> {
    chunks(b).into_iter().filter(|&(_, k)| k == 0x2004).map(|(at, _)| at + 6).collect()
}

/// Offset of the first cel chunk's data in the first frame.
fn first_cel(b: &[u8]) -> usize {
    chunks(b).into_iter().find(|&(_, k)| k == 0x2005).unwrap().0 + 6
}

#[test]
fn other_blend_modes_are_refused() {
    let mut b = load("basic-16x16.aseprite");
    let layer = layer_chunks(&b)[0];
    b[layer + 10] = 1; // multiply
    assert_eq!(decode(&b), Err(Error::Unsupported("blend modes other than normal")));
    b[layer] &= !1; // ...but not on a hidden layer
    assert!(decode(&b).is_ok());
}

#[test]
fn translucent_groups_are_refused() {
    let mut b = load("layers_and_tags.aseprite");
    let group = layer_chunks(&b)[3];
    b[group + 12] = 128;
    assert_eq!(decode(&b), Err(Error::Unsupported("groups with opacity or a blend mode")));
}

#[test]
fn a_second_cel_on_one_layer_in_one_frame_is_refused() {
    let mut b = load("basic-16x16.aseprite");
    let at = first_cel(&b) - 6;
    let len = u32::from_le_bytes(b[at..at + 4].try_into().unwrap()) as usize;
    let copy = b[at..at + len].to_vec();
    b.splice(at + len..at + len, copy);
    // The file, the frame and the frame's chunk count grow by one cel.
    let grow = |b: &mut Vec<u8>, p: usize, by: u32| {
        let v = u32::from_le_bytes(b[p..p + 4].try_into().unwrap()) + by;
        b[p..p + 4].copy_from_slice(&v.to_le_bytes());
    };
    grow(&mut b, 0, u32::try_from(len).unwrap());
    grow(&mut b, 128, u32::try_from(len).unwrap());
    let old = u16::from_le_bytes([b[128 + 6], b[128 + 7]]);
    b[128 + 6..128 + 8].copy_from_slice(&(old + 1).to_le_bytes());
    if u32::from_le_bytes(b[128 + 12..128 + 16].try_into().unwrap()) != 0 {
        grow(&mut b, 128 + 12, 1);
    }
    assert_eq!(decode(&b), Err(Error::Malformed("two cels on one layer in one frame")));
}

/// A cel moved partly or wholly off the canvas shows just its part on it.
#[test]
fn a_cel_off_the_canvas_shows_only_what_is_on_it() {
    let b = load("basic-16x16.aseprite");
    let at = first_cel(&b);
    let base = decode(&b).unwrap();
    let (w, h) = (base.width as usize, base.height as usize);
    let (x0, y0) = (i16::from_le_bytes([b[at + 2], b[at + 3]]), i16::from_le_bytes([b[at + 4], b[at + 5]]));
    for (dx, dy) in [(-3i16, 0i16), (0, 5), (-20, 0), (0, 20), (7, -9)] {
        let mut m = b.clone();
        m[at + 2..at + 4].copy_from_slice(&(x0 + dx).to_le_bytes());
        m[at + 4..at + 6].copy_from_slice(&(y0 + dy).to_le_bytes());
        let moved = decode(&m).unwrap();
        for y in 0..h {
            for x in 0..w {
                // Where this pixel was before the move, if on the canvas.
                let back = |v: usize, d: i16, size: usize| {
                    usize::try_from(i32::try_from(v).unwrap() - i32::from(d)).ok().filter(|&s| s < size)
                };
                let want = match (back(x, dx, w), back(y, dy, h)) {
                    (Some(sx), Some(sy)) => base.frames[0].pixels[sy * w + sx],
                    _ => [0; 4],
                };
                let got = moved.frames[0].pixels[y * w + x];
                assert!(want[3] == 0 && got[3] == 0 || want == got, "moved by ({dx}, {dy}): pixel ({x}, {y})");
            }
        }
    }
}

/// No prefix of a valid file decodes, and none panics.
#[test]
fn every_truncation_is_an_error() {
    for name in ["linked_cels.aseprite", "indexed.aseprite", "layers_and_tags.aseprite"] {
        let b = load(name);
        for n in 0..b.len() {
            assert!(decode(&b[..n]).is_err(), "{name} cut at {n}");
        }
    }
}

/// Damaged bytes never panic or run away; the result may be anything else.
#[test]
fn corruption_never_panics() {
    let b = load("layers_and_tags.aseprite");
    let mut x: u64 = 0x9E37_79B9_7F4A_7C15;
    for _ in 0..3000 {
        let mut m = b.clone();
        for _ in 0..3 {
            x ^= x << 13;
            x ^= x >> 7;
            x ^= x << 17;
            let i = usize::try_from(x % m.len() as u64).unwrap();
            m[i] ^= 1 << (x >> 61);
        }
        let _ = decode(&m);
    }
}

#[test]
fn animation_becomes_an_animated_card() {
    use pips_raster::{import, Options};
    let b = load("linked_cels.aseprite");
    let (p, report) = import(&b, &Options::default()).unwrap();
    let a = p.animation.expect("animated");
    assert_eq!((a.frames, report.source_frames), (3, 3));
    assert_eq!(p.pixels.len(), 3 * 16 * 16);

    let (still, _) = import(&b, &Options { first_frame_only: true, ..Options::default() }).unwrap();
    assert_eq!((still.animation, still.pixels.len()), (None, 16 * 16));
    assert_eq!(still.pixels[..], p.pixels[..256]);
}
