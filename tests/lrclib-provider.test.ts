import { describe, expect, it, vi } from 'vitest';
import {
  buildGetParams,
  chooseOutcome,
  parseLrclibRecord,
} from '../src/providers/lrclib/parse-response';
import type { LrclibRecord } from '../src/providers/lrclib/parse-response';
import { LrclibProvider } from '../src/providers/lrclib/lrclib-provider';
import type { TrackInfo } from '../src/core/types';

const track: TrackInfo = {
  title: 'Группа крови',
  artist: 'Кино',
  durationSec: 271,
};

/** Запись LRCLIB с значениями по умолчанию: тесту важны только отличия. */
function record(overrides: Partial<LrclibRecord> = {}): LrclibRecord {
  return {
    trackName: 'Группа крови',
    artistName: 'Кино',
    syncedLyrics: null,
    plainLyrics: null,
    instrumental: false,
    duration: 271,
    ...overrides,
  };
}

describe('parseLrclibRecord', () => {
  it('достаёт поля из корректного ответа', () => {
    const record = parseLrclibRecord({
      trackName: 'Группа крови',
      artistName: 'Кино',
      syncedLyrics: '[00:10.00]Строка',
      plainLyrics: 'Строка',
      instrumental: false,
      duration: 271,
    });

    expect(record).toEqual({
      trackName: 'Группа крови',
      artistName: 'Кино',
      syncedLyrics: '[00:10.00]Строка',
      plainLyrics: 'Строка',
      instrumental: false,
      duration: 271,
    });
  });

  it('возвращает null на мусор вместо падения', () => {
    expect(parseLrclibRecord(null)).toBeNull();
    expect(parseLrclibRecord('строка')).toBeNull();
    expect(parseLrclibRecord(42)).toBeNull();
  });

  it('пустые строки считаются отсутствием текста', () => {
    const record = parseLrclibRecord({ syncedLyrics: '   ', plainLyrics: '' });
    expect(record?.syncedLyrics).toBeNull();
    expect(record?.plainLyrics).toBeNull();
  });
});

describe('chooseOutcome', () => {
  it('синхронизированный текст предпочтительнее plain', () => {
    const outcome = chooseOutcome(
      record({ syncedLyrics: '[00:10.00]Строка', plainLyrics: 'Строка' }),
    );
    expect(outcome).toEqual({ kind: 'text', text: '[00:10.00]Строка', synced: true });
  });

  it('без синхронизации отдаёт plain', () => {
    const outcome = chooseOutcome(record({ plainLyrics: 'Строка' }));
    expect(outcome).toEqual({ kind: 'text', text: 'Строка', synced: false });
  });

  it('инструментал без текста — отдельное состояние', () => {
    const outcome = chooseOutcome(record({ instrumental: true }));
    expect(outcome).toEqual({ kind: 'instrumental' });
  });

  it('пустая запись — «ничего не нашли»', () => {
    expect(chooseOutcome(record())).toEqual({ kind: 'none' });
  });
});

describe('LrclibProvider', () => {
  it('404 означает «текста нет», а не ошибку', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('', { status: 404 }));
    vi.stubGlobal('fetch', fetchMock);

    const provider = new LrclibProvider('https://example.test/api', 1000);
    const result = await provider.lookup(track, new AbortController().signal);

    expect(result).toBeNull();
    vi.unstubAllGlobals();
  });

  it('500 — это ошибка, её обрабатывает вызывающий код', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('', { status: 500 }));
    vi.stubGlobal('fetch', fetchMock);

    const provider = new LrclibProvider('https://example.test/api', 1000);
    await expect(provider.lookup(track, new AbortController().signal)).rejects.toThrow();
    vi.unstubAllGlobals();
  });

  it('синхронизированный текст превращается в таймлайн', async () => {
    const fetchMock = vi.fn().mockImplementation(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            trackName: 'Группа крови',
            artistName: 'Кино',
            syncedLyrics: '[00:10.00]Первая\n[00:20.00]Вторая',
            plainLyrics: null,
            instrumental: false,
            duration: 271,
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const provider = new LrclibProvider('https://example.test/api', 1000);
    const result = await provider.lookup(track, new AbortController().signal);

    expect(result?.timeline.kind).toBe('line');
    expect(result?.timeline.lines.map((line) => line.startMs)).toEqual([10000, 20000]);
    vi.unstubAllGlobals();
  });

  it('plain-текст даёт плоский таймлайн без караоке', async () => {
    const fetchMock = vi.fn().mockImplementation(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            trackName: 'Группа крови',
            artistName: 'Кино',
            syncedLyrics: null,
            plainLyrics: 'Первая\nВторая',
            instrumental: false,
            duration: 271,
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const provider = new LrclibProvider('https://example.test/api', 1000);
    const result = await provider.lookup(track, new AbortController().signal);

    expect(result?.timeline.kind).toBe('plain');
    expect(result?.timeline.lines.map((line) => line.text)).toEqual(['Первая', 'Вторая']);
    vi.unstubAllGlobals();
  });

  it('параметры запроса содержат артиста, трек и длительность', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('', { status: 404 }));
    vi.stubGlobal('fetch', fetchMock);

    const provider = new LrclibProvider('https://example.test/api', 1000);
    await provider.lookup(track, new AbortController().signal);

    const raw = String(fetchMock.mock.calls[0]?.[0]);
    const params = new URL(raw).searchParams;
    expect(params.get('artist_name')).toBe('Кино');
    expect(params.get('track_name')).toBe('Группа крови');
    expect(params.get('duration')).toBe('271');
    vi.unstubAllGlobals();
  });

  it('точный запрос не нашёл — пробуем поиск и берём лучший вариант', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('', { status: 404 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            // Другой трек: длительность сильно расходится.
            { trackName: 'Другая', artistName: 'Кино', syncedLyrics: '[00:01.00]Не то', duration: 90 },
            // Наш трек.
            { trackName: 'Группа крови', artistName: 'Кино', syncedLyrics: '[00:10.00]То', duration: 272 },
          ]),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      );
    vi.stubGlobal('fetch', fetchMock);

    const provider = new LrclibProvider('https://example.test/api', 1000);
    const result = await provider.lookup(track, new AbortController().signal);

    expect(String(fetchMock.mock.calls[1]?.[0])).toContain('/search?');
    expect(result?.timeline.kind).toBe('line');
    expect(result?.timeline.lines.map((line) => line.text)).toEqual(['То']);
    vi.unstubAllGlobals();
  });

  it('без известной длительности точный запрос не делается вовсе', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('[]', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const provider = new LrclibProvider('https://example.test/api', 1000);
    await provider.lookup({ ...track, durationSec: 0 }, new AbortController().signal);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/search?');
    vi.unstubAllGlobals();
  });

  it('находит трек, записанный в базе транслитом', async () => {
    // Реальный случай: Яндекс отдаёт «Король и Шут», в LRCLIB запись
    // «Korol i Shut». Запрос с artist_name не находит ничего — выручает
    // поиск по названию плюс сравнение с точностью до транслитерации.
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('', { status: 404 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            { trackName: 'Хозяин леса', artistName: 'Noize MC', syncedLyrics: '[00:01.00]Чужое', duration: 270 },
            { trackName: 'Хозяин леса', artistName: 'Korol i Shut', syncedLyrics: '[00:02.00]Наше', duration: 188 },
          ]),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      );
    vi.stubGlobal('fetch', fetchMock);

    const provider = new LrclibProvider('https://example.test/api', 1000);
    const result = await provider.lookup(
      { title: 'Хозяин леса', artist: 'Король и Шут', durationSec: 188 },
      new AbortController().signal,
    );

    expect(result?.timeline.lines.map((line) => line.text)).toEqual(['Наше']);
    vi.unstubAllGlobals();
  });

  it('не отдаёт текст чужой песни с тем же названием', async () => {
    // База почти всегда возвращает чужой трек по названию: лучше «не найдено»,
    // чем текст другой песни.
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('', { status: 404 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            { trackName: 'Wires', artistName: 'Athlete', syncedLyrics: '[00:01.00]Чужое', duration: 245 },
            { trackName: 'Wires', artistName: 'Red Fang', syncedLyrics: '[00:01.00]Тоже чужое', duration: 343 },
          ]),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      );
    vi.stubGlobal('fetch', fetchMock);

    const provider = new LrclibProvider('https://example.test/api', 1000);
    const result = await provider.lookup(
      { title: 'Wires', artist: 'Limberbridge', durationSec: 200 },
      new AbortController().signal,
    );

    expect(result).toBeNull();
    vi.unstubAllGlobals();
  });

  it('исполнитель в перечислении в базе не мешает найти трек', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('', { status: 404 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            {
              trackName: 'Wires',
              artistName: 'Built By Titan, Skybourne',
              syncedLyrics: '[00:01.00]Наше',
              duration: 205,
            },
          ]),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      );
    vi.stubGlobal('fetch', fetchMock);

    const provider = new LrclibProvider('https://example.test/api', 1000);
    const result = await provider.lookup(
      { title: 'Wires', artist: 'Built By Titan', durationSec: 205 },
      new AbortController().signal,
    );

    expect(result?.timeline.lines.map((line) => line.text)).toEqual(['Наше']);
    vi.unstubAllGlobals();
  });

  it('синхронизированный вариант предпочитается плоскому', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('', { status: 404 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            { trackName: 'Wires', artistName: 'Built By Titan', plainLyrics: 'Плоский', duration: 205 },
            { trackName: 'Wires', artistName: 'Built By Titan', syncedLyrics: '[00:01.00]Караоке', duration: 205 },
          ]),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      );
    vi.stubGlobal('fetch', fetchMock);

    const provider = new LrclibProvider('https://example.test/api', 1000);
    const result = await provider.lookup(
      { title: 'Wires', artist: 'Built By Titan', durationSec: 205 },
      new AbortController().signal,
    );

    expect(result?.timeline.kind).toBe('line');
    expect(result?.timeline.lines.map((line) => line.text)).toEqual(['Караоке']);
    vi.unstubAllGlobals();
  });

  it('продолжение названия — уже другая песня', async () => {
    // `Wires II` содержит `Wires` как подстроку, но это другая песня:
    // её текст хуже, чем «не найдено».
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('', { status: 404 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            { trackName: 'Wires II', artistName: 'Athlete', syncedLyrics: '[00:01.00]Другое', duration: 245 },
          ]),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      );
    vi.stubGlobal('fetch', fetchMock);

    const provider = new LrclibProvider('https://example.test/api', 1000);
    const result = await provider.lookup(
      { title: 'Wires', artist: 'Athlete', durationSec: 245 },
      new AbortController().signal,
    );

    expect(result).toBeNull();
    vi.unstubAllGlobals();
  });
});

describe('buildGetParams', () => {
  it('длительность попадает в запрос только когда она известна', () => {
    expect(buildGetParams(track).get('duration')).toBe('271');
    expect(buildGetParams({ ...track, durationSec: 0 }).get('duration')).toBeNull();
  });
});
