# Веб-клиент Resonance и награды — дизайн

Дата: 2026-11-14. Источники: ТЗ `voice_training_web_spec_v1.docx`, макеты `design/`, бэкенд `app/`.

## Зачем

Бэкенд API (`/api/v1/*`) готов, макеты — 18 статичных HTML без данных. Для хакатона нужен работающий
сквозной путь на настоящих данных: гостевая сессия → цель → микрофон → 3 записи → анализ → профиль и
план на 14 занятий → ежедневное занятие → прогресс → контрольная проверка. Плюс награды (ноты и
минуты практики), которые есть на макетах, но отсутствуют в API. Приложение устанавливается на
телефон и ПК (PWA), чтобы ежедневные занятия открывались как обычное приложение.

## Цели

- SPA на React с 13 экранами основного пути по макетам `design/screens/`: `Main`, `MicCheck`,
  `MicBlocked`, `Record`, `Analyzing`, `Rerecord`, `Profile`, `Home`, `Exercise`, `Done`, `Progress`,
  `CheckIn`, `Settings`.
- Адаптив как в макетах (брейкпоинты 760 / 1080).
- Установка как PWA: манифест, иконки, service worker для оболочки приложения.
- Награды в API по `design/rewards-api.md` и их показ в чипах, на `Exercise`, `Done`, `Progress`.
- Видимая пометка DEMO_MODE на `CheckIn` и в отчёте проверки (ТЗ, раздел 06).

## Не цели

- Оплата: `Paywall`, `PaySuccess`, `PayCanceled`, `Terms` — отдельная задача.
- Аккаунты, вход, синхронизация. Срок cookie сессии не меняем (сейчас год).
- Офлайн-режим занятий: без сети показываем понятное сообщение, данные и записи не кэшируем.
- Push-уведомления, заморозка серии, бейджи, лидерборды.
- Туннели для проверки на телефоне: телефон проверяем после деплоя на HTTPS.

## Анти-цели

- Экраны с выдуманными цифрами: всё, что на макете пример (даты, значения, «Session 6»), берётся из API;
  недоступная метрика — «Not measured» с причиной, не ноль.
- Ноты за измерения голоса или «улучшения» — только за выполненную практику.
- Двойное начисление при повторе запроса или повторном завершении урока.
- Service worker, который кэширует ответы API или аудио (приватные данные, устаревший прогресс).

## Ограничения

- ТЗ предлагало Jinja2 без сборки; фронт сознательно делаем отдельным SPA. Бэкенд остаётся единым
  Python-проектом.
- Фронт и API на одном origin: cookie гостевой сессии работает без CORS; Safari блокирует cookie
  при разных доменах.
- Все мутации — с `Idempotency-Key` (UUID), сервер его требует.
- getUserMedia и service worker работают только на localhost или HTTPS.
- Лимиты: запись задания оценки 60 с (180 с на три), запись упражнения 90 с, файл 25 МБ;
  форматы — `limits.accepted_audio_types` из `GET /me`.

## Подходы

**Награды**

1. **Считать при чтении из попыток (выбрано).** Ноты — функция от засчитанных (`passed`) попыток:
   первая засчитанная попытка на `plan_item` даёт 2 (E01) или 3 (остальные) + 1, если проверка —
   запись. Повторные попытки того же пункта — 0. Без новых таблиц и миграций; идемпотентность следует
   из модели; удаление гостевых данных удаляет и ноты.
2. Журнал начислений (append-only таблица). Нужен при тратах, откатах или смене правил задним
   числом — сейчас ничего из этого нет. Отложено.

Рядом с наградой отдаём `rules_version: 1`.

**Клиент**

1. **React + Vite + TypeScript (выбрано).** Крупнейшая экосистема; TanStack Query закрывает опрос
   статуса, повторы и инвалидацию; `vite-plugin-pwa` — манифест и service worker.
2. Vue 3 + Vite: ближе к HTML макетов, экосистема меньше.
3. SvelteKit: меньший бандл, самый узкий круг людей и библиотек.
4. Jinja2 + чистый JS (как в ТЗ): отклонено командой.

**Раздача**

1. **nginx со статикой + прокси `/api` в `web` (выбрано).** Один origin, фолбэк на `index.html` для
   прямых ссылок. В разработке то же делает `server.proxy` в Vite.
2. FastAPI отдаёт `dist`: на сервис меньше, но фронт и бэкенд склеены в одном образе.

## Решения

### Бэкенд: награды

- Хелперы в `Service`: `rewards()` → `{notes_total, practice_seconds_total, rules_version}` по всем
  планам гостя; ноты за пункт плана — по правилу выше.
- Минуты практики: по засчитанным первым попыткам — `elapsed_seconds` для `timer`,
  `duration_seconds` записи для `recording`, номинальная длительность упражнения из каталога для
  `self_confirmation` (*наше решение*: у этого типа нет измеренного времени; отличие от
  `rewards-api.md`, который обновляем).
- Поля:
  - `POST /exercise-attempts` → `reward: {notes, parts: [{notes, reason}]}`, `reason` ∈
    `exercise_completed`, `quality_bonus` — бонус показывается отдельной строкой (*наше решение*).
    `notes = 0`, `parts = []` для `needs_retry` и повтора уже засчитанного пункта.
  - `PUT /progress/{lesson_id}` → `session_reward: {notes, practice_seconds}` за урок.
  - `GET /me` → `progress.notes_total`, `progress.practice_seconds_total`.
  - `GET /progress` → `summary.notes_total`, `summary.practice_seconds_total`.
  - `lessons[].items[].notes_available` в `GET /plan` и `GET /today`.
- Тесты в `tests/test_api.py`: начисление, повтор попытки = 0, повтор `PUT /progress` не меняет итог,
  удаление данных обнуляет.
- Обновить `postman/` и `design/rewards-api.md`.

### Фронтенд: структура

- `frontend/` — Vite + React + TypeScript, React Router, TanStack Query. Без UI-китов и Tailwind:
  стили — `tokens.css`, `components.css`, `screens.css` из `design/` (копия в `frontend/src/styles/`),
  шрифты Fredoka и Rubik.
- Типы ответов API пишем вручную в `src/api/types.ts` по схемам бэкенда (*наше решение*: генерация из
  OpenAPI — когда API начнёт часто меняться).
- Маршруты: `/` (Main; если сессия есть и оценка пройдена — на `/today`), `/mic-check`,
  `/record?assessment_id=…`, `/analyzing?job_id=…&assessment_id=…`, `/profile/:assessmentId`,
  `/today`, `/exercise/:planItemId`, `/done/:lessonId`, `/progress`, `/check-in`, `/settings`.
  `MicBlocked` и `Rerecord` — состояния экранов `/mic-check` и `/record`.
- Общий `AppShell`: шапка с навигацией и чипами (серия, ноты, минуты из `GET /me`) на десктопе,
  таббар на телефоне — как в макетах.

### Фронтенд: поведение

- `api.ts`: относительные пути `/api/v1/...`, `credentials: 'same-origin'`, ошибки в форме
  `{code, message}` бэкенда. Для мутаций `Idempotency-Key` создаётся `crypto.randomUUID()` один раз на
  действие и переиспользуется при повторе с тем же телом. TanStack Query повторяет только сетевые и
  5xx ошибки.
- Опрос `GET /jobs/{id}`: `refetchInterval` — функция, возвращает `poll_after_ms` до
  `completed` / `needs_rerecord` / `failed`, затем `false`; в фоне вкладки не опрашивает.
- Запись (`useRecorder`): выбор формата перебором (`audio/webm;codecs=opus`, `audio/webm`,
  `audio/mp4`) с пересечением с `accepted_audio_types`; `start()` в try/catch; расширение по
  фактическому `mimeType`; уровень через `AnalyserNode` (RMS); таймер с автостопом на лимите;
  прослушивание и перезапись; остановка треков после записи.
- Ошибки микрофона: `NotAllowedError` (браузер/ОС — разные подсказки), `NotFoundError`,
  небезопасный контекст (подсказка про HTTPS), таймаут на висящий запрос разрешения → `MicBlocked`.
- Загрузка — скелетоны; ошибка — баннер с действием «Try again».
- `Home` по `daily_status`: `available`, `in_progress`, `completed`, `plan_completed`,
  `needs_assessment`.
- Контрольная проверка идёт тем же путём, что первичная: `CheckIn` → `POST /assessments`
  (`kind: reassessment`, `demo_override` в DEMO_MODE) → `/record` → `/analyzing` →
  `/profile/:id`. Профиль повторной оценки показывает сравнение (`delta`) и метку `Demo`, если
  оценка сделана с `demo_override`.
- Упоминания оплаты и подписки в экранах из объёма (например, текст удаления в `Settings`) убираем.

### PWA

- `vite-plugin-pwa`: манифест (`name: Resonance`, `display: standalone`, цвета из токенов),
  иконки 192/512 и maskable из логотипа (эквалайзер на тёмном круге), `apple-touch-icon` для iOS.
- Service worker кэширует только оболочку (JS, CSS, шрифты, иконки). `/api/*` — всегда сеть,
  `NavigationRoute` исключает `/api`.
- Обновление: `registerType: 'prompt'` — баннер «New version available» с кнопкой перезагрузки, чтобы
  не сменить версию посреди записи (*наше решение*).
- Кнопку «Install app» показываем в `Settings`, где браузер даёт `beforeinstallprompt`; на iOS —
  подсказка «Share → Add to Home Screen».

### Docker и запуск

- Сервис `frontend` в `compose.yaml`: multi-stage — `node` собирает, `nginx` (закреплённая версия)
  отдаёт `dist` и проксирует `/api/` и `/health/` в `web:8000`, фолбэк `try_files … /index.html`,
  `index.html` и `sw.js` без кэша. Наружу публикуется только порт `frontend`.
- Разработка: `npm run dev` с `server.proxy` на `localhost:8000`.
- README: запуск, адрес, как установить приложение.

## Проверка

- `pytest` для наград; `tsc --noEmit` и `vite build` без ошибок.
- Ручной прогон в Chrome (Claude in Chrome) по сценарию ТЗ: новая сессия → запись → анализ →
  профиль → занятие → перезагрузка → прогресс → (DEMO_MODE) проверка; ширины 390 / 820 / 1280.
- Отказ в микрофоне, тихая запись (`needs_rerecord`), нет ключа OpenAI (`failed` с причиной).
- Установка PWA в Chrome на десктопе; Lighthouse PWA-проверка installability.
- Телефоны (Safari iOS, Chrome Android) — после деплоя на HTTPS.

## Оставлено исполнителю

- Разбиение на компоненты и именование.
- Тексты скелетонов и мелкие подписи, не заданные макетом.
- Версии зависимостей (актуальные стабильные, закреплённые в lock-файле).
