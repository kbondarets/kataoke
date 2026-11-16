import { describe, expect, it } from 'vitest';
import { parseYandexTitle } from '../src/adapters/yandex-music/yandex-adapter';
import { parseYouTubeTitle } from '../src/adapters/youtube/youtube-adapter';
import {
  buildTrackKey,
  durationMatches,
  normalizeArtist,
  normalizeTitle,
} from '../src/core/track-match';

describe('normalizeTitle', () => {
  it('убирает пометку remaster', () => {
    expect(normalizeTitle('Yesterday (Remastered 2009)')).toBe('yesterday');
  });

  it('убирает feat. и всё после него', () => {
    expect(normalizeTitle('Song feat. Somebody')).toBe('song');
  });

  it('убирает radio edit в скобках', () => {
    expect(normalizeTitle('Song [Radio Edit]')).toBe('song');
  });

  it('убирает тире-суффикс «- Single Version»', () => {
    expect(normalizeTitle('Song - Single Version')).toBe('song');
  });

  it('приводит ё к е и схлопывает пробелы', () => {
    expect(normalizeTitle('Клён   мой')).toBe('клен мой');
  });

  it('склеивает & в «и»', () => {
    expect(normalizeTitle('Рок & Ролл')).toBe('рок и ролл');
  });
});

describe('normalizeArtist', () => {
  it('берёт первого исполнителя из перечисления', () => {
    expect(normalizeArtist('Первый, Второй')).toBe('первый');
  });

  it('режет по feat.', () => {
    expect(normalizeArtist('Основной feat. Другой')).toBe('основной');
  });
});

describe('durationMatches', () => {
  it('совпадает в пределах допуска', () => {
    expect(durationMatches(200, 205)).toBe(true);
  });

  it('не совпадает, если разница больше допуска', () => {
    expect(durationMatches(200, 215)).toBe(false);
  });

  it('неизвестная длительность не блокирует совпадение', () => {
    expect(durationMatches(undefined, 200)).toBe(true);
  });
});

describe('buildTrackKey', () => {
  it('даёт одинаковый ключ для разных вариаций названия', () => {
    const a = buildTrackKey({ title: 'Song (Remastered)', artist: 'Art', durationSec: 200.4 });
    const b = buildTrackKey({ title: 'Song', artist: 'Art', durationSec: 200.1 });
    expect(a).toBe(b);
  });

  it('разные треки дают разные ключи', () => {
    const a = buildTrackKey({ title: 'Song', artist: 'Art', durationSec: 200 });
    const b = buildTrackKey({ title: 'Song', artist: 'Art', durationSec: 260 });
    expect(a).not.toBe(b);
  });

  it('неизвестная длительность не мешает найти тот же трек', () => {
    const unknown = buildTrackKey({ title: 'Song', artist: 'Art', durationSec: 0 });
    const known = buildTrackKey({ title: 'Song', artist: 'Art', durationSec: 200 });
    expect(unknown).toBe('art|song');
    expect(known.startsWith('art|song|')).toBe(true);
  });
});

describe('parseYandexTitle', () => {
  it('разбирает «Трек — Артист»', () => {
    expect(parseYandexTitle('Группа крови — Кино')).toEqual({
      title: 'Группа крови',
      artist: 'Кино',
    });
  });

  it('отрезает суффикс «— Яндекс Музыка»', () => {
    expect(parseYandexTitle('Группа крови — Кино — Яндекс Музыка')).toEqual({
      title: 'Группа крови',
      artist: 'Кино',
    });
  });

  it('возвращает null, если плеер не на треке', () => {
    expect(parseYandexTitle('Яндекс Музыка')).toBeNull();
  });

  it('возвращает null, если разделителя нет', () => {
    expect(parseYandexTitle('Моя волна')).toBeNull();
  });
});

describe('parseYouTubeTitle', () => {
  it('разбирает «Артист - Трек»', () => {
    expect(parseYouTubeTitle('Кино - Группа крови')).toEqual({
      artist: 'Кино',
      title: 'Группа крови',
    });
  });

  it('убирает хвост «- YouTube»', () => {
    expect(parseYouTubeTitle('Кино - Группа крови - YouTube')).toEqual({
      artist: 'Кино',
      title: 'Группа крови',
    });
  });

  it('берёт первый разделитель, остальное оставляет в названии', () => {
    expect(parseYouTubeTitle('Кино - Группа крови - Live')).toEqual({
      artist: 'Кино',
      title: 'Группа крови - Live',
    });
  });

  it('без разделителя весь заголовок уходит в название', () => {
    expect(parseYouTubeTitle('Группа крови')).toEqual({ artist: '', title: 'Группа крови' });
  });
});
