import { describe, expect, it, vi } from 'vitest';
import {
  chooseOutcome,
  parseLrclibRecord,
} from '../src/providers/lrclib/parse-response';
import { LrclibProvider } from '../src/providers/lrclib/lrclib-provider';
import type { TrackInfo } from '../src/core/types';

const track: TrackInfo = {
  title: 'Группа крови',
  artist: 'Кино',
  durationSec: 271,
};

describe('parseLrclibRecord', () => {
  it('достаёт поля из корректного ответа', () => {
    const record = parseLrclibRecord({
      syncedLyrics: '[00:10.00]Строка',
      plainLyrics: 'Строка',
      instrumental: false,
      duration: 271,
    });

    expect(record).toEqual({
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
    const outcome = chooseOutcome({
      syncedLyrics: '[00:10.00]Строка',
      plainLyrics: 'Строка',
      instrumental: false,
      duration: 271,
    });
    expect(outcome).toEqual({ kind: 'text', text: '[00:10.00]Строка', synced: true });
  });

  it('без синхронизации отдаёт plain', () => {
    const outcome = chooseOutcome({
      syncedLyrics: null,
      plainLyrics: 'Строка',
      instrumental: false,
      duration: 271,
    });
    expect(outcome).toEqual({ kind: 'text', text: 'Строка', synced: false });
  });

  it('инструментал без текста — отдельное состояние', () => {
    const outcome = chooseOutcome({
      syncedLyrics: null,
      plainLyrics: null,
      instrumental: true,
      duration: 271,
    });
    expect(outcome).toEqual({ kind: 'instrumental' });
  });

  it('пустая запись — «ничего не нашли»', () => {
    expect(
      chooseOutcome({ syncedLyrics: null, plainLyrics: null, instrumental: false, duration: 271 }),
    ).toEqual({ kind: 'none' });
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
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          syncedLyrics: '[00:10.00]Первая\n[00:20.00]Вторая',
          plainLyrics: null,
          instrumental: false,
          duration: 271,
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
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
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          syncedLyrics: null,
          plainLyrics: 'Первая\nВторая',
          instrumental: false,
          duration: 271,
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
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
});
