/**
 * Транслитерация кириллицы в латиницу.
 *
 * Зачем: LRCLIB заполняется вручную и один и тот же исполнитель лежит там либо
 * кириллицей, либо транслитом. Яндекс Музыка отдаёт `Король и Шут`, а запись в
 * базе — `Korol i Shut`. Без приведения к общему виду точное совпадение не
 * находится и трек считается «без текста».
 *
 * Схема — упрощённая практическая (как в Last.fm и MusicBrainz), а не строгий
 * ГОСТ: важно совпадение с тем, как люди пишут транслит, а не академичность.
 * Функция чистая и без сети, поэтому покрыта тестами.
 */

/** Кириллица → латиница. Ключи в нижнем регистре: регистр снимает `normalize`. */
const TABLE: Record<string, string> = {
  а: 'a',
  б: 'b',
  в: 'v',
  г: 'g',
  д: 'd',
  е: 'e',
  ё: 'e',
  ж: 'zh',
  з: 'z',
  и: 'i',
  й: 'y',
  к: 'k',
  л: 'l',
  м: 'm',
  н: 'n',
  о: 'o',
  п: 'p',
  р: 'r',
  с: 's',
  т: 't',
  у: 'u',
  ф: 'f',
  х: 'kh',
  ц: 'ts',
  ч: 'ch',
  ш: 'sh',
  щ: 'sch',
  ъ: '',
  ы: 'y',
  ь: '',
  э: 'e',
  ю: 'yu',
  я: 'ya',
  // Украинские и белорусские буквы: сервис работает и там.
  і: 'i',
  ї: 'yi',
  є: 'ye',
  ґ: 'g',
  ў: 'u',
};

/** Латинские двойники, которые люди пишут то так, то так. */
const LATIN_FOLDS: Array<[RegExp, string]> = [
  [/kh/g, 'h'],
  [/ph/g, 'f'],
  [/ts/g, 'c'],
  [/shch/g, 'sch'],
  [/y/g, 'i'],
  [/j/g, 'i'],
];

/**
 * Приводит строку к латинскому сопоставимому виду.
 *
 * Латиница проходит через те же свёртки, что и транслит: иначе `Hozyain`
 * (неформальный транслит) не совпадёт с `Khozyain` (наш вариант).
 */
export function transliterate(input: string): string {
  let result = '';
  for (const char of input.toLowerCase()) {
    const mapped = TABLE[char];
    result += mapped === undefined ? char : mapped;
  }

  // Свёртки убирают различия между вариантами транслита.
  for (const [pattern, replacement] of LATIN_FOLDS) {
    result = result.replace(pattern, replacement);
  }

  return result;
}

/**
 * Совпадают ли строки с точностью до транслитерации.
 *
 * Пробелы и пунктуация не учитываются: в базе пишут и `Korol i Shut`,
 * и `Korol'i Shut`.
 */
export function sameTranslit(a: string, b: string): boolean {
  if (a === '' || b === '') return false;
  return translitKey(a) === translitKey(b);
}

/** Оставляет только буквы и цифры — для сравнения без пунктуации. */
export function squash(input: string): string {
  return input.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
}

/**
 * Ключ сравнения: транслит без пунктуации и пробелов.
 *
 * Пробелы убираются намеренно: `Korol i Shut` и `Korol'i Shut` пишут по-разному,
 * а апостроф `normalizeText` снимает только в начале обработки.
 */
export function translitKey(input: string): string {
  return squash(transliterate(input));
}

/**
 * Слова строки в сравнимом виде.
 *
 * Сравнение по словам, а не по подстроке, — принципиально: подстрока приняла бы
 * `Wires II` за `Wires` и отдала бы текст другой песни.
 */
function words(input: string): string[] {
  return input
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word !== '')
    .map((word) => transliterate(word));
}

/**
 * Одна строка целиком входит в другую на границах слов.
 *
 * `Built By Titan, Skybourne` содержит `Built By Titan` — в базе исполнителей
 * перечисляют через запятую, а сервис отдаёт одного.
 *
 * Это проверка **для исполнителя**, и она намеренно мягкая: `wires ii` тоже
 * содержит `wires`. Для названия её применять нельзя — там нужен `sameTranslit`,
 * иначе `Wires II` получил бы текст `Wires`.
 */
export function containsTranslit(haystack: string, needle: string): boolean {
  const hay = words(haystack);
  const pin = words(needle);
  if (hay.length === 0 || pin.length === 0) return false;
  if (pin.length > hay.length) return false;

  for (let start = 0; start <= hay.length - pin.length; start += 1) {
    if (pin.every((word, offset) => hay[start + offset] === word)) return true;
  }
  return false;
}