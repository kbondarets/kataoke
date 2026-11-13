import type { PlayerAdapter } from '../core/player-adapter';
import { YandexMusicAdapter } from './yandex-music/yandex-adapter';
import { YouTubeAdapter } from './youtube/youtube-adapter';

/**
 * Реестр адаптеров.
 *
 * Новый сервис = новый адаптер + одна строка здесь. Ядро и UI не меняются.
 */
export function createAdapters(): PlayerAdapter[] {
  return [new YandexMusicAdapter(), new YouTubeAdapter()];
}

/** Выбирает адаптер под текущий URL (первый подходящий). */
export function pickAdapter(adapters: PlayerAdapter[], url: string): PlayerAdapter | null {
  return adapters.find((adapter) => adapter.matches(url)) ?? null;
}

export { YandexMusicAdapter, YouTubeAdapter };
