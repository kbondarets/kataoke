# AGENTS.md — конвенции разработки kataoke

Правила для ИИ-агентов и людей, работающих в этом репозитории. Источник истины
по продукту — [VISION.md](./VISION.md). Если код противоречит VISION.md,
сначала обновляем VISION.md, потом код.

## Читать в начале

| Файл | Когда |
|---|---|
| `.clinerules/rules.md` | всегда, это 60 секунд |
| `projectRules.md` | всегда, полные правила (агент-ревьювер проверяет против него) |
| `STATE.md` | всегда, чтобы знать, где мы |
| `VISION.md` | §4 при работе с архитектурой, §12 при выборе задачи |
| `agents/<роль>.md` | своя роль |
| `skills/<скилл>/SKILL.md` | перед работой в соответствующей области |

## Роли

- **frontend-architect** (`agents/frontend-architect.md`) — `core`, `adapters`,
  `ui`, `content`, manifest.
- **backend-architect** (`agents/backend-architect.md`) — `providers`, матчинг
  треков, тесты провайдеров, сервер v2.
- **reviewer** (`agents/reviewer.md`) — ревью PR/MR, только чтение,
  `.clinerules/workflows/review.md`.

Автор правки **не ревьюит** себя. Ревью — всегда отдельным агентом.


## Стек

- **TypeScript** (strict), без `any` без явной причины и комментария.
- **Preact** для UI (`preact` + `preact/hooks`), не React.
- **Vite** для сборки, **Manifest V3**.
- Стили: обычный CSS в Shadow DOM (CSS Modules допустимы). Без UI-фреймворков
  и без Tailwind на старте.
- Пакетный менеджер: `npm` (не менять без обсуждения).

## Структура (целевая)

```
src/
  core/                 # ядро: ничего не знает про конкретные сервисы
    sync/               # sync engine: позиция, интерполяция, таймлайн
    lyrics/             # модели LRC/plain/word, парсеры
    types.ts            # общие типы (Seconds, TrackInfo, LyricsResult)
  adapters/
    index.ts            # реестр адаптеров, выбор по URL
    yandex-music/
    youtube/
  providers/
    lrclib/
  ui/
    overlay/            # Shadow DOM оверлей (Preact)
    popup/              # popup расширения
  background/           # service worker
  content/              # content script: bootstrap + адаптер + оверлей
```

## Архитектурные правила (обязательно)

1. **Ядро не знает про сервисы.** Любая привязка к Яндекс Музыке / YouTube живёт
   только в `src/adapters/<service>/`. Ядро работает с `PlayerAdapter`.
2. **Позиция — только из медиа-элемента** (`<video>`/`<audio>.currentTime`).
   Прогресс-бар в DOM — запрещён как источник времени.
3. **Оверлей — только в Shadow DOM.** Никакого протекания стилей в страницу и обратно.
4. **Не блокировать UI ожиданием.** Сначала показываем, что есть, потом улучшаем.
5. **Никаких обходов DRM и модификаций чужого аудио.** См. VISION.md, п. 6.1.
6. **Никаких тяжёлых ML-моделей в клиенте** в MVP. Alignment — серверная задача v2.
7. **Никаких секретов в бандле.** API-ключи/переменные — через `.env` (в `.gitignore`).

## Соглашения по коду

- Имена файлов: `kebab-case.ts`; компоненты Preact — `PascalCase.tsx`.
- Типы — `interface` для объектов, `type` для union/алиасов.
- Время: наружу из адаптеров — **секунды** (`number`), внутри LRC-парсера —
  миллисекунды. Не смешивать; названия переменных обязаны содержать единицу
  (`timeSec`, `offsetMs`).
- Все внешние данные (DOM, ответы API) считаются невалидными до проверки.
- Ошибки вместо «тихих» падений: если адаптер не смог найти плеер — логируем
  причину и показываем состояние «сервис не распознан».

## Проверки перед коммитом

```bash
npm run typecheck   # tsc --noEmit
npm run lint        # eslint
npm run build       # сборка расширения
```

## Коммиты

- Формат: `<scope>: <что сделано>` — например `adapters/yandex-music: extract currentTime from media element`.
- Не коммитить `dist/`, `node_modules/`, `.env`.
