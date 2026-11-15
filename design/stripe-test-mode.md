# Stripe test mode

Реализация из main интегрирована в `improve/speech-training-loop`: Checkout, подписанный webhook, Customer Portal, paywall, страницы success/canceled, условия и управление подпиской. Live mode не поддерживается.

## Настройка

По умолчанию `BILLING_PROVIDER=none`: оплата отключена, MVP доступен без подписки. Для test mode задать серверные `BILLING_PROVIDER=stripe_test`, `STRIPE_SECRET_KEY=sk_test_…`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_MONTHLY`, `STRIPE_PRICE_YEARLY`; необязательный `STRIPE_TRIAL_DAYS` по умолчанию 7. Секреты не передаются на frontend и не коммитятся. Без корректной test-конфигурации запуск отклоняется. Реальные ключи в рамках интеграции не настраивались.

## Доступ и API

Baseline и голосовой профиль бесплатны. Новые ежедневные записи/попытки, фокус рассказа и check-in требуют daily_training при включённой оплате. Статусы доступа соответствуют main: active, trialing, past_due. Старые собственные записи и результаты остаются читаемыми.

| Метод | Путь | Поведение |
| --- | --- | --- |
| GET | `/api/v1/billing/plans` | Два серверных Price ID, сумма/валюта, trial_days и test_mode |
| POST | `/api/v1/billing/checkout-session` | `{"interval":"month"}` либо year; ссылка Checkout с subject_id |
| POST | `/api/v1/billing/webhook` | Подпись Stripe-Signature; subscription events обновляют права, старые события пропускаются |
| POST | `/api/v1/billing/portal-session` | Customer Portal для существующего customer |
| GET | `/api/v1/me` | capabilities и subscription; exercise_coaching учитывает оплату и конфигурацию AI |
| DELETE | `/api/v1/guest-data` | Перед удалением отменяет существующую подписку |

Возврат на `/pay/success` не выдаёт доступ сам по себе: страница ждёт обновления GET me после webhook. `/pay/canceled` сохраняет профиль и позволяет вернуться к тарифам. Origin для ссылок берётся из разрешённых origins. В SQLite webhook сериализуется до чтения Guest JSON, как остальные записи профиля/учебного фокуса.

## Совместимость с практикой

Каталог, архивная история, восстановление записей, A/B и reflection сохраняются. Платные мутации проверяются сервером. График использует ту же фактическую длительность, что и totals; нетаймированные подтверждения не превращаются в минуту практики. Подготовленная демоистория явно помечена и не является оплатой или реальной записью.

Подписка привязана к гостевой cookie; переноса на другое устройство нет. Доступ выдаётся по событию подписки, а не результату редиректа Checkout. Автотесты используют локальные заглушки Stripe и подписанные fixtures; реальная оплата через размещённую страницу Stripe в этой интеграции не выполнялась.
