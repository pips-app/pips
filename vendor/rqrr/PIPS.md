# rqrr 0.11.0, with three fixes

A copy of [rqrr](https://github.com/WanzenBug/rqrr) 0.11.0 as published on
crates.io (MIT OR Apache-2.0, and ISC: see the LICENSE files), used by
`pips-qr`'s reader through `[patch.crates-io]` in the workspace's
`Cargo.toml` (and `fuzz/Cargo.toml`).

The first change, in `src/geometry.rs`, `Perspective::map`, marked `Pips:`.
A perspective made from four corners that are not a convex shape — noise
in a camera frame, found by fuzzing `pips-qr`'s reader — maps some points
through a denominator of zero. `map` asserted that the result fits an
`i32`, and the assert failed: a panic, which in WebAssembly cannot be
caught and leaves the module's stack where it was. Now such a point is
clamped far off the picture (reads of it are clamped to the picture
anyway). The test `a_point_through_a_degenerate_perspective_is_far_off_not_a_panic`
fails without the change.

The second, in `src/identify/grid.rs`, `find_alignment_pattern`, marked
`Pips:`, also found by fuzzing. Such a perspective can also put the
alignment pattern's estimated place thousands of pixels off a small
picture, with a size estimate of millions of pixels; the search then
spiralled out step by step over nothing — about a billion steps, three
seconds natively for a 58×45 frame, more in WebAssembly, where the reader
runs on the page's main thread. Now an estimate larger than twice the
picture is refused at once (no region on the picture can be that large),
and a run of the spiral wholly off the picture is passed in one step
(off the picture no point is ever checked). What the search finds on any
picture is unchanged. The test
`a_spiral_run_is_off_the_picture_only_when_all_of_it_is` checks the run
test; `pips-qr`'s `a_frame_that_aims_the_alignment_search_far_off_is_answered_at_once`
fails without the change.

The third, in `src/identify/grid.rs`, `rotate_capstone`, marked `Pips:`,
found by fuzzing with the second's frames as seeds: a capstone whose four
corners, rotated, make no perspective (`Perspective::create` gives `None`)
hit an `expect` — again a panic. Now the group is simply not a code.
`pips-qr`'s `a_frame_with_a_flat_capstone_reads_as_nothing_not_a_panic`
fails without the change.

Other `assert!`s and `expect`s remain in the crate (the timing scan's
`scan >= 1`, a neighbour distance of zero, the region cache); no input has
reached them yet, and the `scan` fuzz target keeps trying.

Back to the crates.io release once one carries these fixes. Nothing else here
differs from the published crate (`Cargo.lock` and `Cargo.toml.orig` left
out); compare with `cargo download rqrr@0.11.0` or the crate's source.

    cargo test --manifest-path vendor/rqrr/Cargo.toml --lib
