import { parseLrc } from '../../core/lyrics/parse-lrc';
import { normalizeArtist, normalizeTitle } from '../../core/track-match';
import { containsTranslit, sameTranslit } from '../../core/translit';
import type { LyricsResult, TrackInfo } from '../../core/types';
import { LOOKUP_TIMEOUT_MS, fetchWithTimeout } from '../lyrics-provider';
import type { LyricsProvider } from '../lyrics-provider';
import {
  buildGetParams,
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
   * Ищет текст по метаданным, от точного запроса к широкому.
   *
   * Каскад нужен из-за того, как заполнен LRCLIB:
   * 1. `/get` — точное совпадение исполнителя, названия и длительности;
   * 2. `/search?track_name=` — без исполнителя, потому что база заполнена
   *    вручную и один и тот же артист лежит там то кириллицей, то транслитом:
   *    Яндекс отдаёт `Король и Шут`, а запись — `Korol i Shut`, и запрос с
   *    `artist_name` возвращает ноль. По названию находится десяток чужих
   *    песен, поэтому совпадение исполнителя проверяется отдельно — отдать
   *    текст одноимённого трека другого артиста хуже, чем не найти ничего.
   *
   * `null` — текста нет. Ошибки сети пробрасываются наверх: провайдер не решает,
   * что показать пользователю.
   */
  async lookup(track: TrackInfo, signal: AbortSignal): Promise<LyricsResult | null> {
    const exact = await this.#lookupExact(track, signal);
    if (exact) return exact;

    return this.#search(new URLSearchParams({ track_name: track.title }), track, signal);
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
    const record = parseLrclibRecord(payload);
    if (!record) return null;

    // Точный ответ тоже проверяем: `/get` иногда отдаёт похожий трек.
    if (this.#score(record, track) === 0) return null;
    return this.#toResult(record);
  }

  /**
   * Поиск с готовыми параметрами.
   *
   * Параметры передаются снаружи: разные попытки каскада используют разные поля,
   * и собирать их из трека внутри было бы неявно.
   */
  async #search(
    search: URLSearchParams,
    track: TrackInfo,
    signal: AbortSignal,
  ): Promise<LyricsResult | null> {
    const url = `${this.baseUrl}/search?${search.toString()}`;
    const response = await fetchWithTimeout(url, this.timeoutMs, signal);

    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`LRCLIB: HTTP ${response.status}`);

    const payload: unknown = await response.json();
    if (!Array.isArray(payload)) return null;

    const candidates = payload
      .map((item) => {
        const record = parseLrclibRecord(item);
        return record === null ? null : { record, score: this.#score(record, track) };
      })
      .filter((candidate): candidate is { record: LrclibRecord; score: number } => candidate !== null)
      .filter((candidate) => candidate.score > 0)
      .sort((a, b) => b.score - a.score);

    for (const candidate of candidates) {
      const result = this.#toResult(candidate.record);
      if (result) return result;
    }

    return null;
  }

  /**
   * Оценка кандидата: `0` — не наш трек.
   *
   * Обязательны и исполнитель, и название. Только так можно безопасно искать по
   * одному названию: `Хозяин леса` есть в базе у Noize MC и у лиззз, и без этой
   * проверки пользователь увидел бы текст чужой песни — это хуже, чем «не найдено».
   *
   * Сравнение идёт с точностью до транслитерации: база заполнена вручную, поэтому
   * `Король и Шут` и `Korol i Shut` — это один и тот же артист.
   */
  #score(record: LrclibRecord, track: TrackInfo): number {
    if (!record.syncedLyrics && !record.plainLyrics) return 0;
    if (record.instrumental) return 0;

    const wantedArtist = normalizeArtist(track.artist);
    const wantedTitle = normalizeTitle(track.title);
    const foundArtist = record.artistName === null ? '' : normalizeArtist(record.artistName);
    const foundTitle = record.trackName === null ? '' : normalizeTitle(record.trackName);

    // Содержание вместо равенства нужно только для исполнителя: в базе его
    // перечисляют через запятую (`Built By Titan, Skybourne`), а сервис отдаёт
    // одного. Для названия — только полное совпадение: `Wires II` это другая
    // песня, и текст от неё хуже, чем «не найдено».
    const artistExact = sameTranslit(wantedArtist, foundArtist);
    if (!artistExact && !containsTranslit(foundArtist, wantedArtist)) return 0;

    const titleExact = sameTranslit(wantedTitle, foundTitle);
    if (!titleExact) return 0;

    // База: совпадение названия и исполнителя подтверждено выше.
    let score = 20;
    if (artistExact) score += 10;

    // Синхронизированный текст даёт караоке — это заметно ценнее плоского.
    if (record.syncedLyrics) score += 10;

    if (track.durationSec > 0 && record.duration !== null) {
      const diffSec = Math.abs(record.duration - track.durationSec);
      if (diffSec <= 3) score += 8;
      else if (diffSec <= 7) score += 4;
      else if (diffSec > 30) score -= 15;
      else if (diffSec > 15) score -= 5;
    }

    return Math.max(score, 0);
  }

  #toResult(record: LrclibRecord | null): LyricsResult | null {
    const outcome = chooseOutcome(record);
    if (outcome.kind !== 'text') return null;

    const timeline = outcome.synced ? parseLrc(outcome.text) : plainTimeline(outcome.text);
    if (timeline.lines.length === 0) return null;

    return { providerId: this.id, timeline };
  }
}
