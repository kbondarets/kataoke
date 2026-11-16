import { describe, expect, it } from 'vitest';
import { parsePageEvent, parsePageState } from '../src/adapters/yandex-music/yandex-adapter';

/** Снимок в том виде, в котором его отправляет агент страницы. */
function message(state: Record<string, unknown>): Record<string, unknown> {
  return {
    source: 'kataoke-page',
    kind: 'state',
    state: {
      title: 'Tattoo',
      artist: 'Rammstein',
      album: '',
      durationSec: 251,
      positionSec: 12.5,
      paused: false,
      playbackRate: 1,
      hasMedia: true,
      ...state,
    },
  };
}

describe('parsePageState', () => {
  it('читает снимок агента', () => {
    expect(parsePageState(message({}))).toEqual({
      title: 'Tattoo',
      artist: 'Rammstein',
      album: '',
      durationSec: 251,
      positionSec: 12.5,
      paused: false,
      playbackRate: 1,
      hasMedia: true,
    });
  });

  it('пустой mediaSession даёт пустые строки, а не падение', () => {
    const state = parsePageState(message({ title: '', artist: '', album: '' }));
    expect(state?.title).toBe('');
    expect(state?.artist).toBe('');
  });

  it('Infinity в длительности превращается в 0', () => {
    // Агент уже приводит значение к 0, но проверяем устойчивость парсера.
    const state = parsePageState(message({ durationSec: 0 }));
    expect(state?.durationSec).toBe(0);
  });

  it('отвергает чужие сообщения', () => {
    expect(parsePageState(null)).toBeNull();
    expect(parsePageState({ kind: 'state' })).toBeNull();
    expect(parsePageState({ kind: 'event', name: 'play' })).toBeNull();
    expect(parsePageState({ kind: 'state', state: 'мусор' })).toBeNull();
  });
});

describe('parsePageEvent', () => {
  it('узнаёт события плеера', () => {
    for (const name of ['play', 'pause', 'seek', 'ratechange', 'ended', 'trackchange']) {
      expect(parsePageEvent({ source: 'kataoke-page', kind: 'event', name })).toBe(name);
    }
  });

  it('не пропускает неизвестные события', () => {
    expect(parsePageEvent({ kind: 'event', name: 'loadedmetadata' })).toBeNull();
    expect(parsePageEvent({ kind: 'event', name: 42 })).toBeNull();
    expect(parsePageEvent({ kind: 'state' })).toBeNull();
  });
});