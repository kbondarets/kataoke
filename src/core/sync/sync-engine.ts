import type { LyricsTimeline, Milliseconds, Seconds, TimedLine, TimedWord } from '../types';

/**
 * Sync engine — превращает «где мы во времени» в «какая строка/слово активны».
 *
 * Движок намеренно чистый: он не знает ни про DOM, ни про `<video>`, ни про
 * сервис. На вход — сэмпл позиции, на выход — индексы. Это позволяет проверять
 * синхронизацию тестами без браузера.
 */

/** Снимок позиции воспроизведения. */
export interface PositionSample {
  /** Время медиа в момент снимка, секунды. */
  mediaTimeSec: Seconds;
  /** Момент снимка по монотонным часам (`performance.now()`), миллисекунды. */
  wallMs: Milliseconds;
  /** Скорость воспроизведения (1 — обычная). */
  rate: number;
  /** Играет ли сейчас. На паузе позиция не «бежит». */
  playing: boolean;
}

/**
 * Порог расхождения интерполяции и свежего `currentTime`.
 * Если интерполяция ушла дальше — это признак перемотки или буферизации,
 * и плавно «догонять» не нужно: сэмпл надо сбросить.
 */
export const DRIFT_RESET_MS = 250;

/** Смещение подсветки вперёд: человек читает заранее. */
export const DEFAULT_LEAD_MS = 100;

/** Активное состояние таймлайна. */
export interface ActiveState {
  lineIndex: number;
  wordIndex: number;
  /** Прогресс активного слова от 0 до 1, если тайминг слова известен. */
  wordProgress: number;
}

/** Результат поиска «ничего не активно» (до первой строки или пустой таймлайн). */
export const NOTHING_ACTIVE: ActiveState = { lineIndex: -1, wordIndex: -1, wordProgress: 0 };

/**
 * Позиция на момент `nowMs` с учётом прошедшего времени.
 * На паузе возвращается зафиксированное время.
 */
export function positionAt(sample: PositionSample | null, nowMs: Milliseconds): Seconds {
  if (!sample) return 0;
  if (!sample.playing) return sample.mediaTimeSec;
  const elapsedSec = (nowMs - sample.wallMs) / 1000;
  return sample.mediaTimeSec + elapsedSec * sample.rate;
}

/**
 * Следует ли заменить сэмпл на свежий, или текущий ещё годится.
 * Свежий `currentTime` — истина; интерполяция — только сглаживание.
 */
export function shouldResync(
  sample: PositionSample | null,
  freshTimeSec: Seconds,
  nowMs: Milliseconds,
): boolean {
  if (!sample) return true;
  const predicted = positionAt(sample, nowMs);
  const driftMs = Math.abs(predicted - freshTimeSec) * 1000;
  // При перемотке назад предсказание всегда «впереди» — ресинк нужен сразу.
  return driftMs > DRIFT_RESET_MS || freshTimeSec < predicted - 0.05;
}

/** Бинарный поиск последней строки, начавшейся не позже `tMs`. */
function findLineIndex(lines: TimedLine[], tMs: Milliseconds): number {
  let low = 0;
  let high = lines.length - 1;
  let result = -1;

  while (low <= high) {
    const mid = (low + high) >> 1;
    const line = lines[mid];
    if (line && line.startMs <= tMs) {
      result = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return result;
}

/** Бинарный поиск активного слова внутри строки. */
function findWordIndex(words: TimedWord[], tMs: Milliseconds): number {
  let low = 0;
  let high = words.length - 1;
  let result = -1;

  while (low <= high) {
    const mid = (low + high) >> 1;
    const word = words[mid];
    if (word && word.startMs <= tMs) {
      result = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return result;
}

/** Прогресс слова от 0 до 1; без `endMs` — 0, чтобы не врать о прогрессе. */
function wordProgress(word: TimedWord | undefined, tMs: Milliseconds): number {
  if (!word || word.endMs === undefined) return 0;
  const durationMs = word.endMs - word.startMs;
  if (durationMs <= 0) return 1;
  const raw = (tMs - word.startMs) / durationMs;
  return Math.min(1, Math.max(0, raw));
}

/**
 * Находит активную строку и слово на момент `timeSec`.
 *
 * @param timeline разобранный текст
 * @param timeSec позиция воспроизведения в секундах
 * @param leadMs опережение подсветки (не путать с `[offset]` из LRC)
 */
export function findActive(
  timeline: LyricsTimeline | null,
  timeSec: Seconds,
  leadMs: Milliseconds = DEFAULT_LEAD_MS,
): ActiveState {
  if (!timeline || timeline.lines.length === 0) return NOTHING_ACTIVE;

  const tMs = timeSec * 1000 + leadMs;
  const lineIndex = findLineIndex(timeline.lines, tMs);
  if (lineIndex < 0) return NOTHING_ACTIVE;

  const line = timeline.lines[lineIndex];
  if (!line || !line.words || line.words.length === 0) {
    return { lineIndex, wordIndex: -1, wordProgress: 0 };
  }

  const wordIndex = findWordIndex(line.words, tMs);
  if (wordIndex < 0) return { lineIndex, wordIndex: -1, wordProgress: 0 };

  return {
    lineIndex,
    wordIndex,
    wordProgress: wordProgress(line.words[wordIndex], tMs),
  };
}
