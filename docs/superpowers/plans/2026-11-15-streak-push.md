# Streak Push Reminder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Один вечерний Web Push в день «не прерывай серию» для гостей, которые включили напоминания.

**Architecture:** Подписка хранится в `guest.data["push"]`. Существующий `Worker` раз в 10 минут обходит гостей и через `pywebpush` шлёт пуш тем, у кого серия под угрозой. Service worker получает обработчики `push` и `notificationclick` через `workbox.importScripts`.

**Tech Stack:** FastAPI, SQLAlchemy, pywebpush, React + vite-plugin-pwa (generateSW), vitest, pytest.

**Spec:** `docs/superpowers/specs/2026-11-15-streak-push-design.md`

## Global Constraints

- Пуш отправляется не чаще одного раза в локальный день гостя.
- Правило отправки: подписка есть; `streak()["current_days"] >= 1`; `last_practice_on` = локальное «вчера»; локальное время ≥ 19:00.
- Разрешение браузера запрашивается только по клику на кнопку.
- Ключи `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (по умолчанию `mailto:admin@localhost`) берутся из env. Без ключей пуш выключен: API отвечает 503 `push_disabled`, worker пропускает рассылку.
- Если push-сервис ответил 404 или 410, подписку удаляем.
- Кнопка тестовой отправки доступна любому подписанному гостю (шлёт только на его подписку).
- Тексты на английском, как остальной UI.

## Review Focus

- Стрик 0 или последнее занятие сегодня: пуша нет (Task 1, `test_due_*`).
- Повторный тик worker'а в тот же вечер: второго пуша нет (Task 3, `test_remind_once_per_day`).
- Истёкшая подписка (410): подписка удаляется, worker не падает (Task 3, `test_remind_drops_gone_subscription`).
- VAPID не настроен: эндпоинты отвечают 503, worker молчит (Task 2, `test_push_disabled_without_vapid`).
- Разные часовые пояса: правило считается по `preferences.timezone`, а не по UTC (Task 1, `test_due_uses_guest_timezone`).

---

### Task 1: Правило «пора напомнить» и отправка

**Files:**
- Modify: `requirements.in`, `requirements.lock` (`pywebpush`; лок пересобрать тем же способом, что и сейчас, например `uv pip compile requirements.in -o requirements.lock`)
- Modify: `app/config.py` (`vapid_public_key: str = ""`, `vapid_private_key: SecretStr = SecretStr("")`, `vapid_subject: str = "mailto:admin@localhost"`, свойство `push_enabled -> bool`)
- Modify: `.env.example` (три пустые VAPID-переменные с комментарием, как их сгенерировать: `vapid --gen` или `py_vapid`)
- Create: `app/push.py`
- Test: `tests/test_push.py`

**Interfaces:**
- Produces:
  - `due(streak: dict, local_now: datetime, last_sent_on: str | None) -> bool`: чистая функция по правилу из Global Constraints.
  - `message(days: int) -> dict`: `{"title": "Resonance", "body": ..., "url": "/"}`, шаблон выбирается по `days % len(TEMPLATES)`; в каждом шаблоне есть число дней.
  - `send(settings: Settings, subscription: dict, payload: dict) -> bool`: `False`, если push-сервис ответил 404 или 410 (подписка мертва); остальные ошибки пробрасываются.

- [ ] **Step 1: Write the failing tests**

```python
NY = ZoneInfo("America/New_York")
def at(h): return datetime(2026, 11, 15, h, tzinfo=NY)
s = lambda days, last: {"current_days": days, "longest_days": days, "last_practice_on": last}

def test_due_evening_after_yesterday():
    assert due(s(3, "2026-11-14"), at(19), None)
def test_due_not_before_19():
    assert not due(s(3, "2026-11-14"), at(18), None)
def test_due_not_if_practiced_today():
    assert not due(s(3, "2026-11-15"), at(20), None)
def test_due_not_if_no_streak():
    assert not due(s(0, None), at(20), None)
def test_due_once_per_day():
    assert not due(s(3, "2026-11-14"), at(21), "2026-11-15")
def test_due_uses_guest_timezone():
    # 00:30 UTC 16 Nov = 19:30 15 Nov in New York
    local = datetime(2026, 11, 16, 0, 30, tzinfo=UTC).astimezone(NY)
    assert due(s(2, "2026-11-14"), local, None)
def test_message_mentions_days():
    assert "5" in message(5)["body"]
def test_send_reports_gone(monkeypatch, settings):
    # monkeypatch app.push.webpush to raise WebPushException with response.status_code == 410
    assert send(settings, {"endpoint": "x", "keys": {}}, message(1)) is False
```

- [ ] **Step 2: Run and see them fail**

Run: `pytest tests/test_push.py -v`
Expected: FAIL (ImportError: app.push)

- [ ] **Step 3: Implement `due`, `message`, `send` in `app/push.py` and the settings fields**

`send` вызывает `pywebpush.webpush(subscription_info=..., data=json.dumps(payload), vapid_private_key=..., vapid_claims={"sub": settings.vapid_subject}, ttl=3600)`.

- [ ] **Step 4: Run tests**

Run: `pytest tests/test_push.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add requirements.in requirements.lock app/config.py app/push.py .env.example tests/test_push.py
git commit -m "push: правило напоминания о стрике и отправка"
```

---

### Task 2: API подписки

**Files:**
- Modify: `app/main.py` (рядом с `/api/v1/preferences`)
- Modify: `app/schemas.py` (`PushSubscriptionInput`: `endpoint: HttpUrl`, `keys: {p256dh: str, auth: str}`)
- Modify: `app/service.py` `guest_view` (поля `push_public_key: str | None` = ключ или `None`, если пуш выключен, и `push_enabled: bool` = подписка есть)
- Test: `tests/test_push.py`

**Interfaces:**
- Consumes: `settings.push_enabled`, `push.send`, `push.message` (Task 1).
- Produces:
  - `PUT /api/v1/push/subscription` (тело `PushSubscriptionInput`) → 204; пишет `guest.data["push"] = {"subscription": {...}, "last_sent_on": None}`.
  - `DELETE /api/v1/push/subscription` → 204; удаляет `guest.data["push"]`.
  - `POST /api/v1/push/test` → 204; без подписки — 409 `push_not_subscribed`; отправляет `message(max(streak, 1))` сразу, без проверки `due` и без обновления `last_sent_on`.
  - Если `not settings.push_enabled`, все три отвечают 503 `push_disabled`.
  - PUT/DELETE идемпотентны по своей природе, поэтому без `mutate`, как `PATCH /preferences`; CSRF/origin-проверка идёт общим middleware.

- [ ] **Step 1: Write the failing tests** (используют фикстуры `client`/`settings` и `guest()` из `tests/conftest.py`; VAPID задать в `settings` фиктивными значениями)

```python
SUB = {"endpoint": "https://push.example/abc", "keys": {"p256dh": "k", "auth": "a"}}

def test_subscribe_and_unsubscribe(client):
    guest(client)
    assert client.put("/api/v1/push/subscription", json=SUB).status_code == 204
    assert client.get("/api/v1/me").json()["push_enabled"] is True
    assert client.delete("/api/v1/push/subscription").status_code == 204
    assert client.get("/api/v1/me").json()["push_enabled"] is False

def test_push_requires_session(client):
    assert client.put("/api/v1/push/subscription", json=SUB).status_code == 401

def test_push_disabled_without_vapid(client_without_vapid):
    guest(client_without_vapid)
    r = client_without_vapid.put("/api/v1/push/subscription", json=SUB)
    assert r.status_code == 503 and r.json()["error"]["code"] == "push_disabled"
    assert client_without_vapid.get("/api/v1/me").json()["push_public_key"] is None

def test_push_test_requires_subscription(client):
    guest(client)
    assert client.post("/api/v1/push/test").status_code == 409
```

Если `/me` строится не из `guest_view`, добавить поля туда, откуда `/me` их отдаёт, и проверить через `/me`.

- [ ] **Step 2: Run and see them fail**

Run: `pytest tests/test_push.py -k "subscribe or push_" -v`
Expected: FAIL (404 на роутах)

- [ ] **Step 3: Implement routes, schema, view fields**

- [ ] **Step 4: Run tests**

Run: `pytest tests/test_push.py tests/test_api.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/main.py app/schemas.py app/service.py tests/test_push.py
git commit -m "push: API подписки и тестовой отправки"
```

---

### Task 3: Рассылка в worker

**Files:**
- Modify: `app/worker.py` (метод `Worker.remind_streaks`, вызов из `main()`)
- Modify: `app/config.py` (`push_check_seconds: float = Field(default=600, gt=0)`)
- Test: `tests/test_push.py`

**Interfaces:**
- Consumes: `push.due`, `push.message`, `push.send` (Task 1); `Service.streak()`, `Service.local_date()`; формат `guest.data["push"]` (Task 2).
- Produces: `Worker.remind_streaks(now: datetime | None = None) -> int`, число отправленных пушей.

Алгоритм: если `not settings.push_enabled`, вернуть 0. Иначе в одной сессии `select(Guest)` (ponytail: полный перебор гостей, при росте числа гостей перейти на индексируемый флаг или таблицу), пропустить тех, у кого нет `data["push"]`. Для каждого гостя: собрать `Service(db, settings)` и выставить `s.guest = guest`; посчитать `local_now = now.astimezone(ZoneInfo(tz))`. Если `due(...)`: вызвать `send`. При `True` записать `last_sent_on = local_now.date().isoformat()`, при `False` удалить `data["push"]`. Изменённый `data` присвоить копией (как делает `Service.__init__`, чтобы JSON-поле считалось изменённым), сделать commit. Исключение при отправке одному гостю логировать и идти дальше.

В `main()`: держать `next_push = 0`; в цикле, если `time.monotonic() >= next_push`, вызвать `remind_streaks()` в try/except с логом и сдвинуть `next_push` на `push_check_seconds`.

- [ ] **Step 1: Write the failing tests** (`send` подменён через monkeypatch на заглушку, которая записывает вызовы; гостю выставить подписку, `America/New_York` и пройденный «вчера» урок, используя существующие хелперы conftest или прямую запись в `Resource` типа `plan`)

```python
def test_remind_sends_once_per_day(worker, streak_guest, sent):
    now = datetime(2026, 11, 16, 0, 30, tzinfo=UTC)  # 19:30 NY
    assert worker.remind_streaks(now) == 1
    assert worker.remind_streaks(now + timedelta(minutes=10)) == 0
    assert len(sent) == 1 and str(streak_guest.days) in sent[0]["body"]

def test_remind_drops_gone_subscription(worker, streak_guest, monkeypatch):
    monkeypatch.setattr("app.push.send", lambda *a: False)
    worker.remind_streaks(datetime(2026, 11, 16, 0, 30, tzinfo=UTC))
    # перечитать гостя: "push" отсутствует в data

def test_remind_skips_without_vapid(worker_without_vapid, streak_guest, sent):
    assert worker_without_vapid.remind_streaks() == 0 and sent == []
```

Фикстура `streak_guest` должна ставить дату урока относительно фиксированного `now` в тесте, не относительно реального сегодня.

- [ ] **Step 2: Run and see them fail**

Run: `pytest tests/test_push.py -k remind -v`
Expected: FAIL (AttributeError: remind_streaks)

- [ ] **Step 3: Implement `remind_streaks` and the loop hook**

- [ ] **Step 4: Run the full backend suite**

Run: `pytest -q`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/worker.py app/config.py tests/test_push.py
git commit -m "push: вечерняя рассылка напоминаний о стрике в worker"
```

---

### Task 4: Клиент: service worker и кнопка

**Files:**
- Create: `frontend/public/push-sw.js` (обработчики `push` → `self.registration.showNotification(title, {body, icon: '/icons/icon-192.png', data: {url}})` внутри `event.waitUntil`; `notificationclick` → закрыть уведомление, сфокусировать открытую вкладку приложения или `clients.openWindow(url)`)
- Modify: `frontend/vite.config.ts` (`workbox.importScripts: ['push-sw.js']`)
- Create: `frontend/src/lib/push.ts`
- Create: `frontend/src/lib/push.test.ts`
- Create: `frontend/src/components/StreakReminderToggle.tsx`
- Modify: `frontend/src/api/types.ts` (`Me.push_public_key: string | null`, `Me.push_enabled: boolean`)
- Modify: `frontend/src/screens/Progress.tsx` (рядом с чипом стрика), `frontend/src/screens/Done.tsx` (под RewardChips)

**Interfaces:**
- Consumes: `PUT/DELETE /api/v1/push/subscription`, `POST /api/v1/push/test`, поля `Me` (Task 2); `request` из `frontend/src/api/api.ts`.
- Produces:
  - `urlBase64ToUint8Array(base64url: string): Uint8Array`
  - `pushSupported(): boolean` (`'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window`)
  - `enablePush(publicKey: string): Promise<void>`: `Notification.requestPermission()`; при `'granted'` вызвать `(await navigator.serviceWorker.ready).pushManager.subscribe({userVisibleOnly: true, applicationServerKey})` и отправить `PUT` с `sub.toJSON()`; иначе бросить `Error('permission_denied')`.
  - `disablePush(): Promise<void>`: отписать текущую подписку браузера, если она есть, и отправить `DELETE`.
  - `<StreakReminderToggle />`: ничего не рендерит, если `!pushSupported()` или `me.push_public_key == null`. Кнопка «Remind me to keep my streak» или «Streak reminders on · Turn off»; после действия инвалидирует `['me']`. При `permission_denied` показывает подсказку «Notifications are blocked in browser settings.» Если `me.push_enabled`, рядом есть кнопка «Send test reminder».

- [ ] **Step 1: Write the failing test**

```ts
test('urlBase64ToUint8Array decodes base64url without padding', () => {
  expect(Array.from(urlBase64ToUint8Array('AQID_-8'))).toEqual([1, 2, 3, 255, 239])
})
```

- [ ] **Step 2: Run it**

Run: `cd frontend && npm test -- push`
Expected: FAIL (module not found)

- [ ] **Step 3: Implement `lib/push.ts`, `push-sw.js`, the vite config change, the component and its placement**

- [ ] **Step 4: Verify**

Run: `cd frontend && npm test && npm run build`
Expected: тесты PASS; сборка без ошибок; в `dist/sw.js` есть `importScripts("push-sw.js")`.

Ручная проверка (compose с VAPID-ключами и `DEMO_MODE=true`, Chrome, localhost):
1. Progress → «Remind me…» → разрешить: кнопка переключается в состояние «on».
2. «Send test reminder» → приходит системное уведомление; клик по нему открывает или фокусирует приложение.
3. «Turn off» → после этого `/me` отдаёт `push_enabled: false`.

- [ ] **Step 5: Commit**

```bash
git add frontend/public/push-sw.js frontend/vite.config.ts frontend/src/lib/push.ts frontend/src/lib/push.test.ts frontend/src/components/StreakReminderToggle.tsx frontend/src/api/types.ts frontend/src/screens/Progress.tsx frontend/src/screens/Done.tsx
git commit -m "push: кнопка напоминаний и обработчики в service worker"
```

---

Деплой (без отдельной задачи): задать `VAPID_*` в Heroku config. Ключи сгенерировать один раз и одинаковыми положить во все окружения, которые делят базу.
