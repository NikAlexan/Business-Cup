# Награды: ноты и минуты практики (предложение к API)

Дизайн показывает три счётчика: серия дней (есть в API), **ноты** и **минуты практики** (нет). Ноты — награда за выполненную практику, никогда за измерения голоса.

## Правила начисления

| Событие | Ноты |
| --- | --- |
| Засчитанное упражнение E01 (разминка) | 2 |
| Любое другое засчитанное упражнение | 3 |
| Запись упражнения прошла проверку качества (`passed`) | +1 |
| Повтор уже засчитанного `plan_item` | 0 |

Минуты практики — сумма `elapsed_seconds` засчитанных попыток.

## Поля

| Где | Поле |
| --- | --- |
| Ответ `POST /exercise-attempts` | `reward: {notes: int, reason: "exercise_completed" \| "quality_bonus"}` |
| Ответ `PUT /progress/{lesson_id}` | `session_reward: {notes: int, practice_seconds: int}` — для экрана `Done` |
| `GET /me` → `progress` | `notes_total`, `practice_seconds_total` |
| `GET /progress` → `summary` | `notes_total`, `practice_seconds_total` |
| `plan.lessons[].items[]` в `GET /plan` и `GET /today` | `notes_available` — для подписи «+3 notes» |

## Требования

- Идемпотентность как у прогресса: повтор с тем же `Idempotency-Key` или повторное завершение не начисляет ноты.
- `DELETE /guest-data` удаляет ноты вместе с остальными данными.
- Ноты не влияют на план, доступ и проверки.
