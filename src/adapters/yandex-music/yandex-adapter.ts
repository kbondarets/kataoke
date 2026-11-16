import type { PlayerAdapter, PlayerEvent, Unsubscribe } from '../../core/player-adapter';
import type { Seconds, TrackInfo } from '../../core/types';

/**
 * Адаптер Яндекс Музыки — основной сервис MVP.
 *
 * Публичного стабильного API у сервиса нет, поэтому метаданные берутся из
 * нескольких источников по приоритету:
 * 1. `navigator.mediaSession.metadata` — стандарт, его заполняют многие плееры;
 * 2. `document.title` — «Трек — Артист» (формат может меняться, поэтому разбор
 *    терпимый).
 *
 * Вся работа с разметкой сервиса живёт здесь и только здесь: если Яндекс
 * поменяет вёрстку, чинить нужно один файл.
 */

/** Подходит ли страница Яндекс Музыке. */
export function isYandexMusicUrl(url: string): boolean {
  return /^https:\/\/music\.yandex\.(ru|com|kz|by|uz)\//.test(url);
}

/**
 * Разбирает заголовок вкладки Яндекс Музыки.
 *
 * Форматы, которые надо понимать:
 * - `Трек — Артист`;
 * - `Трек — Артист — Яндекс Музыка`;
 * - `Яндекс Музыка` (плеер не на треке — трека нет).
 */
export function parseYandexTitle(rawTitle: string): { artist: string; title: string } | null {
  const cleaned = rawTitle.replace(/\s*[—–-]\s*Яндекс\s+Музыка\s*$/i, '').trim();
  if (cleaned === '' || /^Яндекс\s+Музыка$/i.test(cleaned)) return null;

  const match = cleaned.match(/^(.+?)\s+[—–]\s+(.+)$/);
  if (!match) return null;

  const title = match[1]?.trim() ?? '';
  const artist = match[2]?.trim() ?? '';
  if (title === '' || artist === '') return null;

  return { title, artist };
}

type Listener = () => void;

/**
 * Как часто проверять, не появился ли медиа-элемент.
 *
 * У Яндекс Музыки `<audio>` создаётся после загрузки SPA-приложения, а при
 * навигации внутри сервиса — пересоздаётся. Слушатели, навешенные на старый
 * элемент, тихо перестают работать, поэтому нужен периодический переподхват.
 */
const MEDIA_WATCHDOG_MS = 1000;

/**
 * Длительность медиа-элемента в секундах, где «неизвестно» = 0.
 *
 * У MSE-плееров `duration` бывает `Infinity` (поток ещё не досчитан) или `NaN`
 * (метаданных ещё нет). Возвращать такие значения нельзя: они попадут в ключ
 * кеша и в запрос к провайдеру.
 */
export function safeDurationSec(media: HTMLMediaElement): Seconds {
  const value = media.duration;
  return Number.isFinite(value) && value > 0 ? value : 0;
}

export class YandexMusicAdapter implements PlayerAdapter {
  readonly id = 'yandex-music';

  readonly #listeners = new Map<PlayerEvent, Set<Listener>>();
  readonly #detach: Array<() => void> = [];
  readonly #mediaDetach: Array<() => void> = [];
  #boundMedia: HTMLMediaElement | null = null;
  #lastTrackKey = '';
  #started = false;

  matches(url: string): boolean {
    return isYandexMusicUrl(url);
  }

  getTrack(): TrackInfo | null {
    const media = this.#media();
    if (!media) return null;

    const fromMediaSession = this.#trackFromMediaSession(media);
    if (fromMediaSession) return fromMediaSession;

    const fromTitle = parseYandexTitle(document.title);
    if (!fromTitle) return null;

    return {
      title: fromTitle.title,
      artist: fromTitle.artist,
      durationSec: safeDurationSec(media),
    };
  }

  getPositionSec(): Seconds | null {
    const media = this.#media();
    if (!media) return null;
    return media.currentTime;
  }

  isPlaying(): boolean {
    const media = this.#media();
    return media ? !media.paused : false;
  }

  getPlaybackRate(): number {
    const media = this.#media();
    return media?.playbackRate ?? 1;
  }

  on(event: PlayerEvent, callback: () => void): Unsubscribe {
    const set = this.#listeners.get(event) ?? new Set<Listener>();
    set.add(callback);
    this.#listeners.set(event, set);

    this.#start();

    return () => {
      set.delete(callback);
    };
  }

  destroy(): void {
    this.#unbindMedia();
    for (const detach of this.#detach.splice(0)) detach();
    this.#listeners.clear();
    this.#started = false;
  }

  /**
   * Яндекс Музыка — SPA: трек меняется без перезагрузки. Поэтому слушаем не
   * только медиа-элемент, но и изменения заголовка вкладки и навигацию.
   */
  #start(): void {
    if (this.#started) return;
    this.#started = true;

    this.#bindMedia();

    // Смена трека без событий медиа-элемента ловится по заголовку вкладки.
    const titleElement = document.querySelector('title');
    if (titleElement) {
      const observer = new MutationObserver(() => this.#checkTrackChanged());
      observer.observe(titleElement, { childList: true, characterData: true, subtree: true });
      this.#detach.push(() => observer.disconnect());
    }

    const onNavigate = (): void => this.#checkTrackChanged();
    window.addEventListener('popstate', onNavigate);
    this.#detach.push(() => window.removeEventListener('popstate', onNavigate));

    // Content script может стартовать раньше плеера: `<audio>` у Яндекса
    // появляется/пересоздаётся при навигации внутри SPA. Watchdog довязывает
    // события на новый элемент и заодно ловит смену трека.
    const watchdog = window.setInterval(() => {
      this.#bindMedia();
      this.#checkTrackChanged();
    }, MEDIA_WATCHDOG_MS);
    this.#detach.push(() => window.clearInterval(watchdog));

    this.#checkTrackChanged();
  }

  /** Подписывается на события текущего медиа-элемента ровно один раз. */
  #bindMedia(): void {
    const media = this.#media();
    if (!media || media === this.#boundMedia) return;

    this.#unbindMedia();
    this.#boundMedia = media;

    const bind = (name: string, event: PlayerEvent): void => {
      const handler = (): void => this.#emit(event);
      media.addEventListener(name, handler);
      this.#detach.push(() => media.removeEventListener(name, handler));
    };

    bind('play', 'play');
    bind('pause', 'pause');
    bind('seeked', 'seek');
    bind('ratechange', 'ratechange');
    bind('ended', 'ended');
    bind('loadedmetadata', 'trackchange');
    bind('durationchange', 'trackchange');
  }

  #unbindMedia(): void {
    for (const detach of this.#mediaDetach.splice(0)) detach();
    this.#boundMedia = null;
  }

  #checkTrackChanged(): void {
    const track = this.getTrack();
    // Длительность в ключ не входит: пока метаданные не загрузились она равна 0,
    // и трек отличался бы сам от себя после `loadedmetadata`.
    const key = track ? `${track.artist}|${track.title}` : '';
    if (key === this.#lastTrackKey) return;
    this.#lastTrackKey = key;
    this.#emit('trackchange');
  }

  /** Метаданные из MediaSession — самый надёжный источник, если он заполнен. */
  #trackFromMediaSession(media: HTMLMediaElement): TrackInfo | null {
    const metadata = navigator.mediaSession?.metadata;
    if (!metadata || !metadata.title) return null;

    return {
      title: metadata.title,
      artist: metadata.artist || 'Яндекс Музыка',
      ...(metadata.album ? { album: metadata.album } : {}),
      durationSec: safeDurationSec(media),
    };
  }

  /** Медиа-элемент плеера: если их несколько, берём играющий. */
  #media(): HTMLMediaElement | null {
    const elements = Array.from(document.querySelectorAll('audio, video')).filter(
      (element): element is HTMLMediaElement => element instanceof HTMLMediaElement,
    );
    if (elements.length <= 1) return elements[0] ?? null;

    return elements.find((element) => !element.paused) ?? elements[0] ?? null;
  }

  #emit(event: PlayerEvent): void {
    const set = this.#listeners.get(event);
    if (!set) return;
    for (const listener of set) listener();
  }
}
