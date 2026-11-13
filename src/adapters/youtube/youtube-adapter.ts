import type { PlayerAdapter, PlayerEvent, Unsubscribe } from '../../core/player-adapter';
import type { Seconds, TrackInfo } from '../../core/types';

/**
 * Адаптер YouTube.
 *
 * Самый простой сервис: один `<video>`, название ролика в `document.title`.
 * Название приходится разбирать: YouTube не даёт «артист — трек» отдельными
 * полями. Разбор вынесен в чистую функцию и покрыт тестами.
 */

/** «Artist - Title (Official Video)» → `{ artist, title }`. */
export function parseYouTubeTitle(rawTitle: string): { artist: string; title: string } {
  // Убираем хвост « - YouTube», который браузер добавляет к заголовку вкладки.
  const cleaned = rawTitle.replace(/\s*-\s*YouTube\s*$/i, '').trim();

  // Разделитель — дефис в любом начертании; берём первое вхождение, чтобы
  // «A - B - C» превратилось в artist «A», title «B - C».
  const separator = cleaned.match(/\s+[-–—]\s+/);
  if (!separator || separator.index === undefined) {
    return { artist: '', title: cleaned };
  }

  const artist = cleaned.slice(0, separator.index).trim();
  const title = cleaned.slice(separator.index + separator[0].length).trim();
  return { artist, title };
}

/** Подходит ли страница YouTube-адаптеру. */
export function isYouTubeUrl(url: string): boolean {
  return /^https:\/\/(www\.)?youtube\.com\//.test(url);
}

type Listener = () => void;

export class YouTubeAdapter implements PlayerAdapter {
  readonly id = 'youtube';

  readonly #listeners = new Map<PlayerEvent, Set<Listener>>();
  readonly #mediaListeners: Array<() => void> = [];
  #lastTrackKey = '';

  matches(url: string): boolean {
    return isYouTubeUrl(url);
  }

  getTrack(): TrackInfo | null {
    const media = this.#media();
    if (!media || !Number.isFinite(media.duration) || media.duration <= 0) return null;

    const { artist, title } = parseYouTubeTitle(document.title);
    if (title === '') return null;

    const videoId = new URLSearchParams(location.search).get('v') ?? undefined;
    return {
      title,
      artist: artist || 'YouTube',
      durationSec: media.duration,
      ...(videoId ? { sourceId: videoId } : {}),
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

    // Подписка на медиа-элемент ставится лениво: плеер может появиться позже.
    this.#ensureMediaListeners();

    return () => {
      set.delete(callback);
    };
  }

  destroy(): void {
    for (const unsubscribe of this.#mediaListeners.splice(0)) unsubscribe();
    this.#listeners.clear();
  }

  /** Медиа-элемент страницы; реклама идёт в том же `<video>`, отдельного нет. */
  #media(): HTMLVideoElement | null {
    const element = document.querySelector('video');
    return element instanceof HTMLVideoElement ? element : null;
  }

  #ensureMediaListeners(): void {
    const media = this.#media();
    if (!media || this.#mediaListeners.length > 0) return;

    const bind = (name: string, event: PlayerEvent | 'meta'): void => {
      const handler = (): void => {
        if (event === 'meta') {
          const track = this.getTrack();
          const key = track ? `${track.title}|${track.durationSec}` : '';
          if (key !== this.#lastTrackKey) {
            this.#lastTrackKey = key;
            this.#emit('trackchange');
          }
          return;
        }
        this.#emit(event);
      };
      media.addEventListener(name, handler);
      this.#mediaListeners.push(() => media.removeEventListener(name, handler));
    };

    bind('play', 'play');
    bind('pause', 'pause');
    bind('seeked', 'seek');
    bind('ratechange', 'ratechange');
    bind('ended', 'ended');
    bind('loadedmetadata', 'meta');
    bind('durationchange', 'meta');
  }

  #emit(event: PlayerEvent): void {
    const set = this.#listeners.get(event);
    if (!set) return;
    for (const listener of set) listener();
  }
}
