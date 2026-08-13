# Lorentsen production activation

Код интеграции не выполняет платёжных запросов, пока явно не установлен `PAYMENT_MODE=lorentsen`. Mock остаётся только development-режимом. Production records хранятся в PostgreSQL, а не в файловой системе Railway.

## Railway variables

Добавить реальные значения только в Railway Variables:

- `PAYMENT_MODE=lorentsen`
- `DATABASE_URL`
- `PUBLIC_BASE_URL`
- `LORENTSEN_API_BASE_URL=https://api.lorentsen.pro`
- `LORENTSEN_API_TOKEN`
- `LORENTSEN_WEBHOOK_ENDPOINT_ID`
- `LORENTSEN_WEBHOOK_SECRET`
- `LORENTSEN_WEBHOOK_SIGNING_KEY_VERSION`
- `LORENTSEN_CONSENT_VERSION=certificate_purchase_terms_v1`
- `LORENTSEN_AUTO_REDEMPTION_CONSENT_VERSION=partner_auto_redemption_consent_v1`
- `LORENTSEN_TERMS_URL`
- `LORENTSEN_PRIVACY_URL`
- `LORENTSEN_AUTO_REDEMPTION_TERMS_URL`

Секреты нельзя добавлять в `.env.example`, Git, application logs или frontend. `payer_email` хранится только в закрытой consent/payment persistence и не возвращается браузеру.

Production Premium price задаётся versioned server-константой в `web/lib/product-config.cjs`; текущая временная цена закрытого early-user теста — `599 RUB` (`59900` minor units). Цена `399 RUB` была отвергнута production API с HTTP `422` / `amount_out_of_range` и не должна использоваться с текущим Lorentsen contract. `PREMIUM_REPORT_PRICE_RUB` используется только для локальных DEV-сценариев и не может переопределить production price.

## Manual activation sequence

1. Deploy текущий commit и подключить Railway PostgreSQL.
2. Создать production client в Lorentsen.
3. Добавить server token в `LORENTSEN_API_TOKEN`.
4. Зарегистрировать `POST https://tian-min-production.up.railway.app/api/payments/lorentsen/webhook` в Lorentsen.
5. Добавить полученный endpoint ID.
6. Добавить webhook signing secret и signing-key version.
7. Выполнить webhook reachability/signature test из кабинета Lorentsen.
8. Проверить документированный Lorentsen `GET /connection` с production credentials отдельно от пользовательской оплаты.
9. Проверить, что обязательный пользовательский текст показывает каноническое имя партнёра `Тянь Мин`. Если кабинет Lorentsen отдельно показывает устаревшее название организации `Edward`, запросить изменение у Lorentsen: приложение не должно маскировать внешний профиль.
10. Проверить ссылки на юридические документы и выполнить один контролируемый реальный платёж.

Только authenticated `GET /api/v1/integration/payments/{payment_public_id}` со статусом `settled` переводит внутренний заказ в `PAID`. Redirect, QR/link, `payment.succeeded` и `succeeded_pending` недостаточны. Реальная OpenAI generation остаётся выключенной отдельным production gate.
