import type { PlayerAdapter, PlayerEvent, Unsubscribe } from '../../core/player-adapter';
import type { Seconds, TrackInfo } from '../../core/types';

/**
 * Адаптер Яндекс Музыки — основной сервис MVP.
 *
 * Современный плеер сервиса держит медиа-элемент **вне DOM** (`new Audio()` без
 * вставки в документ), поэтому из изолированного мира расширения не видно ни
 * элемента, ни `mediaSession`. Проверено на живой странице: при играющем треке
 * `document.querySelectorAll('audio, video')` даёт 0, а метаданные пусты.
 *
 * Отсюда схема:
 * 1. `page-agent.ts` исполняется в MAIN-мире страницы, перехватывает `play()` и
 *    отправляет снимок через `window.postMessage`;
 * 2. этот файл (изолированный мир) слушает сообщения и отдаёт данные ядру.
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

/** Префикс сообщений агента страницы. Должен совпадать с `page-agent.ts`. */
const NAMESPACE = 'kataoke-page';

/** Резервная проверка смены трека, если агент ничего не прислал. */
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

/** Состояние плеера, которое присылает агент страницы. */
export interface PageState {
  title: string;
  artist: string;
  album: string;
  durationSec: number;
  positionSec: number;
  paused: boolean;
  playbackRate: number;
  hasMedia: boolean;
}

/** События агента, которые нас интересуют как события адаптера. */
const PAGE_EVENTS = new Set<PlayerEvent>([
  'play',
  'pause',
  'seek',
  'ratechange',
  'ended',
  'trackchange',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readString(source: Record<string, unknown>, key: string): string {
  const value = source[key];
  return typeof value === 'string' ? value : '';
}

function readNumber(source: Record<string, unknown>, key: string): number {
  const value = source[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/** Проверяет и достаёт состояние из `MessageEvent.data` (оно всегда `unknown`). */
export function parsePageState(data: unknown): PageState | null {
  if (!isRecord(data) || data['kind'] !== 'state') return null;
  const state = data['state'];
  if (!isRecord(state)) return null;

  return {
    title: readString(state, 'title'),
    artist: readString(state, 'artist'),
    album: readString(state, 'album'),
    durationSec: readNumber(state, 'durationSec'),
    positionSec: readNumber(state, 'positionSec'),
    paused: state['paused'] !== false,
    playbackRate: readNumber(state, 'playbackRate') || 1,
    hasMedia: state['hasMedia'] === true,
  };
}

/** Проверяет, что сообщение — событие плеера, и возвращает его имя. */
export function parsePageEvent(data: unknown): PlayerEvent | null {
  if (!isRecord(data) || data['kind'] !== 'event') return null;
  const name = data['name'];
  if (typeof name !== 'string') return null;
  return PAGE_EVENTS.has(name as PlayerEvent) ? (name as PlayerEvent) : null;
}

export class YandexMusicAdapter implements PlayerAdapter {
  readonly id = 'yandex-music';

  readonly #listeners = new Map<PlayerEvent, Set<Listener>>();
  readonly #detach: Array<() => void> = [];
  #state: PageState | null = null;
  #lastTrackKey = '';
  #started = false;

  matches(url: string): boolean {
    return isYandexMusicUrl(url);
  }

  getTrack(): TrackInfo | null {
    const state = this.#state;
    if (!state) return null;

    // Метаданные важнее позиции: трек можно опознать и до того, как элемент
    // перехвачен. Тогда текст уже покажется, а подсветка догонит при `play()`.
    if (state.title.trim() !== '') {
      return {
        title: state.title,
        artist: state.artist.trim() !== '' ? state.artist : 'Яндекс Музыка',
        ...(state.album.trim() !== '' ? { album: state.album } : {}),
        durationSec: state.durationSec,
      };
    }

    if (!state.hasMedia) return null;

    // Запасной путь: заголовок вкладки. На новом интерфейсе он обычно равен
    // «Яндекс Музыка — собираем музыку для вас», то есть трека в нём нет.
    const fromTitle = parseYandexTitle(document.title);
    if (!fromTitle) return null;

    return {
      title: fromTitle.title,
      artist: fromTitle.artist,
      durationSec: state.durationSec,
    };
  }

  getPositionSec(): Seconds | null {
    return this.#state?.hasMedia ? this.#state.positionSec : null;
  }

  isPlaying(): boolean {
    return this.#state?.hasMedia ? !this.#state.paused : false;
  }

  getPlaybackRate(): number {
    return this.#state?.playbackRate ?? 1;
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
   * Подписка на сообщения агента страницы.
   *
   * Слушаем `message` из изолированного мира: агент живёт в MAIN-мире, и другого
   * канала связи между этими мирами нет.
   */
  #start(): void {
    if (this.#started) return;
    this.#started = true;

    /** Сколько снимков пришло от агента: 0 означает, что агент не работает. */
    let received = 0;

    const onMessage = (event: MessageEvent<unknown>): void => {
      // Сообщения из других окон и фреймов игнорируем.
      if (event.source !== window) return;
      const data = event.data;
      if (!isRecord(data) || data['source'] !== NAMESPACE) return;

      const state = parsePageState(data);
      if (state) {
        this.#state = state;
        received += 1;
        if (received === 1) {
          console.info('[kataoke] агент страницы на связи', state);
        }
        this.#checkTrackChanged();
        return;
      }

      const name = parsePageEvent(data);
      if (name) this.#emit(name);
    };

    window.addEventListener('message', onMessage);
    this.#detach.push(() => window.removeEventListener('message', onMessage));

    // Страховка на случай, если агент не прислал ни одного снимка (например,
    // инъекция в MAIN-мир запрещена политикой страницы).
    const watchdog = window.setInterval(() => {
      this.#refreshFromDom();
      this.#checkTrackChanged();
    }, MEDIA_WATCHDOG_MS);
    this.#detach.push(() => window.clearInterval(watchdog));

    this.#refreshFromDom();
    this.#checkTrackChanged();
  }

  /**
   * Резервный путь: медиа-элемент, отрисованный в DOM.
   *
   * Если агент работает, это ничего не меняет — его снимок точнее. Если агента
   * нет, у нас хотя бы есть позиция и длительность, а метаданные возьмутся из
   * заголовка вкладки.
   */
  #refreshFromDom(): void {
    if (this.#state?.hasMedia) return;

    const media = document.querySelector('audio, video');
    if (!(media instanceof HTMLMediaElement)) return;

    this.#state = {
      title: '',
      artist: '',
      album: '',
      durationSec: safeDurationSec(media),
      positionSec: media.currentTime,
      paused: media.paused,
      playbackRate: media.playbackRate,
      hasMedia: true,
    };
  }

  #checkTrackChanged(): void {
    const track = this.getTrack();
    // Длительность в ключ не входит: пока метаданные не загрузились она равна 0,
    // и трек отличался бы сам от себя после появления длительности.
    const key = track ? `${track.artist}|${track.title}` : '';
    if (key === this.#lastTrackKey) return;
    this.#lastTrackKey = key;
    this.#emit('trackchange');
  }

  #emit(event: PlayerEvent): void {
    const set = this.#listeners.get(event);
    if (!set) return;
    for (const listener of set) listener();
  }
}
