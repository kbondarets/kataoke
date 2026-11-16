# kataoke

Караоке-тексты песен поверх любого музыкального сервиса в браузере.

> Рабочее название. Нормальное придумаем позже (идеи — в [VISION.md](./VISION.md#13-нейминг-идеи-ничего-не-финализируем)).

## Что это

Расширение для браузера (Chrome/Edge/Firefox, Manifest V3), которое показывает
синхронизированный с воспроизведением текст песни поверх плеера:
Яндекс Музыка, YouTube, (далее) Spotify, YouTube Music.

Боль: слышишь трек, хочешь подпеть — текста нет, он не тот, или он «где-то в гугле».
Нужен текст здесь и сейчас, строкой под текущий фрагмент.

## Статус

**Замысел зафиксирован, скелет собран, ядро покрыто тестами.**
`npm run check` зелёный: типы, 85 тестов, сборка расширения.

- 📄 Замысел, архитектура, решения, план по этапам: **[VISION.md](./VISION.md)**
- 📄 Правила проекта: **[projectRules.md](./projectRules.md)** (кратко — [.clinerules/rules.md](./.clinerules/rules.md))
- 📄 Состояние и решения: **[STATE.md](./STATE.md)**
- 📄 Конвенции кода: **[AGENTS.md](./AGENTS.md)**

### Агенты и скиллы

| Агент | Задача |
|---|---|
| [frontend-architect](./agents/frontend-architect.md) | core, адаптеры, UI оверлея, content script |
| [backend-architect](./agents/backend-architect.md) | провайдеры текстов, матчинг, тесты провайдеров, сервер v2 |
| [reviewer](./agents/reviewer.md) | ревью PR/MR, только чтение, вердикт по шаблону |

| Скилл | Когда |
|---|---|
| [lrc-parsing](./skills/lrc-parsing/SKILL.md) | разбор LRC (строка и слово) |
| [media-sync](./skills/media-sync/SKILL.md) | синхронизация с медиа-элементом |
| [shadow-dom-overlay](./skills/shadow-dom-overlay/SKILL.md) | оверлей в Shadow DOM |
| [player-adapter](./skills/player-adapter/SKILL.md) | адаптер музыкального сервиса |
| [lyrics-provider](./skills/lyrics-provider/SKILL.md) | источник текстов, LRCLIB, кеш |
| [mv3-extension](./skills/mv3-extension/SKILL.md) | Manifest V3, permissions, service worker |
| [pr-review](./skills/pr-review/SKILL.md) | процедура ревью PR |

Процедуры: [разработка](./.clinerules/workflows/feature.md) · [ревью](./.clinerules/workflows/review.md)


## Как запустить

```bash
npm install
npm run build     # собирает dist/ — готовое расширение
npm run check     # типы + тесты + сборка
```

Загрузка в браузер:

1. Открыть `chrome://extensions`.
2. Включить «Режим разработчика».
3. «Загрузить распакованное» → выбрать папку `dist/`.
4. Открыть `music.yandex.ru`, включить трек.

## Структура

```
src/core/        sync engine, парсер LRC, матчинг и транслит — без DOM и без сети
src/adapters/    Яндекс Музыка, YouTube — здесь и только здесь живут селекторы
src/providers/   LRCLIB — сеть, таймауты, валидация ответа
src/ui/          оверлей в Shadow DOM (Preact)
src/background/  service worker
src/content/     сборка всего вместе
tests/           104 теста на ядро, адаптеры и провайдеры
```

## Ключевые решения (кратко)

| Вопрос | Решение |
|---|---|
| Платформа | Расширение браузера (MV3) |
| Основной сервис для MVP | Яндекс Музыка (+ YouTube для проверки ядра) |
| Стек | TypeScript + Preact + Vite |
| Тексты в MVP | LRCLIB (бесплатный API) |
| Сервер в MVP | Не нужен (0 ₽) |
| Нейросети в MVP | Не нужны (forced alignment — это v2) |
| Приглушение вокала | Вне скоупа (DRM + юридические риски) |
| Аудитория | Русскоязычная для валидации, глобальная для монетизации |

## Следующий шаг

Скелет расширения: MV3 + адаптер Яндекс Музыки + оверлей в Shadow DOM +
LRCLIB + sync engine. Подробности — раздел 12 в [VISION.md](./VISION.md).
