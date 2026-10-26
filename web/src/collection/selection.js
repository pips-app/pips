// @ts-check
// Choosing several cards: a hold or "Select" starts it, taps toggle, the
// last card let go ends it.

/**
 * @param {{el: HTMLElement, cardEl: (id: string) => HTMLElement | undefined, changed: () => void}} o
 * el: gets the "selecting" class; cardEl: a card's element, for its mark;
 * changed: called after every change, to repaint the bars.
 */
export function createSelection(o) {
  /** @type {Set<string>} */
  const ids = new Set();
  let active = false;
  const sel = {
    get active() { return active; },
    get size() { return ids.size; },
    /** @param {string} id */
    has: (id) => ids.has(id),
    start() {
      if (active) return;
      active = true;
      o.el.classList.add('selecting');
      o.changed();
    },
    stop() {
      if (!active) return;
      active = false;
      for (const id of ids) o.cardEl(id)?.classList.remove('chosen');
      ids.clear();
      o.el.classList.remove('selecting');
      o.changed();
    },
    /** @param {string} id */
    toggle(id) {
      if (ids.has(id)) ids.delete(id); else ids.add(id);
      o.cardEl(id)?.classList.toggle('chosen', ids.has(id));
      if (!ids.size) sel.stop();
      else o.changed();
    },
    /** A card that left (flew away, was deleted) is no longer chosen. @param {string} id */
    forget(id) {
      ids.delete(id);
      o.cardEl(id)?.classList.remove('chosen');
    },
  };
  return sel;
}
