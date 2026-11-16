import type { LyricsTimeline, TrackInfo } from '../../core/types';

/**
 * Разбор ответа LRCLIB.
 *
 * Ответ приходит из сети, то есть является `unknown` до проверки: никаких `as`.
 * Отдельный файл без сети — чтобы тесты могли гонять фикстуры офлайн.
 */

/** Полезные поля ответа LRCLIB, которые нам действительно нужны. */
export interface LrclibRecord {
  trackName: string | null;
  artistName: string | null;
  syncedLyrics: string | null;
  plainLyrics: string | null;
  instrumental: boolean;
  duration: number | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readStringOrNull(source: Record<string, unknown>, key: string): string | null {
  const value = source[key];
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

function readNumberOrNull(source: Record<string, unknown>, key: string): number | null {
  const value = source[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * Проверяет и достаёт запись LRCLIB из `unknown`.
 * Возвращает `null`, если форма ответа не та — лучше «не нашли», чем падение.
 */
export function parseLrclibRecord(raw: unknown): LrclibRecord | null {
  if (!isRecord(raw)) return null;

  return {
    trackName: readStringOrNull(raw, 'trackName'),
    artistName: readStringOrNull(raw, 'artistName'),
    syncedLyrics: readStringOrNull(raw, 'syncedLyrics'),
    plainLyrics: readStringOrNull(raw, 'plainLyrics'),
    instrumental: raw['instrumental'] === true,
    duration: readNumberOrNull(raw, 'duration'),
  };
}

/** Что делать с записью: отдать текст, сообщить об инструментале или ничего. */
export type LrclibOutcome =
  | { kind: 'text'; text: string; synced: boolean }
  | { kind: 'instrumental' }
  | { kind: 'none' };

/**
 * Выбирает, что показывать.
 *
 * Синхронизированный текст всегда предпочтительнее: он даёт караоке. Plain —
 * только как запасной вариант, чтобы пользователь не остался без текста.
 */
export function chooseOutcome(record: LrclibRecord | null): LrclibOutcome {
  if (!record) return { kind: 'none' };
  if (record.syncedLyrics) {
    return { kind: 'text', text: record.syncedLyrics, synced: true };
  }
  if (record.plainLyrics) {
    return { kind: 'text', text: record.plainLyrics, synced: false };
  }
  if (record.instrumental) return { kind: 'instrumental' };
  return { kind: 'none' };
}

/** Утилита для тестов и провайдера: длительность записи в секундах. */
export function recordDurationSec(record: LrclibRecord): number | null {
  return record.duration;
}

/** Собирает параметры точного поиска. */
export function buildGetParams(track: TrackInfo): URLSearchParams {
  const params = new URLSearchParams({
    artist_name: track.artist,
    track_name: track.title,
  });
  // Без длительности точный запрос LRCLIB почти всегда отвечает 404,
  // поэтому при неизвестной длительности используем поиск.
  if (track.durationSec > 0) params.set('duration', String(Math.round(track.durationSec)));
  if (track.album) params.set('album_name', track.album);
  return params;
}

/** Параметры поиска — запасной путь, когда точный запрос не сработал. */
export function buildSearchParams(track: TrackInfo): URLSearchParams {
  const params = new URLSearchParams({
    artist_name: track.artist,
    track_name: track.title,
  });
  if (track.album) params.set('album_name', track.album);
  return params;
}

/** Таймлайн для случаев, когда синхронизации нет. */
export function plainTimeline(text: string): LyricsTimeline {
  return {
    kind: 'plain',
    lines: text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line !== '')
      .map((line) => ({ text: line, startMs: 0 })),
  };
}
