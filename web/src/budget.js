// @ts-check
// What a card may be to be signed in the app, whichever way it was made
// (drawn or imported): at most MAX_EDGE pixels a side, and quick enough to
// pass from phone to phone. The format allows more (128 a side, 64 KB);
// the app holds itself to what is pleasant to hand over.
//
// How long a card takes to pass, by its size in bytes.
//
// Up to SINGLE bytes it is one QR code. Beyond, a carousel: fragments of
// FRAGMENT bytes, each shown for 220 ms; a camera with our own decoder takes
// in a new one about every 0.36 s, and needs about two more than there are
// fragments. Pointing the camera takes ~1.5 s. LIMIT is where the wait
// reaches ~10 s, when people start asking how much longer (see DECISIONS.md).

export const SINGLE = 600; // pips-qr SINGLE_MAX
export const FRAGMENT = 200; // pips-qr DEFAULT_FRAGMENT
export const LIMIT = 4000;
const AIM_S = 1.5, PER_CODE_S = 0.36, SPARE = 2;

/**
 * @param {number} bytes the signed card in its envelope (core.shareSize)
 * @returns {{bytes: number, codes: number, seconds: number, level: 'one'|'loop'|'over'}}
 */
export function budget(bytes) {
  const one = bytes <= SINGLE;
  const codes = one ? 1 : Math.ceil(bytes / FRAGMENT);
  const seconds = Math.round(one ? AIM_S : AIM_S + PER_CODE_S * (codes + SPARE));
  return { bytes, codes, seconds: Math.max(1, seconds), level: bytes > LIMIT ? 'over' : one ? 'one' : 'loop' };
}

/** The app's largest canvas, a side (the format allows 128; see DECISIONS.md). */
export const MAX_EDGE = 64;

/**
 * Whether a card may be signed here, and what passing it on costs.
 * @param {{width: number, height: number}} card
 * @param {number} bytes the signed card in its envelope (core.shareSize)
 * @returns {{cost: ReturnType<typeof budget>, refused: null | 'too_big' | 'too_slow'}}
 */
export function issuable(card, bytes) {
  const cost = budget(bytes);
  const refused = Math.max(card.width, card.height) > MAX_EDGE ? 'too_big' : cost.level === 'over' ? 'too_slow' : null;
  return { cost, refused };
}
