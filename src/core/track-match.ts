import type { Seconds, TrackInfo } from './types';

/**
 * Нормализация метаданных трека для поиска текста.
 *
 * Главная причина «текст есть, но не нашёлся» — не отсутствие текста, а
 * несовпадение названия: `(Remastered 2011)`, `feat. X`, `- Radio Edit`.
 * Здесь — чистые функции без сети, поэтому их легко покрыть тестами.
 */

/** Суффиксы и вставки, которые мешают точному совпадению. */
const NOISE_PATTERNS: RegExp[] = [
  /\s*[([][^)\]]*\b(feat|ft|featuring|при уч\.?|с участием)\b[^)\]]*[)\]]/giu,
  /\s*[([][^)\]]*\b(remaster(ed)?|remastered\s+\d{4}|digital\s+remaster)\b[^)\]]*[)\]]/giu,
  /\s*[([][^)\]]*\b(radio|single|album|extended|club|edit|version|mix|live|acoustic|instrumental)\b[^)\]]*[)\]]/giu,
  /\s*-\s*(remaster(ed)?(\s+\d{4})?|radio\s+edit|single\s+version|album\s+version|live|acoustic|instrumental)\s*$/giu,
  /\s*[([][^)\]]*\b(deluxe|bonus|special|anniversary|edition)\b[^)\]]*[)\]]/giu,
  /\s*\b(feat|ft|featuring)\b.*$/giu,
];

/** Приводит строку к сравнимому виду: нижний регистр, ё→е, без лишних пробелов. */
export function normalizeText(input: string): string {
  return input
    .normalize('NFKC')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[«»"'`’]/g, '')
    .replace(/\s*&\s*/g, ' и ')
    .replace(/[.,;:!?]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Убирает служебные пометки из названия трека. */
export function stripNoise(input: string): string {
  let result = input;
  for (const pattern of NOISE_PATTERNS) {
    result = result.replace(pattern, ' ');
  }
  return result.replace(/\s{2,}/g, ' ').trim();
}

/** Нормализованное название для поиска. */
export function normalizeTitle(title: string): string {
  return normalizeText(stripNoise(title));
}

/** Нормализованный исполнитель (первый из перечисленных). */
export function normalizeArtist(artist: string): string {
  const first = artist.split(/\s*(?:,|;|&|\bfeat\b|\bft\b|\bfeaturing\b)\s*/i)[0] ?? artist;
  return normalizeText(stripNoise(first));
}

/** Разница длительности, после которой трек считается другим. */
export const DURATION_TOLERANCE_SEC = 7;

/** Сходятся ли длительности в пределах допуска. */
export function durationMatches(
  a: Seconds | undefined,
  b: Seconds | undefined,
  toleranceSec: Seconds = DURATION_TOLERANCE_SEC,
): boolean {
  if (a === undefined || b === undefined) return true;
  return Math.abs(a - b) <= toleranceSec;
}

/**
 * Ключ кеша: одинаковый для одного и того же трека в любом сервисе.
 *
 * Длительность округляется до 5 секунд: у разных сервисов и ремастеров она
 * расходится на секунды, а без этого один трек кешировался бы многократно.
 * Неизвестная длительность (`0`) в ключ не попадает — иначе запись, сделанная
 * до загрузки метаданных, не нашлась бы после.
 */
export function buildTrackKey(track: TrackInfo): string {
  const artist = normalizeArtist(track.artist);
  const title = normalizeTitle(track.title);
  if (track.durationSec <= 0) return `${artist}|${title}`;

  const bucket = Math.round(track.durationSec / 5) * 5;
  return `${artist}|${title}|${bucket}`;
}
