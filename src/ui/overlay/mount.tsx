import { render } from 'preact';
import type { ActiveState } from '../../core/sync/sync-engine';
import type { LyricsTimeline } from '../../core/types';
import { OVERLAY_CSS } from './overlay-css';
import { Overlay } from './Overlay';
import type { OverlayStatus } from './Overlay';

/**
 * Монтирование оверлея в Shadow DOM.
 *
 * Изоляция обязательна: CSS сайта не должен ломать наш вид, а наш — страницу.
 * Монтируем в `document.documentElement`, потому что `position: fixed` внутри
 * трансформированного предка ведёт себя как `absolute`.
 */

const HOST_ID = 'kataoke-root';

export interface OverlayController {
  update(props: {
    status: OverlayStatus;
    timeline: LyricsTimeline | null;
    active: ActiveState;
    errorMessage?: string;
  }): void;
  destroy(): void;
}

export function mountOverlay(): OverlayController {
  // Повторная инъекция content script не должна создавать второй оверлей.
  document.getElementById(HOST_ID)?.remove();

  const host = document.createElement('div');
  host.id = HOST_ID;
  const shadow = host.attachShadow({ mode: 'open' });

  const style = document.createElement('style');
  style.textContent = OVERLAY_CSS;
  shadow.appendChild(style);

  const container = document.createElement('div');
  shadow.appendChild(container);

  document.documentElement.appendChild(host);

  return {
    update(props) {
      render(
        <Overlay
          status={props.status}
          timeline={props.timeline}
          active={props.active}
          {...(props.errorMessage !== undefined ? { errorMessage: props.errorMessage } : {})}
        />,
        container,
      );
    },
    destroy() {
      render(null, container);
      host.remove();
    },
  };
}
