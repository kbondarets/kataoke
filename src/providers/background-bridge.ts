/**
 * Мост «content script → service worker» для запросов текста.
 *
 * В MV3 `fetch` из content script подчиняется CORS страницы: `host_permissions`
 * даёт обход только в service worker. Поэтому все сетевые запросы идут через
 * background, а content script общается с ним сообщениями.
 */

import type { LyricsResult, TrackInfo } from '../core/types';
import type { LyricsProvider } from './lyrics-provider';

/** Тип сообщения «найди текст для трека». */
export const LOOKUP_MESSAGE = 'kataoke:lookup';

/** Запрос текста. */
export interface LookupRequest {
  type: typeof LOOKUP_MESSAGE;
  track: TrackInfo;
}

/** Ответ: либо результат, либо текст ошибки — исключения через сообщения не ходят. */
export type LookupResponse =
  | { ok: true; result: LyricsResult | null }
  | { ok: false; error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Проверяет, что пришедшее сообщение — наш запрос. */
export function isLookupRequest(value: unknown): value is LookupRequest {
  if (!isRecord(value)) return false;
  if (value['type'] !== LOOKUP_MESSAGE) return false;

  const track = value['track'];
  if (!isRecord(track)) return false;
  return typeof track['title'] === 'string' && typeof track['artist'] === 'string';
}

/** Проверяет форму ответа: его тоже присылают извне. */
export function isLookupResponse(value: unknown): value is LookupResponse {
  if (!isRecord(value)) return false;
  if (value['ok'] === true) return 'result' in value;
  if (value['ok'] === false) return typeof value['error'] === 'string';
  return false;
}

/** Провайдер текстов, который на самом деле спрашивает service worker. */
export class BackgroundLyricsProvider implements LyricsProvider {
  readonly id = 'lrclib';

  async lookup(track: TrackInfo, signal: AbortSignal): Promise<LyricsResult | null> {
    const request: LookupRequest = { type: LOOKUP_MESSAGE, track };

    const response: unknown = await Promise.race([
      chrome.runtime.sendMessage(request),
      // `sendMessage` не поддерживает отмену: гонка с abort — единственный способ
      // не держать устаревший запрос, когда пользователь уже переключил трек.
      new Promise<never>((_, reject) => {
        if (signal.aborted) reject(new Error('запрос отменён'));
        signal.addEventListener('abort', () => reject(new Error('запрос отменён')), {
          once: true,
        });
      }),
    ]);

    if (!isLookupResponse(response)) {
      throw new Error('фон не ответил на запрос текста');
    }
    if (!response.ok) throw new Error(response.error);
    return response.result;
  }
}