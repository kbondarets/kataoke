/**
 * Service worker расширения.
 *
 * В MV3 он не живёт постоянно: просыпается по событию и может быть выгружен.
 * Поэтому состояния в памяти нет — всё, что нужно, живёт в `chrome.storage`.
 */

/** Установка: помечаем версию, чтобы при обновлении можно было сбросить кеш. */
chrome.runtime.onInstalled.addListener((details) => {
  void chrome.storage.local.set({ installedAtMs: Date.now(), installReason: details.reason });
});

export {};
