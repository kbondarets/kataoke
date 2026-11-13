import { parseLrc } from '../../core/lyrics/parse-lrc';
import type { LyricsResult, TrackInfo } from '../../core/types';
import { LOOKUP_TIMEOUT_MS, fetchWithTimeout } from '../lyrics-provider';
import type { LyricsProvider } from '../lyrics-provider';
import {
  buildGetParams,
  chooseOutcome,
  parseLrclibRecord,
  plainTimeline,
} from './parse-response';

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
   * Ищет текст по точным метаданным.
   *
   * `null` — текста нет или трек инструментальный. Ошибки сети и разбора
   * пробрасываются наверх: провайдер не решает, что показать пользователю.
   */
  async lookup(track: TrackInfo, signal: AbortSignal): Promise<LyricsResult | null> {
    const url = `${this.baseUrl}/get?${buildGetParams(track).toString()}`;
    const response = await fetchWithTimeout(url, this.timeoutMs, signal);

    // 404 — нормальный ответ «такого трека в базе нет».
    if (response.status === 404) return null;
    if (!response.ok) {
      throw new Error(`LRCLIB: HTTP ${response.status}`);
    }

    const payload: unknown = await response.json();
    const record = parseLrclibRecord(payload);
    const outcome = chooseOutcome(record);

    if (outcome.kind === 'none') return null;
    if (outcome.kind === 'instrumental') return null;

    const timeline = outcome.synced
      ? parseLrc(outcome.text)
      : plainTimeline(outcome.text);

    if (timeline.lines.length === 0) return null;

    return { providerId: this.id, timeline };
  }
}
