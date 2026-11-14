# Экраны → API

Префикс `/api/v1`. Все POST — с `Idempotency-Key`. Состояния на экранах соответствуют статусам из бэкенда.

| Экран | Эндпоинты | Поля и состояния |
| --- | --- | --- |
| `Main` | `POST /guest-session` | `goal` (`clear_speech` / `expressive_voice` / `confident_delivery`), `timezone` (из браузера), `consent: {audio_processing: true, policy_version: "2026-11-14"}`. Кнопка неактивна без согласия |
| `MicCheck` | `getUserMedia`; `POST /assessments` | `recording_conditions: {device_label, distance_cm, environment}`; `environment` ∈ `quiet_room`, `some_noise`, `noisy`, `unknown` |
| `MicBlocked` | — | Ошибка `NotAllowedError` у `getUserMedia`; подсказка про HTTPS на внешнем адресе |
| `Record` | `POST /recordings` (multipart, `purpose=assessment`, `assessment_id`, `task_id`) | Тексты и инструкции из задач оценки (`protocol.json`). Лимит: 60 с на задание, 180 с на три. Форматы — `limits.accepted_audio_types` из `GET /me` |
| `Analyzing` | `POST /assessments/{id}/submit` → `GET /jobs/{id}` (опрос по `poll_after_ms`) | `queued` → `processing` → `completed` |
| `Rerecord` | `GET /assessments/{id}`; повторный `POST /recordings` для задачи | `needs_rerecord`: перезаписывается только задача с `quality_status != accepted`; дата проверки не сдвигается |
| Ошибка анализа | `POST /jobs/{id}/retry` | `failed`: баннер с причиной и *Try again* |
| `Profile` | `GET /assessments/{id}` | `f0_median_hz`, `f0_range_hz`, диапазон в полутонах, `pause_ratio`, `pause_count`, `speaking_rate_wpm`, `articulation_rate_wpm` («без пауз»). Недоступная метрика → *Not measured* + причина. `summary`, `observations`, до 2 `priorities` с `exercise_ids` |
| `Paywall` | `GET /me` → `capabilities.daily_training` | Показывать, когда `daily_training = false`. См. `stripe-test-mode.md` |
| `Home` | `GET /today`, `GET /plan`, `GET /me` | `daily_status`: `available` / `in_progress` / `completed` / `plan_completed` / `needs_assessment`. Волна плана — `lessons[].status` (`completed`, `available`, `locked`), 14 + узел проверки. Чипы: `streak.current_days`, ноты и минуты (см. `rewards-api.md`). Дата проверки — `reassessment.next_available_on` |
| `Exercise` | `GET /exercises/{id}`; `POST /recordings` (`purpose=exercise`, `plan_item_id`); `POST /exercise-attempts` | Текст — `task.text` (beginner дни 1–7, intermediate с 8-го). Проверка — `verification.type`: `timer` / `self_confirmation` / `recording`. Для E06 — `target_wpm` 120–150. Лимит записи 90 с. `needs_retry` → повтор |
| `Done` | `PUT /progress/{lesson_id}` | `completed_lessons`, `streak`, `next_lesson_available_on`. Повторный вызов не начисляет прогресс |
| `Progress` | `GET /progress`, `GET /recordings/{id}/audio` | `summary`, `activity` (точки недели), `measurement_history`, `recordings` (пагинация `next_recordings_cursor`) |
| `CheckIn` | `POST /assessments` (`kind: reassessment`) → тот же путь записи; `GET /assessments/{id}` | Доступна при `reassessment.available`. В отчёте сравнение с прошлой оценкой: `delta` по метрикам; при несопоставимых условиях — текст без чисел. В `DEMO_MODE` — `demo_override` и видимая пометка «Demo» |
| `Settings` | `PATCH /preferences`, `DELETE /guest-data` | Цель, часовой пояс. Удаление — с подтверждением на странице |

## Что сделано по итогам сверки с бэкендом

- Согласие на обработку аудио добавлено на `Main`.
- Условия записи собираются на `MicCheck`.
- Лимиты: 1:00 на задание, 1:30 на запись упражнения.
- Названия упражнений, длительности, порядок в занятии (E01 → цели → E12) и цель E06 (120–150 wpm) — из `exercises.json`.
- Третья цель — *Confident delivery*.
- Текст задания 2 — из `protocol.json`.

## Открытые пункты

- Stripe — не реализован, только `AccessPolicy` (`stripe-test-mode.md`).
- Пометка деморежима на экранах проверки и отчёта — нарисовать.
- График темпа по занятиям на `Progress` строится из записей E06; готового ряда в API нет.
