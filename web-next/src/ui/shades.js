// @ts-check
// The papers a card may be framed on: the format's `frame` field (0..=15)
// names one; those not yet given a colour fall back to the first. From
// web/src/ui/card.js, colour for colour: a card looks the same in both apps.

/** @typedef {{ paper: string, ink: string, dim: string }} Shade */

/** @type {readonly Shade[]} */
export const FRAME_SHADES = Object.freeze([
  { paper: '#f6f3eb', ink: '#1c1d22', dim: '#8e8578' }, // paper
  { paper: '#e3dccb', ink: '#1c1d22', dim: '#857b6b' }, // bone
  { paper: '#dde3e8', ink: '#1b2027', dim: '#6f7a86' }, // mist
  { paper: '#dce5d3', ink: '#1d241b', dim: '#6e7c66' }, // sage
  { paper: '#f1dddc', ink: '#2a1b1d', dim: '#8f7072' }, // blush
  { paper: '#ebd9b8', ink: '#2b2214', dim: '#8b7656' }, // sand
  { paper: '#3a3f4b', ink: '#f1efe9', dim: '#a9aebb' }, // slate
  { paper: '#1e1f25', ink: '#edebe4', dim: '#8b8f9c' }, // night
]);

/** The shade a card names, or the first. @param {number} frame */
export const shadeOf = (frame) => FRAME_SHADES[frame] ?? FRAME_SHADES[0];
