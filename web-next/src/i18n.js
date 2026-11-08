// @ts-check
// Interface strings, Russian and English. Keys name the meaning, not the
// English text, so either language can change its wording without
// touching code. Both languages have the same keys, and a key's function
// takes the same arguments in both: a test checks it.
//
// So far: the shell, and the words for every error the app can meet
// (errors.js).

/** @param {number} n @param {string} one @param {string} few @param {string} many */
function plural(n, one, few, many) {
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b === 1) return one;
  if (b >= 2 && b <= 4) return few;
  return many;
}

/** @param {number} n @param {string} one @param {string} other */
const pluralEn = (n, one, other) => (n === 1 ? one : other);

const ru = {
  'shell.wip': 'Новая версия Pips. Пока в ней только каркас.',
  'shell.starting': 'Запускается…',
  'shell.ready': 'Ядро на месте и отвечает.',
  // Errors of the core (crates/pips-wasm/src/codes.rs) and of its client.
  'error.invalid_card': 'Карточка повреждена или записана с ошибками',
  'error.newer_version': 'Это сделала более новая версия Pips — обновите приложение',
  'error.bad_title': 'Такое название карточка не возьмёт: до 32 символов, без невидимых знаков',
  'error.bad_author': 'Такой ник карточка не возьмёт: до 24 символов, без невидимых знаков',
  'error.bad_handle': 'Имя в соцсети — одним словом, без пробелов',
  'error.bad_site': 'Такую ссылку карточка не возьмёт: адрес латиницей вроде kitsu.art/shop — без порта и пароля',
  'error.unsigned': 'У карточки нет подписи автора',
  'error.bad_signature': 'Подпись не сходится: карточку изменили после того, как автор её подписал',
  'error.bad_key': 'Это не ключ Pips',
  'error.not_author': 'Это может сделать только автор карточки',
  'error.bad_edition': 'Номер экземпляра не подходит к этой карточке',
  'error.bad_nick': 'Такой ник в номер не впишется: до 24 символов, без невидимых знаков',
  'error.invalid_code': 'Код повреждён или это не код Pips',
  'error.bad_link': 'Ссылку не получилось ни прочитать, ни сделать',
  'error.bad_frame': 'Кадр не прочитался — продолжайте сканировать',
  'error.bad_words': 'Эти слова не складываются в ключ: проверьте каждое',
  'error.bad_paper_key': 'Бумажный ключ не читается: проверьте, всё ли переписано',
  'error.not_a_backup': 'Это не резервная копия Pips',
  'error.other_owner': (/** @type {string} */ key) => `Это копия другого ключа (${key}): она откроется, если сменить ключ на тот`,
  'error.damaged': 'Копия повреждена: файл изменился после сохранения',
  'error.invalid_backup': 'Копия не прошла проверку',
  'error.too_large': 'Файл слишком большой',
  'error.bad_palette': 'Палитра не читается',
  'error.unknown_format': 'Это не PNG и не Aseprite',
  'error.malformed': 'Файл повреждён или записан с ошибками',
  'error.unsupported': 'В файле есть то, чего карточка не покажет (режимы наложения, тайлмапы или полупрозрачные группы). Сведите слои в Aseprite и попробуйте снова',
  'error.partial_alpha': 'В картинке есть полупрозрачные пиксели, а у карточки пиксель или виден, или нет',
  'error.too_big': (/** @type {number} */ w, /** @type {number} */ h) => `${w}×${h} — больше карточки (до 128×128)`,
  'error.too_many_colors': (/** @type {number} */ n) => `${n > 256 ? 'Больше 256' : n} ${plural(n, 'цвет', 'цвета', 'цветов')}, а в карточке до 32`,
  'error.too_many_frames': 'Больше 64 кадров',
  'error.unequal_delays': 'У кадров разная длительность, а у карточки она одна. Выровняйте её в Aseprite или возьмите только первый кадр',
  'error.delay_out_of_range': (/** @type {number} */ ms) => `Кадр длится ${ms} мс, а можно от 20 до 5000`,
  'error.core_timeout': 'Это заняло слишком долго, и работа остановлена. Попробуйте ещё раз',
  'error.core_crashed': 'Работа с этим файлом сломалась и остановлена; это записано в журнал. Попробуйте ещё раз',
  'error.core_unavailable': 'Часть приложения не загрузилась. Перезагрузите страницу',
  'error.key_lost': 'Новый ключ потерялся, не успев сохраниться: начните заново',
  'error.newer_data': 'Данные на этом устройстве сохранила более новая версия Pips — обновите страницу',
  'error.upgrade_failed': 'Не получилось обновить сохранённые данные; ничего не изменилось. Перезагрузите страницу',
  'error.store_unavailable': 'Хранилище браузера не открылось. Перезагрузите страницу; если не поможет — освободите место на устройстве',
  'error.store_replaced': 'Pips открыт в другой вкладке, более новой версии, — продолжайте там',
  'error.app': 'Что-то пошло не так — это записано в журнал',
};

/** @type {typeof ru} */
const en = {
  'shell.wip': 'The new version of Pips. So far it is only a frame.',
  'shell.starting': 'Starting…',
  'shell.ready': 'The core is here and answers.',
  'error.invalid_card': 'The card is damaged or written wrong',
  'error.newer_version': 'A newer version of Pips made this — update the app',
  'error.bad_title': 'A card cannot carry this title: up to 32 characters, nothing invisible',
  'error.bad_author': 'A card cannot carry this name: up to 24 characters, nothing invisible',
  'error.bad_handle': 'A social name is one word, with no spaces',
  'error.bad_site': 'A card cannot carry this link: an address in Latin letters, like kitsu.art/shop — no port or password',
  'error.unsigned': 'The card has no author’s signature',
  'error.bad_signature': 'The signature does not match: the card was changed after its author signed it',
  'error.bad_key': 'This is not a Pips key',
  'error.not_author': 'Only the card’s author can do this',
  'error.bad_edition': 'This copy’s number does not belong to this card',
  'error.bad_nick': 'This name will not fit on a numbered copy: up to 24 characters, nothing invisible',
  'error.invalid_code': 'The code is damaged or not a Pips code',
  'error.bad_link': 'The link could not be read or made',
  'error.bad_frame': 'A frame did not read — keep scanning',
  'error.bad_words': 'These words do not make a key: check each one',
  'error.bad_paper_key': 'The paper key does not read: check that all of it is copied',
  'error.not_a_backup': 'Not a Pips backup',
  'error.other_owner': (/** @type {string} */ key) => `This is the backup of another key (${key}): it opens once you switch to that key`,
  'error.damaged': 'The backup is damaged: the file changed after it was saved',
  'error.invalid_backup': 'The backup did not pass its checks',
  'error.too_large': 'The file is too large',
  'error.bad_palette': 'The palette does not read',
  'error.unknown_format': 'Not a PNG or Aseprite file',
  'error.malformed': 'The file is damaged or badly written',
  'error.unsupported': 'The file uses something a card cannot show (blend modes, tilemaps or translucent groups). Flatten the layers in Aseprite and try again',
  'error.partial_alpha': 'The picture has semi-transparent pixels; a card pixel is either there or not',
  'error.too_big': (/** @type {number} */ w, /** @type {number} */ h) => `${w}×${h} is larger than a card (up to 128×128)`,
  'error.too_many_colors': (/** @type {number} */ n) => `${n > 256 ? 'More than 256' : n} ${pluralEn(n, 'colour', 'colours')}, but a card holds 32`,
  'error.too_many_frames': 'More than 64 frames',
  'error.unequal_delays': 'The frames last different times, but a card has one frame time. Even them out in Aseprite or take only the first frame',
  'error.delay_out_of_range': (/** @type {number} */ ms) => `A frame lasts ${ms} ms; 20 to 5000 are allowed`,
  'error.core_timeout': 'This took too long and was stopped. Try again',
  'error.core_crashed': 'Working on this file broke and was stopped; it is in the journal. Try again',
  'error.core_unavailable': 'Part of the app did not load. Reload the page',
  'error.key_lost': 'The new key was lost before it was saved: start again',
  'error.newer_data': 'A newer version of Pips saved the data on this device — reload the page',
  'error.upgrade_failed': 'The saved data could not be upgraded; nothing has changed. Reload the page',
  'error.store_unavailable': 'The browser’s storage would not open. Reload the page; if that does not help, free some space on the device',
  'error.store_replaced': 'Pips is open in another tab, a newer version — carry on there',
  'error.app': 'Something went wrong — it is in the journal',
};

/** Both languages, for the test that checks they match. */
export const dictionaries = { ru, en };

/** @typedef {keyof typeof ru} Key */

/** @type {'ru' | 'en'} */
let lang = 'ru';

/** @param {'ru' | 'en'} l */
export function setLanguage(l) {
  lang = l;
}

/**
 * The words for `key` in the current language.
 * @param {Key} key @param {...any} args
 * @returns {string}
 */
export function t(key, ...args) {
  /** @type {string | ((...a: any[]) => string)} */
  const v = dictionaries[lang][key];
  return typeof v === 'function' ? v(...args) : v;
}
