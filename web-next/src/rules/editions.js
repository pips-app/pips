// @ts-check
// Numbered copies: the author's log of which number went to whom. Only the
// author's device can keep it, so two logs of one card may differ — a
// backup restored over newer issues. They are joined, never chosen
// between: a number in either log was handed out, and must not be handed
// out again. From web/src/editions.js, with the choice of the next number
// made here too.

/** @typedef {{ edition: number, nick: string, holder: string, day: number }} Issue */
/** @typedef {{ of: number, issued: Issue[] }} EditionLog */

/**
 * What makes one copy: its number and its holder. The same number to two
 * holders is two copies (the author's mistake, which a log must show).
 * @param {Issue} i
 */
export const copyOf = (i) => `${i.edition}:${i.holder}`;

/** A log with nothing issued yet. @type {EditionLog} */
export const EMPTY_LOG = Object.freeze({ of: 0, issued: [] });

/**
 * Both logs' copies, each once, by number. The run is the one already
 * fixed: a log with copies fixed it with its first, and this device's
 * wins over another's.
 * @param {EditionLog | undefined} a this device's @param {EditionLog | undefined} b another's
 * @returns {EditionLog}
 */
export function joinLogs(a, b) {
  const seen = new Map();
  for (const i of [...(a?.issued ?? []), ...(b?.issued ?? [])]) seen.set(copyOf(i), i);
  const issued = [...seen.values()].sort((x, y) => x.edition - y.edition || x.day - y.day || (x.holder < y.holder ? -1 : x.holder > y.holder ? 1 : 0));
  const of = a?.issued.length ? a.of : b?.issued.length ? b.of : 0;
  return { of, issued };
}

/** The number the next copy gets: one past the highest handed out. @param {EditionLog} log */
export const nextNumber = (log) => log.issued.reduce((m, i) => Math.max(m, i.edition), 0) + 1;

/**
 * The next copy to issue: its number and its run. The run is fixed by the
 * first copy (`of` counts only then; 0 is an open run); past its end there
 * is none, and the answer says so.
 * @param {EditionLog} log @param {number} of the run asked for, if none is fixed yet
 * @returns {{ edition: number, of: number } | { code: 'run_out' }}
 */
export function nextIssue(log, of) {
  const run = log.issued.length ? log.of : of;
  const edition = nextNumber(log);
  return run && edition > run ? { code: 'run_out' } : { edition, of: run };
}

/**
 * The log once a copy is issued.
 * @param {EditionLog} log @param {{ edition: number, of: number }} next from nextIssue
 * @param {{ nick: string, holder: string, day: number }} to
 * @returns {EditionLog}
 */
export const issued = (log, next, to) => ({ of: next.of, issued: [...log.issued, { edition: next.edition, ...to }] });
