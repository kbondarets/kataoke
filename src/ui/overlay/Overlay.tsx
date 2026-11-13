import type { ActiveState } from '../../core/sync/sync-engine';
import type { LyricsTimeline } from '../../core/types';

/** Состояние оверлея, которое приходит извне (движок синхронизации). */
export type OverlayStatus = 'idle' | 'loading' | 'ready' | 'not-found' | 'error';

export interface OverlayProps {
  status: OverlayStatus;
  timeline: LyricsTimeline | null;
  active: ActiveState;
  /** Текст ошибки на русском, показывается только при `status: 'error'`. */
  errorMessage?: string;
}

/** Строки вокруг активной: видно контекст, но не весь текст. */
const CONTEXT_LINES = 2;

/**
 * Оверлей караоке.
 *
 * Рендерит только несколько строк вокруг активной — DOM должен оставаться
 * маленьким, иначе страница начинает тормозить.
 */
export function Overlay({ status, timeline, active, errorMessage }: OverlayProps) {
  if (status === 'idle') return null;

  if (status === 'loading') {
    return (
      <div class="kataoke-root">
        <div class="kataoke-note">Ищу текст…</div>
      </div>
    );
  }

  if (status === 'not-found') {
    return (
      <div class="kataoke-root">
        <div class="kataoke-note">Текст для этого трека не найден.</div>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div class="kataoke-root">
        <div class="kataoke-note">{errorMessage ?? 'Не удалось получить текст.'}</div>
      </div>
    );
  }

  if (!timeline || timeline.lines.length === 0) return null;

  // Для plain-текста синхронизации нет: показываем первую строку без подсветки.
  if (timeline.kind === 'plain') {
    const preview = timeline.lines
      .slice(0, CONTEXT_LINES * 3)
      .map((line) => line.text)
      .join('\n');
    return (
      <div class="kataoke-root">
        <div class="kataoke-line is-active">{preview}</div>
      </div>
    );
  }

  const from = Math.max(0, active.lineIndex - CONTEXT_LINES);
  const to = Math.min(timeline.lines.length - 1, active.lineIndex + CONTEXT_LINES);
  const visible = timeline.lines.slice(from, to + 1);

  return (
    <div class="kataoke-root">
      {visible.map((line, offset) => {
        const index = from + offset;
        const isActive = index === active.lineIndex;

        if (!isActive || !line.words || line.words.length === 0) {
          return (
            <div class={`kataoke-line${isActive ? ' is-active' : ''}`} key={index}>
              {line.text}
            </div>
          );
        }

        return (
          <div class="kataoke-line is-active" key={index}>
            {line.words.map((word, wordIndex) => (
              <span
                class={`kataoke-word${wordIndex <= active.wordIndex ? ' is-sung' : ''}`}
                key={wordIndex}
              >
                {word.text}
              </span>
            ))}
          </div>
        );
      })}
    </div>
  );
}
