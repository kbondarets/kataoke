/**
 * Общие типы ядра.
 *
 * Единицы времени выбраны осознанно и не смешиваются:
 * - парсер LRC работает в миллисекундах (`offsetMs`, `startMs`, `endMs`);
 * - адаптеры и UI — в секундах (`timeSec`).
 * В имени переменной или поля единица обязана присутствовать.
 */

/** Секунды. Используется на границе с адаптером и UI. */
export type Seconds = number;

/** Миллисекунды. Используется внутри парсера и таймлайна. */
export type Milliseconds = number;

/** Тип синхронизации текста. */
export type LyricsKind = 'plain' | 'line' | 'word';

/** Одно слово с собственным временем (k-word). */
export interface TimedWord {
  text: string;
  startMs: Milliseconds;
  /** Неизвестно, если в LRC не было метки у следующего слова. */
  endMs?: Milliseconds;
}

/** Строка текста с временем появления. */
export interface TimedLine {
  /** Исходный текст строки (для отображения). */
  text: string;
  startMs: Milliseconds;
  /** Может быть вычислено как начало следующей строки. */
  endMs?: Milliseconds;
  /** Слова с таймингами — только для `kind: 'word'`. */
  words?: TimedWord[];
}

/** Разобранный текст песни, готовый к передаче в sync engine. */
export interface LyricsTimeline {
  kind: LyricsKind;
  lines: TimedLine[];
}

/** Информация о треке, которую отдаёт адаптер. */
export interface TrackInfo {
  title: string;
  artist: string;
  album?: string;
  durationSec: Seconds;
  /** Идентификатор трека на стороне сервиса, если есть. */
  sourceId?: string;
}

/** Результат обращения к провайдеру текстов. */
export interface LyricsResult {
  providerId: string;
  timeline: LyricsTimeline;
}
