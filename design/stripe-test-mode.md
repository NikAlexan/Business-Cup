# Тестовая оплата Stripe (сценарий для фронтенда и бэкенда)

Сейчас в бэкенде оплаты нет: `NoBillingAccessPolicy` разрешает `assessment` и `daily_training`. Ниже — сценарий, нарисованный в макетах, и что понадобится в API. Только Stripe **test mode**.

## Что бесплатно, что по подписке

- Бесплатно: гостевая сессия, базовая запись, профиль голоса (`assessment`).
- По подписке: план из 14 занятий, ежедневные упражнения, проверки и новый план (`daily_training`).

## Путь пользователя

`Profile` → *See my 14-session plan* → `Paywall` (месяц / год, цена, условия, плашка Test mode) → Stripe Checkout (страница Stripe) → `PaySuccess` → `Home`. Отмена в Checkout → `PayCanceled` → назад на `Paywall`. *Not now* на `Paywall` оставляет профиль.

Управление: `Settings` → раздел Subscription → *Manage subscription* (Stripe Customer Portal).

## Что нужно от бэкенда

| Эндпоинт | Назначение |
| --- | --- |
| `POST /billing/checkout-session` | Создаёт Checkout Session (mode `subscription`, price из `.env`), `client_reference_id = subject_id`, `success_url` и `cancel_url` на фронтенд. Возвращает `url` |
| `POST /billing/webhook` | Проверка подписи; `checkout.session.completed`, `customer.subscription.updated` и `.deleted` меняют права по `subject_id` |
| `POST /billing/portal-session` | Ссылка на Customer Portal |
| `GET /me` | `capabilities.daily_training` и `subscription: {status, plan, current_period_end, test_mode}` |

Доступ открывает только вебхук. Страница `PaySuccess` опрашивает `GET /me`, пока `daily_training` не станет `true` («Still confirming? Refresh in a minute — you won't be charged twice»).

Настройки: `BILLING_PROVIDER=stripe_test`, `STRIPE_SECRET_KEY` (sk_test_…), `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_MONTHLY`, `STRIPE_PRICE_YEARLY`. Ключи только на сервере.

## Открытые вопросы

- Цены, пробный период, политика возврата — заглушки [PRICE], [YOUR REFUND POLICY] на `Paywall` и `Terms`.
- Подписка привязана к гостевой сессии в браузере. Восстановление на другом устройстве (например, по email из чека Stripe) не предусмотрено.
- `DELETE /guest-data` при активной подписке: отменять подписку автоматически или требовать отмены вручную (сейчас в дизайне — предупреждение).
