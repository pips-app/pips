// @ts-check
// Card links: the app's own address with a card in the part after '#',
// which the browser never sends to the server. A link opens the app and
// the card arrives as if scanned. No DOM; the address is passed in.

/** Where links point when the app runs somewhere a link cannot (plain http, a file). */
export const PUBLISHED = 'https://pips-app.github.io/pips/';

/**
 * The address links should open: this copy of the app when it is served
 * over https, otherwise the published one.
 * @param {{protocol: string, origin: string, pathname: string}} where
 */
export function linkBase(where) {
  if (where.protocol !== 'https:') return PUBLISHED;
  return where.origin + where.pathname.replace(/index\.html$/, '');
}

/**
 * The card in an address, if there is one, and the address without it
 * (to put back, so a reload does not bring the card in again).
 * @param {string} href
 * @returns {{link: string, rest: string} | null}
 */
export function cardInAddress(href) {
  const at = href.indexOf('#');
  if (at < 0 || at === href.length - 1) return null;
  return { link: href, rest: href.slice(0, at) };
}
