import { parseLrc } from '../../core/lyrics/parse-lrc';
import { normalizeArtist, normalizeTitle } from '../../core/track-match';
import type { LyricsResult, TrackInfo } from '../../core/types';
import { LOOKUP_TIMEOUT_MS, fetchWithTimeout } from '../lyrics-provider';
import type { LyricsProvider } from '../lyrics-provider';
import {
  buildGetParams,
  buildSearchParams,
  chooseOutcome,
  parseLrclibRecord,
  plainTimeline,
} from './parse-response';
import type { LrclibRecord } from './parse-response';

/** Базовый адрес LRCLIB. Открытый API без ключа. */
export const LRCLIB_BASE = 'https://lrclib.net/api';

/** Провайдер текстов из LRCLIB. */
export class LrclibProvider implements LyricsProvider {
  readonly id = 'lrclib';

  constructor(
    private readonly baseUrl: string = LRCLIB_BASE,
    private readonly timeoutMs: number = LOOKUP_TIMEOUT_MS,
  ) {}

  /**
   * Ищет текст по метаданным.
   *
   * Сначала точный запрос (`/get`) — он быстрый и даёт самый подходящий трек.
   * Если он не дал результата (обычная причина — неизвестная длительность или
   * другой ремастер), пробуем поиск (`/search`) и выбираем лучший вариант.
   *
   * `null` — текста нет. Ошибки сети пробрасываются наверх: провайдер не решает,
   * что показать пользователю.
   */
  async lookup(track: TrackInfo, signal: AbortSignal): Promise<LyricsResult | null> {
    const direct = await this.#lookupExact(track, signal);
    if (direct) return direct;

    return this.#lookupSearch(track, signal);
  }

  async #lookupExact(track: TrackInfo, signal: AbortSignal): Promise<LyricsResult | null> {
    // Точный запрос без длительности LRCLIB почти всегда не находит — сразу поиск.
    if (track.durationSec <= 0) return null;

    const url = `${this.baseUrl}/get?${buildGetParams(track).toString()}`;
    const response = await fetchWithTimeout(url, this.timeoutMs, signal);

    // 404 — нормальный ответ «такого трека в базе нет».
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`LRCLIB: HTTP ${response.status}`);

    const payload: unknown = await response.json();
    return this.#toResult(parseLrclibRecord(payload));
  }

  async #lookupSearch(track: TrackInfo, signal: AbortSignal): Promise<LyricsResult | null> {
    const url = `${this.baseUrl}/search?${buildSearchParams(track).toString()}`;
    const response = await fetchWithTimeout(url, this.timeoutMs, signal);

    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`LRCLIB: HTTP ${response.status}`);

    const payload: unknown = await response.json();
    if (!Array.isArray(payload)) return null;

    const candidates = payload
      .map((item) => this.#scoreCandidate(parseLrclibRecord(item), track))
      .filter((candidate): candidate is { record: LrclibRecord; score: number } => candidate !== null)
      .sort((a, b) => b.score - a.score);

    for (const candidate of candidates) {
      const result = this.#toResult(candidate.record);
      if (result) return result;
    }

    return null;
  }

  /**
   * Оценка кандидата: точное совпадение исполнителя и названия — главное,
   * совпадение длительности — сильный бонус.
   */
  #scoreCandidate(
    record: LrclibRecord | null,
    track: TrackInfo,
  ): { record: LrclibRecord; score: number } | null {
    if (!record) return null;
    if (!record.syncedLyrics && !record.plainLyrics) return null;

    let score = 0;
    if (record.syncedLyrics) score += 10;
    if (record.instrumental) score -= 20;

    if (track.durationSec > 0 && record.duration !== null) {
      const diffSec = Math.abs(record.duration - track.durationSec);
      if (diffSec <= 3) score += 8;
      else if (diffSec <= 7) score += 4;
      else if (diffSec > 30) score -= 5;
    }

    if (record.trackName && normalizeTitle(record.trackName) === normalizeTitle(track.title)) {
      score += 6;
    }
    if (record.artistName && normalizeArtist(record.artistName) === normalizeArtist(track.artist)) {
      score += 6;
    }

    return score > 0 ? { record, score } : null;
  }

  #toResult(record: LrclibRecord | null): LyricsResult | null {
    const outcome = chooseOutcome(record);
    if (outcome.kind !== 'text') return null;

    const timeline = outcome.synced ? parseLrc(outcome.text) : plainTimeline(outcome.text);
    if (timeline.lines.length === 0) return null;

    return { providerId: this.id, timeline };
  }
}
