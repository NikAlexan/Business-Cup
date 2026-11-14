# Веб-клиент Resonance и награды — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Сквозной путь гостя на настоящих данных в установимом SPA (13 экранов) плюс награды — ноты и минуты практики — в API.

**Architecture:** Награды записываются в документ попытки в момент засчёта и суммируются при чтении. Новых таблиц нет: удаление гостя удаляет и награды, а повтор по `Idempotency-Key` возвращает сохранённый ответ. Фронт — отдельный Vite-проект `frontend/`. В проде nginx отдаёт `dist` и проксирует `/api` в `web` (один origin), в разработке то же делает Vite-proxy.

**Tech Stack:** FastAPI/pytest (есть). Node 26, Vite, React, TypeScript, React Router, TanStack Query, vite-plugin-pwa, Vitest (только чистые функции), nginx.

**Spec:** `docs/superpowers/specs/2026-11-14-web-client-design.md`. Экраны → эндпоинты: `design/api-mapping.md`. Макеты: `design/screens/*.html`.

## Global Constraints

- Ветка `feat/web-client`, коммиты после каждой задачи.
- Ноты начисляются только за засчитанную (`passed`) практику: 2 за E01, 3 за остальные, +1 `quality_bonus`, если тип проверки `recording`. `rules_version: 1`.
- Минуты практики берутся из `elapsed_seconds` (timer), `duration_seconds` записи (recording) или `duration_seconds` упражнения из каталога (self_confirmation).
- На экранах нет выдуманных цифр. Недоступная метрика показывается как «Not measured» с причиной, а не как 0.
- Все мутации идут с `Idempotency-Key`: `crypto.randomUUID()` один раз на действие, тот же ключ при повторе с тем же телом.
- Запросы: относительные `/api/v1/...`, `credentials: 'same-origin'`. Ошибка разбирается в форму `{code, message}`.
- TanStack Query повторяет только сетевые ошибки и 5xx.
- Лимиты записи: 60 с на задание оценки, 90 с на упражнение. Форматы — пересечение с `limits.accepted_audio_types` из `GET /me`.
- Service worker кэширует только оболочку. `/api/*` всегда идёт в сеть, `registerType: 'prompt'`.
- Стили только из `design/` (копии в `frontend/src/styles/`), шрифты Fredoka и Rubik. Без Tailwind и UI-китов.
- Брейкпоинты 760 / 1080. Проверочные ширины 390 / 820 / 1280.
- Оплаты нет: экраны `Paywall`/`PaySuccess`/`PayCanceled`/`Terms` не делаем, упоминания подписки убираем.
- Зависимости npm — актуальные стабильные, закреплены в `package-lock.json`. Образ nginx — с точной версией.

## Review Focus

1. Двойной клик по «Finish», «Submit» или «Complete». Ожидается один запрос: кнопка неактивна, пока мутация идёт, повтор после сетевой ошибки отправляет тот же ключ. Тест — Task 3, `api.test.ts`.
2. Перезагрузка или прямая ссылка на `/analyzing`, `/record`, `/exercise/:id`. Экран восстанавливается по URL и API, без состояния в памяти. Ручная проверка — Task 9, шаг 3.
3. Нет cookie сессии (новый браузер, удалённые данные) на любой странице, кроме `/`. Ответ 401 уводит на `/`, а не показывает пустой экран. Тест — Task 3, `api.test.ts`.
4. Запись дошла до лимита. Она останавливается сама и остаётся доступной для прослушивания и отправки, а не теряется. Тест — Task 4, `recorder.test.ts` (`limitFor`), и ручная проверка в Task 9.
5. 409 `daily_lesson_limit`, `lesson_locked`, `plan_item_already_completed`. Пользователь видит понятный текст из `message` и следующий шаг, а не «Something went wrong». Тест — Task 2, pytest на поля ответа, и ручная проверка в Task 9.

---

### Task 1: Награды в API

**Files:**
- Modify: `app/service.py` (`attempt` ~496, `completion_view` ~613, `me` ~186, `progress` ~697, `unlock` ~162, `today` ~570)
- Test: `tests/test_api.py`

**Interfaces:**
- Produces:
  - `notes_for(item: dict) -> int` (модульная функция в `app/service.py`)
  - `Service.rewards() -> {"notes_total": int, "practice_seconds_total": int, "rules_version": 1}`
  - Поля попытки: `reward: {"notes": int, "parts": [{"notes": int, "reason": "exercise_completed" | "quality_bonus"}]}` и `practice_seconds: int`
  - `PUT /progress/{id}` → `session_reward: {"notes": int, "practice_seconds": int}`
  - `GET /me` → `progress.notes_total`, `progress.practice_seconds_total`
  - `GET /progress` → `summary.notes_total`, `summary.practice_seconds_total`
  - `lessons[].items[].notes_available: int` в `GET /plan`, `GET /plans/{id}`, `GET /today`

- [ ] **Step 1: Написать падающий тест `test_rewards_follow_completed_practice`**

Тест строится по образцу `test_full_flow_plan_attempts_streak_and_reassessment` и использует его хелперы.

```python
def test_rewards_follow_completed_practice(client, worker, speech_file):
    guest(client)
    complete_assessment(client, worker, speech_file)
    lesson = client.get("/api/v1/today").json()["lesson"]
    expected = {i["id"]: (2 if i["exercise_id"] == "E01" else 3)
                + (i["task"]["verification"]["type"] == "recording") for i in lesson["items"]}
    assert {i["id"]: i["notes_available"] for i in lesson["items"]} == expected
    assert client.get("/api/v1/plan").json()["lessons"][0]["items"][0]["notes_available"] == 2

    warmup = lesson["items"][0]
    short = post(client, "/exercise-attempts", {"plan_item_id": warmup["id"], "elapsed_seconds": 1}).json()
    assert short["reward"] == {"notes": 0, "parts": []} and short["practice_seconds"] == 0

    key = str(uuid4())
    for item in lesson["items"]:
        # тот же цикл, что в test_full_flow; для первого пункта сохранить key
        ...
    first = post(client, "/exercise-attempts", {"plan_item_id": warmup["id"], "elapsed_seconds": 60}, key=key)
    # повтор с тем же ключом отдаёт тот же ответ
    assert post(client, "/exercise-attempts", {"plan_item_id": warmup["id"], "elapsed_seconds": 60}, key=key).json() == first.json()
    assert first.json()["reward"] == {"notes": 2, "parts": [{"notes": 2, "reason": "exercise_completed"}]}
    recorded = <ответ попытки пункта с type == "recording">
    assert recorded["reward"]["parts"] == [{"notes": 3, "reason": "exercise_completed"},
                                           {"notes": 1, "reason": "quality_bonus"}]

    done = client.put("/api/v1/progress/" + lesson["id"], json={"status": "completed"}).json()
    assert done["session_reward"]["notes"] == sum(expected.values())
    assert done["session_reward"]["practice_seconds"] > 60
    again = client.put("/api/v1/progress/" + lesson["id"], json={"status": "completed"}).json()
    assert again["session_reward"] == done["session_reward"]
    me = client.get("/api/v1/me").json()["progress"]
    assert me["notes_total"] == sum(expected.values())
    assert me["practice_seconds_total"] == done["session_reward"]["practice_seconds"]
    assert client.get("/api/v1/progress").json()["summary"]["notes_total"] == me["notes_total"]

    assert client.delete("/api/v1/guest-data").status_code == 204
    guest(client)
    assert client.get("/api/v1/me").json()["progress"]["notes_total"] == 0
```

Псевдокод в `...` и `<...>` заменить на цикл из `test_full_flow_...`. E01 засчитывается вызовом с `key`, остальные пункты — как в образце.

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

Run: `pytest tests/test_api.py::test_rewards_follow_completed_practice -v`
Expected: FAIL, `KeyError: 'notes_available'`.

- [ ] **Step 3: Реализовать**

- `notes_for(item)` = `(2 if item["exercise_id"] == "E01" else 3) + (1 if item["task"]["verification"]["type"] == "recording" else 0)`.
- В `attempt()`, при `passed`, записать в `a`:
  - `reward`: части `exercise_completed` (2 или 3) и, для recording, `quality_bonus` (1);
  - `practice_seconds`: `elapsed_seconds`, `round(rec["duration_seconds"])` или `EXERCISES[item["exercise_id"]]["duration_seconds"]` по типу проверки.
  
  Если не засчитано: `reward = {"notes": 0, "parts": []}`, `practice_seconds = 0`.
- `rewards()` суммирует `reward.notes` и `practice_seconds` по `self.all("attempt")`, у которых `status == "passed"`. Старые попытки без полей считаются через `.get(..., 0)`.
- `completion_view` берёт `session_reward` из засчитанных попыток, чьи `plan_item_id` входят в `lesson["items"]`.
- `unlock(p)` проставляет `notes_available` всем пунктам всех уроков. `today()` делает то же для `done`-урока из другого плана.
- `me()`/`progress()`: добавить `notes_total`, `practice_seconds_total` из `rewards()`.

- [ ] **Step 4: Запустить весь набор тестов**

Run: `pytest -q`
Expected: все PASS, включая старые.

- [ ] **Step 5: Обновить документацию и Postman**

- `design/rewards-api.md`:
  - `reward` теперь в виде `{notes, parts}`;
  - минуты для self_confirmation берутся из каталога;
  - есть `rules_version`.
- `design/api-mapping.md`: убрать пункт «Ноты — в API их пока нет».
- `postman/Voice-Training.postman_collection.json`: в примерах ответов `exercise-attempts`, `progress/{id}`, `me`, `progress` добавить новые поля.

- [ ] **Step 6: Commit** — `feat: add practice rewards (notes, practice seconds) to API`

---

### Task 2: Тексты ошибок для пользователя

**Files:**
- Test: `tests/test_api.py`

Убедиться, что на 409 бэкенд отдаёт `message` и `details`, которые фронт показывает как есть (Review Focus 5).

- [ ] **Step 1: Написать тест `test_conflicts_carry_user_message`**

Сценарий: после завершения урока в тот же день попытка следующего урока даёт 409 `lesson_locked`, повтор засчитанного пункта — 409 `plan_item_already_completed`. Проверить `body["error"]["code"]` и непустой `message`. Форму ошибки сверить с `error_response` в `app/main.py:49`.

- [ ] **Step 2: Запустить**

Run: `pytest tests/test_api.py::test_conflicts_carry_user_message -v`
Expected: PASS без изменений кода. Если упало — исправить сообщение в `app/service.py`.

- [ ] **Step 3: Commit** — `test: pin conflict error messages used by the web client`

---

### Task 3: Каркас фронта, API-клиент, оболочка

**Files:**
- Create:
  - `frontend/package.json`, `vite.config.ts`, `tsconfig.json`, `index.html`, `.gitignore`
  - `frontend/src/main.tsx`, `src/App.tsx` (маршруты)
  - `frontend/src/api/api.ts`, `src/api/types.ts`, `src/api/hooks.ts`
  - `frontend/src/api/api.test.ts`
  - `frontend/src/components/AppShell.tsx`, `ErrorBanner.tsx`, `Skeleton.tsx`
  - `frontend/src/lib/format.ts`, `src/lib/format.test.ts`
  - `frontend/src/styles/` — копии `design/design-system/tokens.css`, `components.css` и `design/screens/screens.css`
- Modify: `.gitignore` (`frontend/node_modules`, `frontend/dist`)

**Interfaces:**
- Produces:
  - `class ApiError extends Error { status: number; code: string; details?: unknown }`
  - `request<T>(path: string, init?: {method?, body?, form?: FormData, idempotencyKey?: string}) -> Promise<T>`. `path` указывается без `/api/v1`. При 401 бросает `ApiError` с `code: 'unauthorized'`.
  - `useMutationWithKey<TVars, TRes>(fn: (vars: TVars, key: string) => Promise<TRes>)` — обёртка над `useMutation`. Ключ создаётся при первом `mutate`, переиспользуется при повторе с тем же телом (сравнение через `JSON.stringify`), сбрасывается после успеха.
  - `queryRetry(failureCount: number, error: unknown) -> boolean` — `true` только для `TypeError` (сеть) и `status >= 500`, и не больше 2 раз.
  - Хуки (`hooks.ts`), все через TanStack Query:
    - `useMe()`
    - `useToday()`
    - `usePlan()`
    - `useProgress()`
    - `useAssessment(id)`
    - `useExercise(id)`
    - `useJob(id)`
  - Типы в `types.ts`: `Me`, `Today`, `Plan`, `Lesson`, `PlanItem`, `Assessment`, `Job`, `Attempt`, `Reward`, `Completion`, `Progress`, `Measurement`. Поля сверять с ответами `app/service.py` и `tests/test_api.py`.
  - `formatMinutes(seconds: number) -> string` (`0` → `"0 min"`, `125` → `"2 min"`), `formatDate(iso: string, timezone: string) -> string`.
  - `<AppShell>`:
    - на десктопе шапка с навигацией и чипами (серия, ноты, минуты из `useMe()`);
    - ниже 760 — таббар `rs-tabs`;
    - при 401 из `useMe()` — `navigate('/')`.

- [ ] **Step 1: Создать проект**

Run: `npm create vite@latest frontend -- --template react-ts`, затем `npm i react-router-dom @tanstack/react-query` и `npm i -D vitest vite-plugin-pwa`.

`vite.config.ts`: `server.proxy` для `/api` и `/health` на `http://localhost:8000`. Шаблонные демо-файлы Vite удалить.

- [ ] **Step 2: Написать падающие тесты**

`api.test.ts`, с подменой `globalThis.fetch`:
- `request` бросает `ApiError` с `code` и `message` из тела ошибки бэкенда;
- 401 даёт `code === 'unauthorized'`;
- `queryRetry(0, new ApiError(409, …)) === false`, `queryRetry(0, new ApiError(503, …)) === true`, `queryRetry(2, new TypeError()) === false`;
- `useMutationWithKey`: ключ переиспользуется после ошибки с тем же телом. Логику ключа вынести в чистую функцию `nextKey(prev: {key, body} | null, body: unknown) -> {key, body}` и тестировать её.

`format.test.ts`: примеры из Interfaces.

- [ ] **Step 3: Запустить тесты и убедиться, что они падают**

Run: `cd frontend && npx vitest run`
Expected: FAIL, модули не найдены.

- [ ] **Step 4: Реализовать `api.ts`, `format.ts`, `types.ts`, `hooks.ts`, `AppShell`, маршруты-заглушки всех экранов из спеки**

- [ ] **Step 5: Проверить**

Run: `npx vitest run && npx tsc --noEmit && npx vite build`
Expected: всё зелёное. На `npm run dev` при запущенном бэкенде `/` открывается со стилями дизайна.

- [ ] **Step 6: Commit** — `feat(frontend): scaffold SPA with API client and app shell`

---

### Task 4: Онбординг — Main, MicCheck, Record, Analyzing, Profile

**Files:**
- Create:
  - `frontend/src/lib/recorder.ts`, `src/lib/recorder.test.ts`
  - `frontend/src/screens/Main.tsx`, `MicCheck.tsx`, `Record.tsx`, `Analyzing.tsx`, `Profile.tsx`
  - `frontend/src/components/LevelMeter.tsx`, `MetricTile.tsx`

**Interfaces:**
- Consumes (Task 3): `request`, `useMutationWithKey`, `useMe`, `useAssessment`, `useJob`, `AppShell`, `ErrorBanner`.
- Produces:
  - `pickMimeType(accepted: string[], isSupported: (t: string) => boolean) -> string | null`. Перебирает `audio/webm;codecs=opus`, `audio/webm`, `audio/mp4`. Сравнивает без параметров `;codecs=`.
  - `extensionFor(mime: string) -> 'webm' | 'm4a'`
  - `micErrorKind(e: unknown, secure: boolean) -> 'denied' | 'not_found' | 'insecure' | 'timeout' | 'unknown'`
  - `jobPollInterval(job: Job | undefined) -> number | false`. Возвращает `poll_after_ms`, пока статус не `completed`, `needs_rerecord` или `failed`.
  - `limitFor(purpose: 'assessment' | 'exercise') -> 60 | 90`
  - `useRecorder({maxSeconds, accepted}) -> {state: 'idle' | 'recording' | 'recorded', level: number, seconds: number, blob: Blob | null, url: string | null, mime: string | null, error: MicErrorKind | null, start(), stop(), reset()}`. Устроен так:
    - `start()` в try/catch;
    - уровень — RMS через `AnalyserNode`;
    - автостоп на `maxSeconds`;
    - после записи треки останавливаются;
    - `url` создаётся через `URL.createObjectURL` и освобождается в `reset`/unmount.
  - `uploadRecording(fields: Record<string, string>, blob: Blob, mime: string) -> Promise<{recording, job_id, poll_after_ms}>` — multipart `POST /recordings`.

- [ ] **Step 1: Написать падающие тесты для `recorder.test.ts`**

- `pickMimeType(['audio/webm','audio/mp4'], t => t !== 'audio/webm;codecs=opus' && t !== 'audio/webm') === 'audio/mp4'`
- `pickMimeType(['audio/wav'], () => true) === null`
- `micErrorKind(new DOMException('', 'NotAllowedError'), true) === 'denied'`, `micErrorKind(any, false) === 'insecure'`
- `jobPollInterval({status:'processing', poll_after_ms: 2000}) === 2000`, `jobPollInterval({status:'failed'}) === false`
- `limitFor('exercise') === 90`

- [ ] **Step 2: Запустить**

Run: `npx vitest run src/lib/recorder.test.ts`
Expected: FAIL.

- [ ] **Step 3: Реализовать `recorder.ts`, затем экраны по макетам**

Экраны строятся по `design/screens/Main.html`, `MicCheck.html`, `MicBlocked.html`, `Record.html`, `Rerecord.html`, `Analyzing.html`, `Profile.html`.

- **Main** — `POST /guest-session`:
  - `goal`, `timezone` из `Intl.DateTimeFormat().resolvedOptions().timeZone`, `consent: {audio_processing: true, policy_version: "2026-11-14"}`;
  - без согласия кнопка неактивна;
  - если у `useMe()` `onboarding_status === 'ready'`, перейти на `/today`; если `assessment_in_progress` — на `/record?assessment_id=active_assessment_id`.
- **MicCheck**:
  - запуск `getUserMedia` с таймаутом 10 с;
  - ошибка показывает состояние MicBlocked с подсказкой по `micErrorKind`;
  - пользователь выбирает `distance_cm` и `environment` (`quiet_room` / `some_noise` / `noisy` / `unknown`);
  - затем `POST /assessments` (`kind: initial`) и переход на `/record?assessment_id=`.
  
  При `?kind=reassessment&demo=1` (переход из CheckIn) уходит `kind: reassessment, demo_override: true`. При 409 `assessment_in_progress` перейти по `details.assessment_id`.
- **Record**:
  - задачи из `useAssessment`, текущая — первая без `quality_status === 'accepted'`;
  - запись, прослушивание, перезапись, затем `uploadRecording` и опрос `useJob`;
  - `needs_rerecord` — состояние Rerecord с причинами из `quality.issues`;
  - когда все задачи `accepted`: `POST /assessments/{id}/submit` и переход на `/analyzing?job_id=&assessment_id=`.
- **Analyzing**:
  - `useJob` с `refetchInterval: q => jobPollInterval(q.state.data)` и `refetchIntervalInBackground: false`;
  - `completed` ведёт на `/profile/:id`;
  - `failed` показывает баннер с `error.message` и «Try again» (`POST /jobs/{id}/retry`).
- **Profile**:
  - метрики из `measurements`;
  - при `available: false` — «Not measured» и `reason`;
  - `summary`, `observations`, до 2 `priorities`;
  - CTA «Start day 1» ведёт на `/today`.
  
  Если `kind === 'reassessment'`, рядом с метриками показать `comparison`/`delta`, а при `demo_override_used` — бейдж `Demo`.

- [ ] **Step 4: Проверить**

Run: `npx vitest run && npx tsc --noEmit`
Expected: PASS. Вручную на `npm run dev`: новая сессия → три записи → анализ → профиль (без OpenAI-ключа будет `failed` с причиной — это ожидаемо).

- [ ] **Step 5: Commit** — `feat(frontend): onboarding flow from goal to voice profile`

---

### Task 5: Ежедневное занятие — Home, Exercise, Done

**Files:**
- Create: `frontend/src/screens/Home.tsx`, `Exercise.tsx`, `Done.tsx`, `frontend/src/components/PlanWave.tsx`, `RewardChips.tsx`

**Interfaces:**
- Consumes: `useToday`, `usePlan`, `useMe`, `useExercise`, `useRecorder`, `uploadRecording`, `useJob`, `useMutationWithKey`, `formatMinutes`.
- Produces: `<RewardChips streak notes seconds />`. Используют AppShell (Task 3) и Progress (Task 6).

- [ ] **Step 1: Home по `daily_status`** (макет `Home.html`)
  - `available` / `in_progress` — карточка урока, список пунктов с «+N notes» из `notes_available`, CTA на первый незавершённый пункт `/exercise/:planItemId`.
  - `completed` — «Next lesson opens {next_lesson_available_on}».
  - `plan_completed` — CTA на `/check-in`.
  - `needs_assessment` — переход на `/`.
  - `PlanWave` — 14 узлов по `lessons[].status` и узел проверки с датой `reassessment.next_available_on`.

- [ ] **Step 2: Exercise** (макет `Exercise.html`)
  - Пункт ищется по `planItemId` в `useToday().lesson.items`; если его там нет — в `usePlan()`.
  - Показываются `task.text` и инструкция из `useExercise(exercise_id)`.
  - `timer` — таймер, «Finish» отправляет `elapsed_seconds`.
  - `self_confirmation` — чекбокс и `self_confirmed: true`.
  - `recording` — `useRecorder({maxSeconds: 90})`, `uploadRecording({purpose:'exercise', plan_item_id})`, опрос job, затем попытка с `recording_id`. Для E06 показать цель `target_wpm`.
  - `passed` — тост «+N notes» по строкам `reward.parts` (бонус отдельной строкой), затем следующий пункт. Если пунктов больше нет — `PUT /progress/{lesson_id}` и переход на `/done/:lessonId`.
  - `needs_retry` — `feedback.issues` и повтор.
  - 409 `plan_item_already_completed` — перейти к следующему пункту.

- [ ] **Step 3: Done** (макет `Done.html`)
  - `PUT /progress/{lessonId}` (идемпотентен, безопасен при перезагрузке). Показать `session_reward.notes`, `formatMinutes(session_reward.practice_seconds)`, `streak.current_days`, `completed_lessons/total_lessons`, `next_lesson_available_on`.
  - После успеха инвалидировать `me`, `today`, `plan`, `progress`.
  - 409 `lesson_incomplete` — вернуть на первый `pending_plan_item_ids`.

- [ ] **Step 4: Проверить**

Run: `npx tsc --noEmit && npx vite build`
Expected: без ошибок. Вручную: урок 1 проходится целиком, чипы растут, перезагрузка `/done/:id` показывает те же числа.

- [ ] **Step 5: Commit** — `feat(frontend): daily lesson flow with rewards`

---

### Task 6: Progress и Settings

**Files:**
- Create: `frontend/src/screens/Progress.tsx`, `Settings.tsx`

- [ ] **Step 1: Progress** (макет `Progress.html`)
  - `summary`: уроки, серия, ноты, минуты.
  - `activity` — точки недели.
  - `measurement_history` — значения по оценкам.
  - `recordings` — список с `<audio src={audio_url}>` и «Load more» по `next_recordings_cursor` (`useInfiniteQuery`).
  - Графика темпа нет, пока в API нет ряда (*как в `api-mapping.md`*).

- [ ] **Step 2: Settings** (макет `Settings.html`)
  - `PATCH /preferences` (goal, timezone).
  - `DELETE /guest-data` с подтверждением на странице (без `confirm()`), затем `queryClient.clear()` и переход на `/`. Текст про подписку убрать.
  - Слот для кнопки установки — его заполняет Task 8.

- [ ] **Step 3: Проверить**

Run: `npx tsc --noEmit`
Expected: без ошибок. Вручную: удаление данных → `/` → новая сессия с нулевыми чипами.

- [ ] **Step 4: Commit** — `feat(frontend): progress and settings screens`

---

### Task 7: CheckIn и метка Demo

**Files:**
- Create: `frontend/src/screens/CheckIn.tsx`
- Modify: `frontend/src/screens/Profile.tsx` (если бейдж ещё не сделан в Task 4)

- [ ] **Step 1: CheckIn** (макет `CheckIn.html`)
  - Источник — `useMe().reassessment`.
  - `available` — CTA ведёт на `/mic-check?kind=reassessment`.
  - Иначе показать дату `next_available_on`. Если `demo_override_available` — кнопка «Run demo check-in» с постоянной пометкой `DEMO_MODE`, ведёт на `/mic-check?kind=reassessment&demo=1`.
  - Дальше путь как в Task 4, Profile показывает `comparison` и `Demo`.

- [ ] **Step 2: Проверить вручную**

Запустить бэкенд с `DEMO_MODE=true`. После урока пройти `/check-in` → demo → профиль: виден бейдж `Demo` и дельты. Без `DEMO_MODE` кнопки нет.

- [ ] **Step 3: Commit** — `feat(frontend): check-in reassessment with demo label`

---

### Task 8: PWA

**Files:**
- Modify: `frontend/vite.config.ts`, `frontend/index.html`, `frontend/src/screens/Settings.tsx`
- Create:
  - `frontend/public/icons/icon-192.png`, `icon-512.png`, `maskable-512.png`, `apple-touch-icon.png` (180)
  - `frontend/src/components/UpdateBanner.tsx`, `src/lib/install.ts`

**Interfaces:**
- Produces:
  - `useInstallPrompt() -> {canInstall: boolean, install(): Promise<void>, isIos: boolean, isStandalone: boolean}`
  - `<UpdateBanner/>` на `useRegisterSW` из `virtual:pwa-register/react`

- [ ] **Step 1: Иконки**

Эквалайзер на тёмном круге, цвета из `tokens.css`. Нарисовать SVG и растеризовать в нужные размеры (`rsvg-convert` или `npx @vite-pwa/assets-generator`). Для maskable — безопасная зона 80 %.

- [ ] **Step 2: Конфигурация `VitePWA`**

- `registerType: 'prompt'`.
- manifest: `name: 'Resonance'`, `short_name: 'Resonance'`, `display: 'standalone'`, `start_url: '/'`, `theme_color`/`background_color` из токенов, иконки.
- workbox: `globPatterns: ['**/*.{js,css,html,woff2,png,svg}']`, `navigateFallbackDenylist: [/^\/api\//, /^\/health\//]`, без `runtimeCaching`.
- В `index.html` — `<link rel="apple-touch-icon">`.

- [ ] **Step 3: UpdateBanner и Install**

- `UpdateBanner`: «New version available» и «Reload» (`updateServiceWorker(true)`). В `AppShell`.
- Settings: «Install app», если есть `beforeinstallprompt`. На iOS вне standalone — подсказка «Share → Add to Home Screen».

- [ ] **Step 4: Проверить**

Run: `npx vite build && npx vite preview`, затем Chrome DevTools → Application.
Expected:
- манифест без ошибок, SW активен;
- в Cache Storage нет `/api` ответов;
- Lighthouse отмечает приложение как installable.

- [ ] **Step 5: Commit** — `feat(frontend): installable PWA with update prompt`

---

### Task 9: Docker, README, сквозная проверка и полировка

**Files:**
- Create: `frontend/Dockerfile`, `frontend/nginx.conf`, `frontend/.dockerignore`
- Modify: `compose.yaml`, `README.md`

- [ ] **Step 1: Образ и compose**

`frontend/Dockerfile` — multi-stage:
- сборка: `node:26.x-alpine` с точной версией, `npm ci && npm run build`;
- раздача: `nginx:1.x-alpine` с точной версией.

`nginx.conf`:
- `location /api/` и `/health/` → `proxy_pass http://web:8000`, `client_max_body_size 26m`, заголовки `Host`, `X-Forwarded-*`;
- `location /` → `try_files $uri /index.html`;
- для `index.html`, `sw.js`, `manifest.webmanifest` — `Cache-Control: no-cache`;
- для `/assets/` — `immutable`.

`compose.yaml`: сервис `frontend` (`build: ./frontend`, `ports: "127.0.0.1:${WEB_PORT:-8080}:80"`, `depends_on: web`). У `web` убрать публикацию порта: наружу смотрит только `frontend`.

README: запуск (`docker compose up --build`, `http://localhost:8080`), разработка (`npm run dev`), установка приложения.

- [ ] **Step 2: Запустить**

Run: `docker compose up --build -d && curl -sf localhost:8080/health/ready && curl -sf localhost:8080/today | grep -q '<div id="root">'`
Expected: оба запроса успешны.

- [ ] **Step 3: Сквозной прогон в Chrome (Claude in Chrome)**

Пройти по `localhost:8080` на ширинах 390 / 820 / 1280:
- новая сессия → запись → анализ → профиль → занятие → перезагрузка на `/exercise/:id` и `/done/:id` → прогресс → (DEMO_MODE) проверка;
- отказ в микрофоне;
- тихая запись (`needs_rerecord`);
- нет ключа OpenAI (`failed` с причиной);
- запись до лимита 90 с;
- двойной клик по Finish.

Скриншоты сверить с макетами.

- [ ] **Step 4: Полировка UI**

Прогнать skills `impeccable` (критика и полировка) и `taste-skill` по экранам. Исправить расхождения с макетами:
- отступы;
- состояния hover/focus/disabled;
- скелетоны;
- пустые и ошибочные состояния;
- `prefers-reduced-motion`.

После правок повторить `tsc --noEmit`, `vite build` и `pytest -q`.

- [ ] **Step 5: Commit** — `feat: serve web client via nginx and polish screens`
