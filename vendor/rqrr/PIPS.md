# rqrr 0.11.0, with fixes

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

The rest, marked `Pips:` too, were not found by fuzzing but are turned
from panics into refusals all the same: the crate reads camera frames, and
a frame should never be able to stop the module.

- `measure_timing_pattern` asserted that a timing scan crosses at least
  one change of colour. Three capstones on a picture all of one colour
  break it (`capstones_with_no_timing_pattern_between_them_are_no_code`);
  now such a group is not a code.
- `get_region` panicked on a white pixel and unwrapped the region cache;
  now it answers `None` (`a_white_pixel_has_no_region`,
  `a_pixel_of_a_region_the_cache_does_not_know_has_no_region`).
- `repaint_and_apply` panicked when asked to repaint white or with the
  colour already there, and `flood_fill` asserted the colours differ; now
  both paint nothing (`repainting_white_or_the_same_colour_paints_nothing`).
- `line_intersect` multiplied three coordinates in `i32`, which a picture
  2560 pixels a side already takes past its range: a panic in a debug
  build, a wrong point in a release one. Now it works in `i64` and a point
  that does not fit is no point
  (`lines_across_a_large_picture_meet_without_overflow`). The rest of the
  crate's arithmetic on points is products of two differences, which fit
  an `i32` for any side up to 2560 — and `pips-qr` now refuses a frame
  with a longer side (`scan::MAX_SIDE`), however few pixels it has.
- The ranking of neighbours sorted with `partial_cmp(..).expect(..)`; a
  score there is never NaN, so `total_cmp` gives the same order without a
  way to panic. `rotate_capstone`'s `expect` on four corners is `?`; the
  region cache's size is a constant checked when compiled.

What stays, and why:

- The decoder's `assert!`s (`RawData::push`, `correct_block`,
  `bits_remaining`, `take_bits`) and `mask_bit`'s `panic!` rest on the
  version tables and on three bits of the format word, not on the
  picture; `the_tables_keep_the_decoders_asserts_true` checks the tables.
- `prepare_from_bitmap` and `prepare_from_greyscale` `expect` that width
  times height does not overflow, and `without_preparation` asserts a
  black-and-white buffer: promises of the caller, which `pips-qr` keeps
  (`scan::MAX_PIXELS`, and the only buffer it makes is from `prepare`).

Back to the crates.io release once one carries these fixes. Nothing else here
differs from the published crate (`Cargo.lock` and `Cargo.toml.orig` left
out); compare with `cargo download rqrr@0.11.0` or the crate's source.

    cargo test --manifest-path vendor/rqrr/Cargo.toml --lib
