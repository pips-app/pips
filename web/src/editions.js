// @ts-check
// The author's log of numbered copies: which number went to whom. Only
// the author's devices can keep it, so two logs of one card may differ —
// a backup restored over newer issues, or the same key on two phones. They
// are joined, not chosen between: a number in either log was handed out,
// and must not be handed out again.

/** @typedef {{edition: number, nick: string, holder: string, day: number}} Issue */
/** @typedef {{of: number, issued: Issue[]}} EditionLog */

/**
 * Both logs' copies, each once, by number. The run is the one already
 * fixed: a log with copies fixed it with its first.
 * @param {EditionLog|undefined} a this device's @param {EditionLog|undefined} b another's
 * @returns {EditionLog}
 */
export function joinLogs(a, b) {
  const seen = new Map();
  for (const i of [...(a?.issued ?? []), ...(b?.issued ?? [])]) seen.set(`${i.edition}:${i.holder}`, i);
  const issued = [...seen.values()].sort((x, y) => x.edition - y.edition || x.day - y.day);
  const of = a?.issued.length ? a.of : b?.issued.length ? b.of : 0;
  return { of, issued };
}

/** The number the next copy gets: one past the highest handed out. @param {EditionLog} log */
export const nextNumber = (log) => log.issued.reduce((m, i) => Math.max(m, i.edition), 0) + 1;
