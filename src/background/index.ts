/**
 * Service worker расширения.
 *
 * В MV3 он не живёт постоянно: просыпается по событию и может быть выгружен.
 * Поэтому состояния в памяти нет — всё, что нужно, живёт в `chrome.storage`.
 *
 * Здесь же выполняются сетевые запросы к провайдеру текстов: `host_permissions`
 * снимает CORS только для service worker, из content script запрос упрётся в
 * политику страницы.
 */

import { isLookupRequest } from '../providers/background-bridge';
import type { LookupResponse } from '../providers/background-bridge';
import { LrclibProvider } from '../providers/lrclib/lrclib-provider';

const provider = new LrclibProvider();

/** Установка: помечаем версию, чтобы при обновлении можно было сбросить кеш. */
chrome.runtime.onInstalled.addListener((details) => {
  void chrome.storage.local.set({ installedAtMs: Date.now(), installReason: details.reason });
});

/**
 * Обработчик запросов текста.
 *
 * `return true` обязателен: он говорит Chrome, что ответ будет асинхронным.
 * Без него канал закрывается сразу и content script получает `undefined`.
 */
chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  if (!isLookupRequest(message)) return false;

  const controller = new AbortController();

  provider
    .lookup(message.track, controller.signal)
    .then((result) => {
      const response: LookupResponse = { ok: true, result };
      sendResponse(response);
    })
    .catch((error: unknown) => {
      const response: LookupResponse = {
        ok: false,
        error: error instanceof Error ? error.message : 'неизвестная ошибка',
      };
      sendResponse(response);
    });

  return true;
});

export {};
