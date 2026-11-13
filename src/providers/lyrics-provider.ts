import type { LyricsResult, TrackInfo } from '../core/types';

/**
 * Контракт источника текстов.
 *
 * `null` — «текста нет», это не ошибка. Сетевая или иная проблема — исключение,
 * которое UI превращает в понятное сообщение на русском.
 */
export interface LyricsProvider {
  readonly id: string;

  lookup(track: TrackInfo, signal: AbortSignal): Promise<LyricsResult | null>;
}

/** Таймаут запроса текста: пользователь не должен ждать дольше. */
export const LOOKUP_TIMEOUT_MS = 8000;

/**
 * Обёртка над `fetch` с обязательным таймаутом и отменой.
 *
 * Запрос без таймаута — блокирующее замечание на ревью: в реальной сети всё
 * рвётся, и «вечная загрузка» недопустима.
 */
export async function fetchWithTimeout(
  url: string,
  timeoutMs: number,
  external?: AbortSignal,
): Promise<Response> {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const signal = external ? AbortSignal.any([external, timeoutSignal]) : timeoutSignal;
  return fetch(url, { signal });
}
