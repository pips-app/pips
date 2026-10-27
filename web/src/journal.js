// @ts-check
// What went wrong, kept on the device so the person can pass it on: errors
// nobody caught, failures the app caught but could not explain, and its own
// warnings. On a phone there are no developer tools; this is what stands in
// for them.
//
// Nothing personal is written down on purpose: no key, words, cards or
// notes — only error messages, where in the app they happened, and the
// first lines of the stack (file and line, without the site's address).
// A message may still repeat something typed (a link that was refused):
// the report says so before it is sent.
//
// The same error again (a loop that throws on every frame) is one entry
// with a count, so a flood cannot push out what came before it.

export const MAX_ENTRIES = 100;
const MAX_TEXT = 400;
const STACK_LINES = 6;

/** @typedef {'error'|'warn'} Kind */
/** @typedef {{at: number, kind: Kind, where: string, text: string, stack: string, count: number}} Entry */

/**
 * An error, a rejection's reason or anything thrown, as text and stack.
 * @param {unknown} e @param {string} origin the site's address, to leave out
 */
export function describe(e, origin = '') {
  const any = /** @type {any} */ (e);
  const code = typeof any?.code === 'string' ? `${any.code}: ` : '';
  const text = `${code}${any?.message ?? String(e)}`.slice(0, MAX_TEXT);
  const stack = typeof any?.stack === 'string'
    ? /** @type {string} */ (any.stack).split('\n').map((l) => l.trim()).filter((l) => /:\d+:\d+/.test(l)) // file:line:column, in any browser's form
      .slice(0, STACK_LINES).map((l) => (origin ? l.split(origin).join('') : l)).join('\n')
    : '';
  return { text, stack };
}

/**
 * @param {{now?: () => number, where?: () => string, origin?: string,
 *   save?: (entries: Entry[]) => void}} [o] save: called after each change
 */
export function createJournal(o = {}) {
  const now = o.now ?? Date.now;
  /** @type {Entry[]} newest last */
  let entries = [];
  /** @type {Set<() => void>} */
  const listeners = new Set();
  const changed = () => {
    o.save?.(entries);
    for (const fn of listeners) fn();
  };

  /** @param {Kind} kind @param {unknown} e @param {string} [where] */
  function record(kind, e, where = o.where?.() ?? '') {
    const { text, stack } = describe(e, o.origin);
    const last = entries[entries.length - 1];
    if (last && last.kind === kind && last.text === text && last.stack === stack && last.where === where) {
      entries = [...entries.slice(0, -1), { ...last, at: now(), count: last.count + 1 }];
    } else {
      entries = [...entries, { at: now(), kind, where, text, stack, count: 1 }].slice(-MAX_ENTRIES);
    }
    changed();
  }

  return {
    /** Something failed: thrown and not caught, or caught and not explained. */
    /** @param {unknown} e @param {string} [where] */
    error: (e, where) => record('error', e, where),
    /** Something odd the app went on from. @param {unknown} e @param {string} [where] */
    warn: (e, where) => record('warn', e, where),
    get entries() { return entries; },
    /** Entries kept from before (a previous start), ahead of this start's. @param {Entry[]} old */
    restore(old) {
      if (!Array.isArray(old)) return;
      entries = [...old.filter((x) => x && typeof x.text === 'string'), ...entries].slice(-MAX_ENTRIES);
      for (const fn of listeners) fn();
    },
    clear() { entries = []; changed(); },
    /** @param {() => void} fn */
    listen(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  };
}

/**
 * The text to send: what the app and the device are, then the entries,
 * newest first. `facts` are lines like "version: …", in order.
 * @param {Entry[]} entries @param {[string, string][]} facts
 */
export function report(entries, facts) {
  const time = (/** @type {number} */ ms) => new Date(ms).toISOString().replace('T', ' ').slice(0, 19);
  const head = ['Pips — error report', ...facts.map(([k, v]) => `${k}: ${v}`)];
  const body = [...entries].reverse().map((e) => [
    `${time(e.at)} ${e.kind}${e.count > 1 ? ` ×${e.count}` : ''}${e.where ? ` [${e.where}]` : ''} ${e.text}`,
    ...(e.stack ? e.stack.split('\n').map((l) => `    ${l}`) : []),
  ].join('\n'));
  return [...head, '', entries.length ? `${entries.length} entr${entries.length === 1 ? 'y' : 'ies'}, newest first:` : 'No entries.', ...body].join('\n');
}
