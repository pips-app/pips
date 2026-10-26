// @ts-check
// The recovery words as a person types them: one at a time, in any case,
// and cut short if they like — no two words of the list share their first
// four letters (a word shorter than that is typed whole).

/** @param {readonly string[]} list the core's word list */
export function wordBook(list) {
  const known = new Set(list);
  return {
    /** The word an entry names, or null. @param {string} typed */
    resolve(typed) {
      const w = typed.trim().toLowerCase();
      if (known.has(w)) return w;
      if (w.length < 4) return null;
      const hits = list.filter((x) => x.startsWith(w));
      return hits.length === 1 ? hits[0] : null;
    },
    /** Whether typing on can still give a word: false is a typo already. @param {string} typed */
    possible(typed) {
      const w = typed.trim().toLowerCase();
      return list.some((x) => x.startsWith(w));
    },
  };
}

/** Pasted or typed text, as words. @param {string} text */
export const splitWords = (text) => text.toLowerCase().split(/\s+/).filter(Boolean);
