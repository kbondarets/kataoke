import type { Seconds, TrackInfo } from './types';

/**
 * Контракт адаптера сервиса.
 *
 * Ядро и UI не знают ни одного селектора конкретного сайта: всё, что зависит от
 * разметки сервиса, живёт в реализации этого интерфейса. Проверка на ревью:
 * «если вёрстка сервиса поменялась — сколько файлов чинить?» — один.
 */

export type PlayerEvent =
  | 'trackchange'
  | 'play'
  | 'pause'
  | 'seek'
  | 'ratechange'
  | 'ended';

export type Unsubscribe = () => void;

export interface PlayerAdapter {
  /** Стабильный идентификатор сервиса, например `yandex-music`. */
  readonly id: string;

  /** Подходит ли текущая страница этому адаптеру. */
  matches(url: string): boolean;

  /** Текущий трек или `null`, если плеер не найден / трек не определён. */
  getTrack(): TrackInfo | null;

  /**
   * Позиция воспроизведения в секундах.
   *
   * Источник — медиа-элемент (`<video>`/`<audio>.currentTime`). Прогресс-бар в
   * DOM источником времени не является.
   */
  getPositionSec(): Seconds | null;

  isPlaying(): boolean;

  getPlaybackRate(): number;

  /** Подписка на события плеера. Возвращает функцию отписки. */
  on(event: PlayerEvent, callback: () => void): Unsubscribe;

  /** Освобождает подписки и наблюдатели. */
  destroy(): void;
}
