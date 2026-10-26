// @ts-check
// Undo as a tree: nothing done is ever lost.
//
// Every change is a node below the one it was made on. Undo walks up, redo
// walks down — along the branch last taken. Changing something after an
// undo starts a new branch beside the old one instead of throwing the old
// one away, and any step on any branch can be gone back to (`goTo`).
//
// The tree does not know what a change is: `apply(entry, dir)` does it
// (+1) or takes it back (-1). Entries must be plain data, so the tree can be
// kept with the draft (`save` / `load`).
//
// Small steps of one kind in a row (typing a title, dragging a colour) can
// be one step: `push` with a `merge` key folds them into the last one while
// it is fresh and nothing was undone in between.

/**
 * @template E
 * @typedef {{
 *   id: number, parent: Node<E>|null, kids: Node<E>[], next: number,
 *   entry: E|null, label: string, frame: number, t: number, merge: string, bytes: number,
 * }} Node
 */

const MERGE_MS = 1500;

/**
 * @template E
 * @param {{
 *   apply: (entry: E, dir: 1|-1) => void,
 *   sizeOf: (entry: E) => number,
 *   join?: (older: E, newer: E) => E,
 *   limit?: number,
 *   now?: () => number,
 * }} o
 * apply: does or undoes an entry; sizeOf: its weight in bytes, for the
 * limit; join: one entry for two merged steps; limit: bytes kept.
 */
export function createHistory(o) {
  const limit = o.limit ?? 16 << 20;
  const now = o.now ?? (() => Date.now());
  let ids = 0, bytes = 0;
  /** @type {Node<E>} */
  let root = node(null, null, '', -1, '');
  let cur = root;

  /** @param {Node<E>|null} parent @param {E|null} entry @param {string} label @param {number} frame @param {string} merge @returns {Node<E>} */
  function node(parent, entry, label, frame, merge) {
    const b = entry == null ? 0 : o.sizeOf(entry);
    return { id: ids++, parent, kids: [], next: -1, entry, label, frame, t: now(), merge, bytes: b };
  }

  /** Keeps within the limit by forgetting the oldest steps of the current line. */
  function prune() {
    while (bytes > limit && root !== cur) {
      // The step below the root on the way to `cur` becomes the new root:
      // it can no longer be undone; branches off the old root go with it.
      let k = cur;
      while (k.parent !== root) k = /** @type {Node<E>} */ (k.parent);
      for (const kid of root.kids) if (kid !== k) bytes -= weigh(kid);
      bytes -= k.bytes;
      k.parent = null;
      k.entry = null;
      k.bytes = 0;
      root = k;
    }
  }
  /** Bytes held by a node and everything under it. @param {Node<E>} n @returns {number} */
  const weigh = (n) => n.kids.reduce((s, k) => s + weigh(k), n.bytes);

  /** Is `a` on the way from the root to `b`? @param {Node<E>} a @param {Node<E>} b */
  const above = (a, b) => {
    for (let n = /** @type {Node<E>|null} */ (b); n; n = n.parent) if (n === a) return true;
    return false;
  };

  const api = {
    /**
     * Records a change already made. @param {E} entry
     * @param {{label: string, frame?: number, merge?: string}} meta
     * merge: steps with the same key in a row may become one.
     */
    push(entry, meta) {
      const fresh = cur.parent && meta.merge && cur.merge === meta.merge && !cur.kids.length && now() - cur.t < MERGE_MS;
      if (fresh && o.join && cur.entry != null) {
        bytes -= cur.bytes;
        cur.entry = o.join(cur.entry, entry);
        cur.bytes = o.sizeOf(cur.entry);
        bytes += cur.bytes;
        cur.t = now();
        return cur;
      }
      const n = node(cur, entry, meta.label, meta.frame ?? -1, meta.merge ?? '');
      cur.kids.push(n);
      cur.next = cur.kids.length - 1;
      cur = n;
      bytes += n.bytes;
      prune();
      return n;
    },
    /** Takes back the last step; returns it, or null at the start. */
    undo() {
      if (!cur.parent || cur.entry == null) return null;
      const n = cur;
      o.apply(/** @type {E} */ (n.entry), -1);
      cur = /** @type {Node<E>} */ (n.parent);
      cur.next = cur.kids.indexOf(n);
      return n;
    },
    /** Does again the step last undone here; returns it, or null. */
    redo() {
      const n = cur.kids[cur.next];
      if (!n) return null;
      o.apply(/** @type {E} */ (n.entry), 1);
      cur = n;
      return n;
    },
    /** Goes to any step of the tree, undoing and redoing on the way. @param {Node<E>} target */
    goTo(target) {
      while (!above(cur, target)) api.undo();
      /** @type {Node<E>[]} */
      const down = [];
      for (let n = target; n !== cur; n = /** @type {Node<E>} */ (n.parent)) down.unshift(n);
      for (const n of down) {
        const p = /** @type {Node<E>} */ (n.parent);
        p.next = p.kids.indexOf(n);
        api.redo();
      }
    },
    get current() { return cur; },
    get root() { return root; },
    get canUndo() { return !!cur.parent && cur.entry != null; },
    get canRedo() { return !!cur.kids[cur.next]; },
    /** The step undo would take back. */
    get undoStep() { return api.canUndo ? cur : null; },
    /** The step redo would do. */
    get redoStep() { return cur.kids[cur.next] ?? null; },
    /** The line through the current step: from the oldest kept, down the
     * branches last taken, to the newest. */
    line() {
      /** @type {Node<E>[]} */
      const out = [];
      for (let n = /** @type {Node<E>|null} */ (cur); n; n = n.parent) out.unshift(n);
      for (let n = cur.kids[cur.next]; n; n = n.kids[n.next]) out.push(n);
      return out;
    },
    /** Bytes the steps take. */
    get bytes() { return bytes; },

    /** The whole tree as plain data, with where the current step is. */
    save() {
      /** @param {Node<E>} n @returns {any} */
      const dump = (n) => ({ e: n.entry, l: n.label, f: n.frame, t: n.t, x: n.next, k: n.kids.map(dump) });
      /** @type {number[]} */
      const at = [];
      for (let n = cur; n.parent; n = n.parent) at.unshift(n.parent.kids.indexOf(n));
      return { tree: dump(root), at };
    },
    /** Forgets every step: what is now is the start. */
    clear() {
      bytes = 0;
      root = node(null, null, '', -1, '');
      cur = root;
    },
    /** Takes back a tree from `save`, without applying anything: the
     * document must already be as it was at the current step. @param {any} data */
    load(data) {
      bytes = 0;
      /** @param {any} d @param {Node<E>|null} parent @returns {Node<E>} */
      const make = (d, parent) => {
        const n = node(parent, d.e, d.l, d.f, '');
        n.t = d.t;
        n.next = d.x;
        bytes += n.bytes;
        n.kids = d.k.map((/** @type {any} */ k) => make(k, n));
        return n;
      };
      root = make(data.tree, null);
      cur = root;
      for (const i of data.at) cur = cur.kids[i];
    },
  };
  return api;
}
