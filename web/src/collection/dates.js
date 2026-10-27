// @ts-check
// Names of weeks and months, for the group labels of the grid.

import { date, language } from '../i18n.js';
import { weekStart } from './layout.js';

/** "12–18 окт." or "28 сент. – 4 окт.". A day and its month never part:
 * a label too long for its cell breaks at the dash, not after "4".
 * @param {number} ms */
export function weekLabel(ms) {
  const a = new Date(weekStart(ms)), b = new Date(a);
  b.setDate(b.getDate() + 6);
  const day = (/** @type {Date} */ d) => date(d.getTime(), { day: 'numeric', month: 'short' }).replace(/\s/g, '\u00a0');
  return a.getMonth() === b.getMonth() ? `${a.getDate()}–${day(b)}` : `${day(a)} – ${day(b)}`;
}

/** "Октябрь", with the year when it is not this one. @param {number} ms */
export function monthLabel(ms) {
  const d = new Date(ms);
  const opts = /** @type {Intl.DateTimeFormatOptions} */ ({ month: 'long', ...(d.getFullYear() !== new Date().getFullYear() ? { year: 'numeric' } : {}) });
  const s = d.toLocaleDateString(language() === 'ru' ? 'ru-RU' : 'en-GB', opts);
  return s.charAt(0).toUpperCase() + s.slice(1);
}
