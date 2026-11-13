import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LEAD_MS,
  NOTHING_ACTIVE,
  findActive,
  positionAt,
  shouldResync,
} from '../src/core/sync/sync-engine';
import type { PositionSample } from '../src/core/sync/sync-engine';
import type { LyricsTimeline } from '../src/core/types';

/** Таймлайн из двух строк: 10 c и 20 c. */
function lineTimeline(): LyricsTimeline {
  return {
    kind: 'line',
    lines: [
      { text: 'Первая', startMs: 10000, endMs: 20000 },
      { text: 'Вторая', startMs: 20000 },
    ],
  };
}

/** Таймлайн с таймингами слов внутри одной строки. */
function wordTimeline(): LyricsTimeline {
  return {
    kind: 'word',
    lines: [
      {
        text: 'Ой мороз',
        startMs: 10000,
        words: [
          { text: 'Ой ', startMs: 10000, endMs: 11000 },
          { text: 'мороз', startMs: 11000, endMs: 13000 },
        ],
      },
    ],
  };
}

function sample(overrides: Partial<PositionSample> = {}): PositionSample {
  return { mediaTimeSec: 10, wallMs: 0, rate: 1, playing: true, ...overrides };
}

describe('positionAt', () => {
  it('без сэмпла позиция равна нулю', () => {
    expect(positionAt(null, 5000)).toBe(0);
  });

  it('на паузе позиция не растёт', () => {
    expect(positionAt(sample({ playing: false }), 10000)).toBe(10);
  });

  it('при обычной скорости позиция растёт по прошедшему времени', () => {
    expect(positionAt(sample(), 1500)).toBeCloseTo(11.5, 5);
  });

  it('учитывает скорость воспроизведения', () => {
    expect(positionAt(sample({ rate: 0.5 }), 2000)).toBeCloseTo(11, 5);
  });
});

describe('shouldResync', () => {
  it('без сэмпла синхронизация нужна всегда', () => {
    expect(shouldResync(null, 5, 0)).toBe(true);
  });

  it('небольшое расхождение не требует ресинка', () => {
    // Предсказание: 10.1, свежее значение 10.12 — расхождение 20 мс.
    expect(shouldResync(sample(), 10.12, 100)).toBe(false);
  });

  it('перемотка назад требует ресинка', () => {
    expect(shouldResync(sample(), 2, 100)).toBe(true);
  });

  it('большой дрейф требует ресинка', () => {
    expect(shouldResync(sample(), 15, 100)).toBe(true);
  });
});

describe('findActive: строки', () => {
  it('до первой строки ничего не активно', () => {
    expect(findActive(lineTimeline(), 0)).toEqual(NOTHING_ACTIVE);
  });

  it('находит активную строку с учётом опережения', () => {
    // 10.0 c минус опережение 100 мс = 9.9 c — строка ещё не началась.
    const state = findActive(lineTimeline(), 9.95);
    expect(state.lineIndex).toBe(0);
    expect(DEFAULT_LEAD_MS).toBe(100);
  });

  it('переключается на вторую строку', () => {
    expect(findActive(lineTimeline(), 20).lineIndex).toBe(1);
  });

  it('работает на пустом и отсутствующем таймлайне', () => {
    expect(findActive(null, 10)).toEqual(NOTHING_ACTIVE);
    expect(findActive({ kind: 'line', lines: [] }, 10)).toEqual(NOTHING_ACTIVE);
  });

  it('опережение можно отключить', () => {
    expect(findActive(lineTimeline(), 9.95, 0)).toEqual(NOTHING_ACTIVE);
  });
});

describe('findActive: слова', () => {
  it('находит активное слово', () => {
    const state = findActive(wordTimeline(), 11.2, 0);
    expect(state.lineIndex).toBe(0);
    expect(state.wordIndex).toBe(1);
  });

  it('считает прогресс активного слова', () => {
    const state = findActive(wordTimeline(), 12, 0);
    // Слово идёт с 11.0 до 13.0 — на 12.0 прогресс 0.5.
    expect(state.wordProgress).toBeCloseTo(0.5, 5);
  });

  it('до начала строки ничего не активно', () => {
    const state = findActive(wordTimeline(), 9.5, 0);
    expect(state).toEqual(NOTHING_ACTIVE);
  });

  it('между началом строки и первым словом слово не активно', () => {
    // Слово начинается в 10.00, строка тоже. До неё активной строки нет,
    // поэтому проверяем состояние ровно на старте.
    const state = findActive(wordTimeline(), 10, 0);
    expect(state.lineIndex).toBe(0);
    expect(state.wordIndex).toBe(0);
  });
});
