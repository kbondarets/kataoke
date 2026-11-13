import type { LyricsTimeline, TimedLine } from '../types';
import {
  META_TAG,
  OFFSET_TAG,
  collectLeadingTimestamps,
  findOffsetMs,
  hasLineTag,
  parseWords,
  stripWordTags,
} from './lrc-tags';

/**
 * Парсер LRC.
 *
 * Понимает три формата:
 * - plain-текст без таймингов → `kind: 'plain'`, тайминги не выдумываются;
 * - построчный LRC `[mm:ss.xx]текст` → `kind: 'line'`;
 * - k-word LRC `[mm:ss.xx]слово <mm:ss.xx>слово` → `kind: 'word'`.
 *
 * Все времена — в миллисекундах. `[offset:N]` применяется один раз, здесь же,
 * чтобы движок не прибавлял смещение повторно.
 */
export function parseLrc(raw: string): LyricsTimeline {
  // BOM и переводы строк ломают первую строку чаще всего.
  const normalized = raw.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const offsetMs = findOffsetMs(normalized);

  const collected: TimedLine[] = [];
  let hasAnyTiming = false;
  let hasAnyWordTiming = false;

  for (const sourceLine of normalized.split('\n')) {
    const trimmed = sourceLine.trim();

    if (trimmed === '') {
      if (collected.length > 0) {
        collected.push({ text: '', startMs: 0, endMs: 0 });
      }
      continue;
    }

    if (OFFSET_TAG.test(trimmed)) continue;

    // `[ar:]`, `[ti:]`, `[al:]` — метаданные, а не строки текста.
    if (META_TAG.test(trimmed) && !hasLineTag(trimmed)) continue;

    const { timestamps, rest } = collectLeadingTimestamps(sourceLine);

    if (timestamps.length === 0) {
      const words = parseWords(sourceLine);
      if (words) {
        hasAnyWordTiming = true;
        collected.push({
          text: stripWordTags(sourceLine).trim(),
          startMs: words[0]?.startMs ?? 0,
          words,
        });
      } else {
        collected.push({ text: trimmed, startMs: 0 });
      }
      continue;
    }

    hasAnyTiming = true;
    const words = parseWords(rest);
    if (words) hasAnyWordTiming = true;

    const text = words ? stripWordTags(rest).trim() : rest.trim();

    for (const rawStart of timestamps) {
      const startMs = Math.max(0, rawStart + offsetMs);
      collected.push({
        text,
        startMs,
        ...(words
          ? {
              words: words.map((word) => ({
                ...word,
                startMs: Math.max(0, word.startMs + offsetMs),
                ...(word.endMs !== undefined
                  ? { endMs: Math.max(0, word.endMs + offsetMs) }
                  : {}),
              })),
            }
          : {}),
      });
    }
  }

  if (!hasAnyTiming && !hasAnyWordTiming) {
    // Для plain-текста пустые строки — разделители куплетов: их надо сохранить
    // внутри текста, но не тащить пустоту в начало и в конец.
    const lines = collected.map((line) => ({ text: line.text, startMs: 0 }));
    while (lines.length > 0 && lines[0]?.text === '') lines.shift();
    while (lines.length > 0 && lines[lines.length - 1]?.text === '') lines.pop();
    return { kind: 'plain', lines };
  }

  // Несколько меток перед одной строкой и «странные» файлы могут дать
  // неотсортированный результат — сортируем стабильно.
  const sorted = collected
    .map((line, index) => ({ line, index }))
    .sort((a, b) => a.line.startMs - b.line.startMs || a.index - b.index)
    .map(({ line }) => line);

  // Конец строки = начало следующей. У последней строки конца нет: его знает
  // движок, у которого есть длительность трека.
  for (let i = 0; i < sorted.length - 1; i += 1) {
    const line = sorted[i];
    const next = sorted[i + 1];
    if (line && next && line.endMs === undefined) line.endMs = next.startMs;
  }

  return { kind: hasAnyWordTiming ? 'word' : 'line', lines: sorted };
}
