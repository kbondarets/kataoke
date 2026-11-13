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

export class YandexMusicAdapter implements PlayerAdapter {
  readonly id = 'yandex-music';

  readonly #listeners = new Map<PlayerEvent, Set<Listener>>();
  readonly #detach: Array<() => void> = [];
  #lastTrackKey = '';
  #started = false;

  matches(url: string): boolean {
    return isYandexMusicUrl(url);
  }

  getTrack(): TrackInfo | null {
    const media = this.#media();
    if (!media || !Number.isFinite(media.duration) || media.duration <= 0) return null;

    const fromMediaSession = this.#trackFromMediaSession(media);
    if (fromMediaSession) return fromMediaSession;

    const fromTitle = parseYandexTitle(document.title);
    if (!fromTitle) return null;

    return {
      title: fromTitle.title,
      artist: fromTitle.artist,
      durationSec: media.duration,
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

    const media = this.#media();
    if (media) {
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
      bind('durationchange', 'trackchange');
    }

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

    this.#checkTrackChanged();
  }

  #checkTrackChanged(): void {
    const track = this.getTrack();
    const key = track ? `${track.artist}|${track.title}|${Math.round(track.durationSec)}` : '';
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
      durationSec: media.duration,
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
