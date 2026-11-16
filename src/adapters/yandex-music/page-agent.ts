/**
 * Агент страницы — исполняется в **MAIN-мире** страницы, а не в изолированном.
 *
 * Зачем отдельный файл: современный плеер Яндекс Музыки держит медиа-элемент
 * вне DOM (`new Audio()` без вставки в документ). Из изолированного мира такой
 * элемент не виден: `document.querySelectorAll('audio, video')` возвращает 0, а
 * `navigator.mediaSession.metadata` пуст. Оба факта проверены на живой странице.
 *
 * Здесь мы находимся в мире страницы, поэтому:
 * - перехватываем `HTMLMediaElement.prototype.play` и получаем сам элемент,
 *   даже если он никогда не попадал в DOM;
 * - читаем `navigator.mediaSession.metadata` так, как его видит страница.
 *
 * Отдаём данные через `window.postMessage`: у MAIN-мира нет доступа к
 * `chrome.runtime`, а у изолированного мира нет доступа к объектам страницы.
 * Только `postMessage` является их общей точкой.
 */

/** Префикс сообщений: изолированный мир фильтрует поток по нему. */
const NAMESPACE = 'kataoke-page';

/** Как часто отправлять снимок состояния, мс. */
const POLL_MS = 250;

/** События медиа-элемента, которые стоит пробрасывать немедленно. */
const MEDIA_EVENTS = [
  'play',
  'pause',
  'seeked',
  'ratechange',
  'ended',
  'loadedmetadata',
  'durationchange',
] as const;

/** Снимок состояния плеера. Все поля примитивные — сообщение клонируется. */
interface MediaSnapshot {
  title: string;
  artist: string;
  album: string;
  durationSec: number;
  positionSec: number;
  paused: boolean;
  playbackRate: number;
  hasMedia: boolean;
}

let media: HTMLMediaElement | null = null;

/** Уже подписанные элементы: повторная подписка дублировала бы события. */
const bound = new WeakSet<HTMLMediaElement>();

/** Медиа-элемент из DOM — на случай, если `play()` перехватить не удалось. */
function findDomMedia(): HTMLMediaElement | null {
  let fallback: HTMLMediaElement | null = null;
  for (const node of document.querySelectorAll('audio, video')) {
    if (!(node instanceof HTMLMediaElement)) continue;
    if (!node.paused) return node;
    fallback ??= node;
  }
  return fallback;
}

function snapshot(): MediaSnapshot {
  const element = media ?? findDomMedia();
  const metadata = navigator.mediaSession?.metadata ?? null;
  const duration = element?.duration;
  const knownDuration = typeof duration === 'number' && Number.isFinite(duration) && duration > 0;

  return {
    title: metadata?.title ?? '',
    artist: metadata?.artist ?? '',
    album: metadata?.album ?? '',
    // `Infinity` у MSE-плеера означает «поток ещё не досчитан», а не длительность.
    durationSec: knownDuration ? duration : 0,
    positionSec: element ? element.currentTime : 0,
    paused: element ? element.paused : true,
    playbackRate: element ? element.playbackRate : 1,
    hasMedia: element !== null,
  };
}

function post(payload: Record<string, unknown>): void {
  window.postMessage({ source: NAMESPACE, ...payload }, '*');
}

function postState(): void {
  post({ kind: 'state', state: snapshot() });
}

/** Запоминает элемент и подписывается на его события ровно один раз. */
function bind(element: HTMLMediaElement): void {
  media = element;
  if (bound.has(element)) return;
  bound.add(element);

  for (const name of MEDIA_EVENTS) {
    element.addEventListener(name, () => {
      post({ kind: 'event', name });
      postState();
    });
  }

  postState();
}

/**
 * Перехват `play()`.
 *
 * Именно `play` — единственное событие, которое проходит любой плеер: элемент
 * может быть создан как угодно, но воспроизведение всегда начинается с него.
 * Патчим прототип, поэтому перехват работает и для уже созданных элементов.
 */
function patchPlay(): void {
  const prototype = HTMLMediaElement.prototype;
  const original = prototype.play;

  prototype.play = function patchedPlay(this: HTMLMediaElement): Promise<void> {
    bind(this);
    return original.call(this);
  };
}

function start(): void {
  patchPlay();
  console.info('[kataoke:agent] запущен в мире страницы');
  setInterval(() => {
    const found = media ?? findDomMedia();
    if (found && found !== media) bind(found);
    postState();
  }, POLL_MS);
}

start();