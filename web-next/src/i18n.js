// @ts-check
// Interface strings, Russian and English. Keys name the meaning, not the
// English text, so either language can change its wording without
// touching code. Both languages have the same keys, and a key's function
// takes the same arguments in both: a test checks it.
//
// So far: the first run, the key in the profile, and the words for every
// error the app can meet (errors.js).

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
  'key.short': (/** @type {string} */ k) => `Ключ ${k}`,
  'words.cell': (/** @type {number} */ n) => `Слово № ${n}`,
  'onb.lead': 'Обмен пиксель-арт-карточками через QR-коды. Без сервера и аккаунтов: всё хранится на этом устройстве.',
  'onb.create': 'Создать ключ',
  'onb.restore': 'У меня уже есть ключ',
  'onb.back': 'Назад',
  'onb.next': 'Дальше',
  'onb.done': 'Готово',
  'onb.words.title': 'Ваши 24 слова',
  'onb.words.lead': 'Это и есть ваш ключ: по нему карточки узнают автора, и по нему всё вернётся, если телефон потеряется.',
  'onb.words.once': 'Pips покажет их только сейчас.',
  'onb.words.why': 'Ключ спрячется в браузере так, что достать его не сможет никто — даже сам Pips. Запишите слова на бумаге и никому не показывайте.',
  'onb.words.written': 'Я записал(а) — проверить',
  'onb.paper': 'Бумажный ключ',
  'onb.paper.code': 'QR-код бумажного ключа',
  'onb.check.title': 'Проверим запись',
  'onb.check.lead': 'Введите три слова из записи — так станет ясно, что она верна, пока слова ещё можно увидеть. Достаточно первых четырёх букв.',
  'onb.check.word': (/** @type {number} */ n) => `Слово № ${n}`,
  'onb.check.swapped': 'Это слово стоит в записи под другим номером: похоже, два слова переставлены. Сверьтесь с записью.',
  'onb.check.other': 'Такого слова под этим номером нет — сверьтесь с записью.',
  'onb.check.again': 'Показать слова ещё раз',
  'onb.kept.title': 'Ключ на месте',
  'onb.kept.lead': 'Запись верна. Теперь слова у вас, а ключ — в этом браузере.',
  'onb.kept.new': 'Новый ключ',
  'onb.kept.hidden': 'Скопировать ключ нельзя — ни вам, ни чужому коду, если он когда-нибудь попадёт в браузер. Подписывать карточки им можно только здесь.',
  'onb.kept.open': 'Этот браузер не умеет прятать ключ, и он хранится открыто, как раньше. Обновите браузер — Pips спрячет ключ сам.',
  'onb.kept.words': 'На новом телефоне ключ вернётся по 24 словам. Показать их Pips больше не сможет: запись — единственная копия.',
  'onb.kept.next': 'Дальше: как вас подписывать',
  'onb.nick.title': 'Как вас подписывать?',
  'onb.nick.lead': 'Ник появится на ваших карточках. Его можно поменять потом — на уже подаренных карточках останется прежний.',
  'onb.restore.title': 'Восстановление',
  'onb.restore.lead': 'Ключ вернёт вашу подпись, копия — коллекцию. Без копии вернётся только ключ.',
  'onb.restore.file': 'Резервная копия',
  'onb.restore.pick': 'Выбрать файл копии',
  'onb.restore.drop': 'Убрать',
  'onb.restore.file.off': 'Если копия есть, выберите её первой: приложение проверит, что ключ к ней подходит.',
  'onb.restore.file.on': 'Откроется вашим ключом — карточки, заметки и профиль вернутся вместе с ним.',
  'onb.restore.key': 'Ключ',
  'onb.restore.words.lead': 'Ваши 24 слова по порядку, как записаны. Достаточно первых четырёх букв каждого.',
  'onb.restore.count': (/** @type {number} */ n) => `Слов: ${n} из 24`,
  'onb.restore.unknown': (/** @type {number} */ n) => `Слова № ${n} нет в списке — проверьте его`,
  'onb.restore.sum': 'Все слова есть в списке, но вместе не сходятся: одно слово неверное или два переставлены местами.',
  'onb.restore.found': 'Ключ найден',
  'onb.restore.fits': 'подходит к копии',
  'onb.restore.mismatch': (/** @type {string} */ k) => `Это ключ ${k}, а копия — от другого. Проверьте слова или выберите другой файл.`,
  'onb.restore.go': 'Восстановить',
  'home.title': 'Профиль',
  'home.key': 'Ключ',
  'home.key.hidden': 'Хранится в этом браузере так, что его нельзя скопировать. Единственная копия — ваши 24 слова: проверить запись можно в любой момент.',
  'home.key.open': 'Этот браузер не умеет прятать ключ, и он хранится открыто, как раньше. Обновите браузер — Pips спрячет ключ сам, при следующем запуске.',
  'home.verify': 'Проверить слова',
  'home.verify.lead': 'Введите слова из записи по порядку — Pips сверит их с ключом и ничего не сохранит. Достаточно первых четырёх букв.',
  'home.verify.ok': (/** @type {string} */ k) => `Запись верна: слова подходят к ключу ${k}.`,
  'home.verify.no': 'Это слова другого ключа: запись не подходит к этому.',
  'home.verify.done': 'Готово',
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
  'key.short': (/** @type {string} */ k) => `Key ${k}`,
  'words.cell': (/** @type {number} */ n) => `Word ${n}`,
  'onb.lead': 'Trade pixel-art cards through QR codes. No server, no accounts: everything stays on this device.',
  'onb.create': 'Create my key',
  'onb.restore': 'I already have a key',
  'onb.back': 'Back',
  'onb.next': 'Next',
  'onb.done': 'Done',
  'onb.words.title': 'Your 24 words',
  'onb.words.lead': 'These words are your key: cards recognise their artist by it, and if this phone is lost, the words bring everything back.',
  'onb.words.once': 'Pips shows them only now.',
  'onb.words.why': 'The key will be hidden in the browser so that no one can take it out — not even Pips. Write the words on paper and show no one.',
  'onb.words.written': 'I have written them down — check',
  'onb.paper': 'Paper key',
  'onb.paper.code': 'The paper key’s QR code',
  'onb.check.title': 'Let’s check what you wrote',
  'onb.check.lead': 'Type three of the words you wrote down — while the words can still be seen, this shows the record is right. The first four letters are enough.',
  'onb.check.word': (/** @type {number} */ n) => `Word ${n}`,
  'onb.check.swapped': 'This word is at another place in the record: two words seem to be swapped. Check against what you wrote.',
  'onb.check.other': 'That is not the word at this place — check against what you wrote.',
  'onb.check.again': 'Show the words again',
  'onb.kept.title': 'Your key is in place',
  'onb.kept.lead': 'The record is right. Now you have the words, and this browser has the key.',
  'onb.kept.new': 'New key',
  'onb.kept.hidden': 'The key cannot be copied — not by you, nor by any code that might ever get into the browser. It signs cards only here.',
  'onb.kept.open': 'This browser cannot hide the key, so it is kept in the open, as before. Update the browser — Pips will hide the key by itself.',
  'onb.kept.words': 'On a new phone the key comes back from the 24 words. Pips cannot show them again: what you wrote is the only copy.',
  'onb.kept.next': 'Next: your name on cards',
  'onb.nick.title': 'What should your cards say?',
  'onb.nick.lead': 'Your name goes on your cards. You can change it later, but cards already given keep the old one.',
  'onb.restore.title': 'Restore',
  'onb.restore.lead': 'The key brings back your signature; a backup, your collection. Without a backup, only the key comes back.',
  'onb.restore.file': 'Backup',
  'onb.restore.pick': 'Choose the backup file',
  'onb.restore.drop': 'Remove',
  'onb.restore.file.off': 'If you have one, choose it first: the app will check that the key fits it.',
  'onb.restore.file.on': 'It opens with your key — cards, notes and profile come back with it.',
  'onb.restore.key': 'Key',
  'onb.restore.words.lead': 'Your 24 words in order, as written down. The first four letters of each are enough.',
  'onb.restore.count': (/** @type {number} */ n) => `${n} of 24 words`,
  'onb.restore.unknown': (/** @type {number} */ n) => `Word ${n} is not in the list — check it`,
  'onb.restore.sum': 'Every word is in the list, but together they do not add up: one is different, or two are swapped.',
  'onb.restore.found': 'Key found',
  'onb.restore.fits': 'fits the backup',
  'onb.restore.mismatch': (/** @type {string} */ k) => `This is key ${k}, and the backup belongs to another. Check the words or choose another file.`,
  'onb.restore.go': 'Restore',
  'home.title': 'Profile',
  'home.key': 'Key',
  'home.key.hidden': 'Kept in this browser so that it cannot be copied. The only copy is your 24 words: you can check what you wrote at any time.',
  'home.key.open': 'This browser cannot hide the key, so it is kept in the open, as before. Update the browser — Pips will hide the key by itself at the next start.',
  'home.verify': 'Check the words',
  'home.verify.lead': 'Type the words you wrote down, in order — Pips checks them against the key and keeps nothing. The first four letters are enough.',
  'home.verify.ok': (/** @type {string} */ k) => `The record is right: the words fit key ${k}.`,
  'home.verify.no': 'These are another key’s words: the record does not fit this one.',
  'home.verify.done': 'Done',
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
