import type { Milliseconds, TimedWord } from '../types';

/**
 * Разбор отдельных элементов LRC: меток времени, служебных тегов, k-word разметки.
 * Выделено отдельно, потому что это самая «мелкая» и самая ошибочная часть.
 */

/** Метка времени строки: `[mm:ss]`, `[mm:ss.xx]`, `[mm:ss.xxx]`. */
export const LINE_TAG = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;

/** Метка времени слова внутри строки: `<mm:ss.xx>`. */
export const WORD_TAG = /<(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?>/g;

/** Служебный тег метаданных: `[ar:...]`, `[ti:...]`. */
export const META_TAG = /^\[([a-zA-Z]+):(.*)\]$/;

/** Тег смещения. */
export const OFFSET_TAG = /^\[offset:\s*([+-]?\d+)\s*\]$/i;

/**
 * Дробная часть метки → миллисекунды.
 * `[00:12.3]` по спецификации — 300 мс, `.34` — 340, `.345` — 345.
 * Трактовка «.3» как 3 мс — частая ошибка.
 */
export function fractionToMs(fraction: string | undefined): Milliseconds {
  if (!fraction) return 0;
  if (fraction.length === 1) return Number(fraction) * 100;
  if (fraction.length === 2) return Number(fraction) * 10;
  return Number(fraction.slice(0, 3));
}

/** Компоненты метки → миллисекунды. */
export function toMs(
  minutes: string,
  seconds: string,
  fraction: string | undefined,
): Milliseconds {
  return Number(minutes) * 60_000 + Number(seconds) * 1000 + fractionToMs(fraction);
}

/**
 * Разбирает k-word разметку строки. Пробелы сохраняются в тексте слов, чтобы
 * склейка слов обратно давала исходную строку.
 *
 * @returns `null`, если в строке нет ни одной метки слова
 */
export function parseWords(line: string): TimedWord[] | null {
  WORD_TAG.lastIndex = 0;
  if (!WORD_TAG.test(line)) {
    WORD_TAG.lastIndex = 0;
    return null;
  }
  WORD_TAG.lastIndex = 0;

  const words: TimedWord[] = [];
  let lastIndex = 0;
  let pendingText = '';
  let pendingStart: Milliseconds | null = null;

  let match: RegExpExecArray | null;
  while ((match = WORD_TAG.exec(line)) !== null) {
    const before = line.slice(lastIndex, match.index);
    if (pendingStart !== null) {
      pendingText += before;
      words.push({ text: pendingText, startMs: pendingStart });
    }
    pendingText = '';
    pendingStart = toMs(match[1] ?? '0', match[2] ?? '0', match[3]);
    lastIndex = match.index + match[0].length;
  }

  pendingText += line.slice(lastIndex);
  if (pendingStart !== null) {
    const lastWord = words[words.length - 1];
    if (lastWord) lastWord.endMs = pendingStart;
    words.push({ text: pendingText, startMs: pendingStart });
  }

  return words;
}

/** Убирает k-word разметку, оставляя чистый текст. */
export function stripWordTags(line: string): string {
  WORD_TAG.lastIndex = 0;
  return line.replace(WORD_TAG, '');
}

/** Собирает все метки времени из начала строки. */
export function collectLeadingTimestamps(line: string): {
  timestamps: Milliseconds[];
  rest: string;
} {
  const timestamps: Milliseconds[] = [];
  let cursor = 0;

  LINE_TAG.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = LINE_TAG.exec(line)) !== null) {
    // Метка должна начинаться ровно там, где закончилась предыдущая.
    if (match.index !== cursor) break;
    timestamps.push(toMs(match[1] ?? '0', match[2] ?? '0', match[3]));
    cursor = LINE_TAG.lastIndex;
  }
  LINE_TAG.lastIndex = 0;

  return { timestamps, rest: line.slice(cursor) };
}

/** Есть ли в строке хотя бы одна метка времени строки. */
export function hasLineTag(line: string): boolean {
  LINE_TAG.lastIndex = 0;
  const result = LINE_TAG.test(line);
  LINE_TAG.lastIndex = 0;
  return result;
}

/** Ищет в тексте `[offset:N]`; при нескольких тегах действует последний. */
export function findOffsetMs(raw: string): Milliseconds {
  let offsetMs = 0;
  for (const line of raw.split('\n')) {
    const match = OFFSET_TAG.exec(line.trim());
    if (match) offsetMs = Number(match[1]);
  }
  return offsetMs;
}
