# rqrr 0.11.0, with one fix

A copy of [rqrr](https://github.com/WanzenBug/rqrr) 0.11.0 as published on
crates.io (MIT OR Apache-2.0, and ISC: see the LICENSE files), used by
`pips-qr`'s reader through `[patch.crates-io]` in the workspace's
`Cargo.toml` (and `fuzz/Cargo.toml`).

The one change, in `src/geometry.rs`, `Perspective::map`, marked `Pips:`.
A perspective made from four corners that are not a convex shape — noise
in a camera frame, found by fuzzing `pips-qr`'s reader — maps some points
through a denominator of zero. `map` asserted that the result fits an
`i32`, and the assert failed: a panic, which in WebAssembly cannot be
caught and leaves the module's stack where it was. Now such a point is
clamped far off the picture (reads of it are clamped to the picture
anyway). The test `a_point_through_a_degenerate_perspective_is_far_off_not_a_panic`
fails without the change.

Back to the crates.io release once one carries a fix. Nothing else here
differs from the published crate (`Cargo.lock` and `Cargo.toml.orig` left
out); compare with `cargo download rqrr@0.11.0` or the crate's source.

    cargo test --manifest-path vendor/rqrr/Cargo.toml --lib
