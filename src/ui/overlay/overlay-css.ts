/**
 * Стили оверлея.
 *
 * Живут строкой, а не отдельным CSS-файлом: так стили гарантированно попадают в
 * Shadow DOM и не зависят от того, как страница их подгрузит.
 *
 * Наследуемые свойства (цвет, шрифт, размер) задаются явно — иначе они
 * «протекают» из страницы внутрь shadow root.
 */
export const OVERLAY_CSS = `
:host {
  all: initial;
}

.kataoke-root {
  --kataoke-bg: rgba(18, 18, 20, 0.86);
  --kataoke-fg: #f5f5f7;
  --kataoke-muted: rgba(245, 245, 247, 0.55);
  --kataoke-active: #ffd60a;
  --kataoke-radius: 14px;

  position: fixed;
  left: 50%;
  bottom: 96px;
  transform: translateX(-50%);
  max-width: min(760px, calc(100vw - 48px));
  box-sizing: border-box;
  padding: 14px 20px;
  border-radius: var(--kataoke-radius);
  background: var(--kataoke-bg);
  color: var(--kataoke-fg);
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif;
  font-size: 20px;
  line-height: 1.45;
  text-align: center;
  pointer-events: none;
  z-index: 2147483000;
  backdrop-filter: blur(8px);
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.35);
}

.kataoke-line {
  white-space: pre-wrap;
  opacity: 0.45;
  transition: opacity 120ms ease;
}

.kataoke-line.is-active {
  opacity: 1;
  font-weight: 600;
}

.kataoke-word {
  transition: color 80ms linear;
}

.kataoke-word.is-sung {
  color: var(--kataoke-active);
}

.kataoke-note {
  color: var(--kataoke-muted);
  font-size: 15px;
}
`;
