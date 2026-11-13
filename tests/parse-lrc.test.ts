import { describe, expect, it } from 'vitest';
import { parseLrc } from '../src/core/lyrics/parse-lrc';

describe('parseLrc: plain-текст', () => {
  it('текст без таймингов остаётся plain, времена не выдумываются', () => {
    const timeline = parseLrc('Первая строка\nВторая строка');
    expect(timeline.kind).toBe('plain');
    expect(timeline.lines).toHaveLength(2);
    expect(timeline.lines.every((line) => line.startMs === 0)).toBe(true);
  });

  it('пустые строки сохраняются как разделители, но не в начале и не в конце', () => {
    const timeline = parseLrc('\nПервая\n\nВторая\n\n');
    expect(timeline.lines.map((line) => line.text)).toEqual(['Первая', '', 'Вторая']);
  });
});

describe('parseLrc: построчный LRC', () => {
  it('разбирает минуты, секунды и сотые', () => {
    const timeline = parseLrc('[00:12.34]Первая\n[00:18.10]Вторая');
    expect(timeline.kind).toBe('line');
    expect(timeline.lines[0]).toMatchObject({ text: 'Первая', startMs: 12340 });
    expect(timeline.lines[1]).toMatchObject({ text: 'Вторая', startMs: 18100 });
  });

  it('однозначная дробь трактуется как десятые, а не как миллисекунды', () => {
    const timeline = parseLrc('[00:12.3]Строка');
    expect(timeline.lines[0]?.startMs).toBe(12300);
  });

  it('трёхзначная дробь — это миллисекунды', () => {
    const timeline = parseLrc('[00:12.345]Строка');
    expect(timeline.lines[0]?.startMs).toBe(12345);
  });

  it('метка без дроби даёт ровные секунды', () => {
    const timeline = parseLrc('[01:02]Строка');
    expect(timeline.lines[0]?.startMs).toBe(62000);
  });

  it('несколько меток перед строкой дают несколько позиций одной строки', () => {
    const timeline = parseLrc('[00:10.00][01:30.00]Припев');
    expect(timeline.lines).toHaveLength(2);
    expect(timeline.lines.map((line) => line.startMs)).toEqual([10000, 90000]);
    expect(timeline.lines.every((line) => line.text === 'Припев')).toBe(true);
  });

  it('конец строки равен началу следующей', () => {
    const timeline = parseLrc('[00:10.00]Первая\n[00:15.00]Вторая');
    expect(timeline.lines[0]?.endMs).toBe(15000);
    expect(timeline.lines[1]?.endMs).toBeUndefined();
  });

  it('сортирует строки по времени, если в файле они вразнобой', () => {
    const timeline = parseLrc('[00:20.00]Вторая\n[00:10.00]Первая');
    expect(timeline.lines.map((line) => line.text)).toEqual(['Первая', 'Вторая']);
  });
});

describe('parseLrc: метаданные и смещение', () => {
  it('служебные теги не попадают в текст', () => {
    const timeline = parseLrc('[ar:Ария]\n[ti:Ангел]\n[al:Генератор зла]\n[00:10.00]Строка');
    expect(timeline.lines).toHaveLength(1);
    expect(timeline.lines[0]?.text).toBe('Строка');
  });

  it('положительный offset прибавляется ко всем временам', () => {
    const timeline = parseLrc('[offset:+250]\n[00:10.00]Строка');
    expect(timeline.lines[0]?.startMs).toBe(10250);
  });

  it('отрицательный offset вычитается, но не уходит в минус', () => {
    const timeline = parseLrc('[offset:-2000]\n[00:01.00]Строка');
    expect(timeline.lines[0]?.startMs).toBe(0);
  });
});

describe('parseLrc: k-word', () => {
  it('разбирает слова с их временами', () => {
    const timeline = parseLrc('[00:10.00]<00:10.00>Первое <00:10.80>слово');
    expect(timeline.kind).toBe('word');
    const line = timeline.lines[0];
    expect(line?.text).toBe('Первое слово');
    expect(line?.words).toEqual([
      { text: 'Первое ', startMs: 10000, endMs: 10800 },
      { text: 'слово', startMs: 10800 },
    ]);
  });

  it('склейка слов обратно даёт исходный текст строки', () => {
    const timeline = parseLrc('[00:10.00]<00:10.00>Ой <00:10.50>мороз, <00:11.00>мороз');
    const line = timeline.lines[0];
    const joined = (line?.words ?? []).map((word) => word.text).join('');
    expect(joined).toBe(line?.text);
  });

  it('offset применяется и к словам, один раз', () => {
    const timeline = parseLrc('[offset:+100]\n[00:10.00]<00:10.00>Слово');
    expect(timeline.lines[0]?.words?.[0]?.startMs).toBe(10100);
  });
});

describe('parseLrc: устойчивость', () => {
  it('BOM в начале файла не ломает первую строку', () => {
    const timeline = parseLrc('\uFEFF[00:10.00]Строка');
    expect(timeline.lines[0]?.text).toBe('Строка');
    expect(timeline.lines[0]?.startMs).toBe(10000);
  });

  it('переводы строк CRLF нормализуются', () => {
    const timeline = parseLrc('[00:10.00]Первая\r\n[00:20.00]Вторая');
    expect(timeline.lines.map((line) => line.text)).toEqual(['Первая', 'Вторая']);
  });

  it('пустой текст даёт пустой таймлайн', () => {
    const timeline = parseLrc('');
    expect(timeline.kind).toBe('plain');
    expect(timeline.lines).toHaveLength(0);
  });

  it('строка с таймингом, но без текста, не ломает парсер', () => {
    const timeline = parseLrc('[00:10.00]\n[00:20.00]Текст');
    expect(timeline.lines[0]?.text).toBe('');
    expect(timeline.lines[1]?.text).toBe('Текст');
  });
});
