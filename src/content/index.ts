import { createAdapters, pickAdapter } from '../adapters';
import { MemoryCacheStore, NEGATIVE_TTL_MS, POSITIVE_TTL_MS, TtlCache } from '../core/cache';
import { DEFAULT_LEAD_MS, findActive, positionAt, shouldResync } from '../core/sync/sync-engine';
import type { ActiveState, PositionSample } from '../core/sync/sync-engine';
import { buildTrackKey } from '../core/track-match';
import type { LyricsTimeline, TrackInfo } from '../core/types';
import { LrclibProvider } from '../providers/lrclib/lrclib-provider';
import { mountOverlay } from '../ui/overlay/mount';
import type { OverlayStatus } from '../ui/overlay/Overlay';

/**
 * Content script: связывает адаптер сервиса, источник текста и оверлей.
 *
 * Здесь заканчивается «знание про мир»: ядро не знает про сервисы, адаптеры не
 * знают про текст, провайдеры не знают про UI. Собирает всё вместе только этот
 * файл.
 */

/** Периодичность проверки `currentTime`: интерполяция сглаживает рывки. */
const SAMPLE_INTERVAL_MS = 300;

/** Смещение подсветки вперёд (человек читает заранее). */
const LEAD_MS = DEFAULT_LEAD_MS;

function start(): void {
  const adapters = createAdapters();
  const adapter = pickAdapter(adapters, location.href);
  if (!adapter) return;

  // В MVP кеш живёт в памяти вкладки: `chrome.storage` подключим отдельной
  // задачей, чтобы не смешивать сборку расширения с логикой синхронизации.
  const cache = new TtlCache(new MemoryCacheStore(), 1);
  const provider = new LrclibProvider();

  const overlay = mountOverlay();

  let track: TrackInfo | null = null;
  let timeline: LyricsTimeline | null = null;
  let status: OverlayStatus = 'idle';
  let errorMessage: string | undefined;

  let sample: PositionSample | null = null;
  let active: ActiveState = { lineIndex: -1, wordIndex: -1, wordProgress: 0 };
  let lookupAbort: AbortController | null = null;
  let frameHandle = 0;

  const nowMs = (): number => performance.now();

  function setStatus(next: OverlayStatus, message?: string): void {
    status = next;
    errorMessage = message;
    overlay.update({
      status,
      timeline,
      active,
      ...(message !== undefined ? { errorMessage: message } : {}),
    });
  }

  function resetSample(): void {
    const positionSec = adapter?.getPositionSec() ?? null;
    if (positionSec === null) {
      sample = null;
      return;
    }
    sample = {
      mediaTimeSec: positionSec,
      wallMs: nowMs(),
      rate: adapter?.getPlaybackRate() ?? 1,
      playing: adapter?.isPlaying() ?? false,
    };
  }

  async function loadLyrics(nextTrack: TrackInfo): Promise<void> {
    lookupAbort?.abort();
    const controller = new AbortController();
    lookupAbort = controller;

    const key = buildTrackKey(nextTrack);
    const cached = await cache.get<LyricsTimeline>(key);
    if (cached) {
      timeline = cached;
      setStatus('ready');
      return;
    }

    timeline = null;
    setStatus('loading');

    try {
      const result = await provider.lookup(nextTrack, controller.signal);
      if (controller.signal.aborted) return;

      if (!result) {
        await cache.set(key, null, NEGATIVE_TTL_MS);
        timeline = null;
        setStatus('not-found');
        return;
      }

      timeline = result.timeline;
      await cache.set(key, result.timeline, POSITIVE_TTL_MS);
      setStatus('ready');
    } catch (error) {
      if (controller.signal.aborted) return;
      console.warn('[kataoke] не удалось получить текст', error);
      setStatus('error', 'Не удалось получить текст. Проверьте соединение.');
    }
  }

  function handleTrackChange(): void {
    const next = adapter?.getTrack() ?? null;
    if (!next) {
      track = null;
      timeline = null;
      setStatus('idle');
      return;
    }

    if (track && next.title === track.title && next.artist === track.artist) return;

    track = next;
    resetSample();
    void loadLyrics(next);
  }

  function tick(): void {
    frameHandle = requestAnimationFrame(tick);
    if (!adapter || !track) return;

    const fresh = adapter.getPositionSec();
    if (fresh === null) return;

    const now = nowMs();
    if (shouldResync(sample, fresh, now)) {
      sample = {
        mediaTimeSec: fresh,
        wallMs: now,
        rate: adapter.getPlaybackRate(),
        playing: adapter.isPlaying(),
      };
    }

    const positionSec = positionAt(sample, now);
    const next = findActive(timeline, positionSec, LEAD_MS);

    // Перерисовка только при смене активной строки/слова: иначе будет лаг.
    if (
      next.lineIndex === active.lineIndex &&
      next.wordIndex === active.wordIndex
    ) {
      return;
    }

    active = next;
    overlay.update({
      status,
      timeline,
      active,
      ...(errorMessage !== undefined ? { errorMessage } : {}),
    });
  }

  adapter.on('trackchange', handleTrackChange);
  adapter.on('seek', resetSample);
  adapter.on('play', resetSample);
  adapter.on('pause', resetSample);
  adapter.on('ratechange', resetSample);

  // Первичная загрузка: плеер к моменту инъекции может ещё не существовать.
  handleTrackChange();
  setInterval(() => {
    if (!track) handleTrackChange();
  }, 1000);

  frameHandle = requestAnimationFrame(tick);

  window.addEventListener('pagehide', () => {
    cancelAnimationFrame(frameHandle);
    lookupAbort?.abort();
    adapter.destroy();
    overlay.destroy();
  });
}

start();
