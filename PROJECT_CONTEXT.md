# Тянь Мин / 天命 — project context

Read this file after `AGENTS.md`, then use `BACKLOG.md` as the operational source of truth for unfinished work. Verify implementation details in code when they differ from documentation.

## Product

Тянь Мин builds a personal Chinese birth chart from two traditions:

- Ба-цзы;
- Цзы Вэй Доу Шу.

Product principle: **«Две традиции — один цельный портрет»**. The primary user language is Russian. Use a clear Russian term first and the Chinese professional notation as a secondary layer. Avoid English system names where a normal Russian term exists. Interpretations should be human, personal and probabilistic where appropriate, without guaranteed-event claims or repetitive defensive disclaimers.

### Free layer

Input: optional name, Gregorian birth date, local birth time, confirmed birthplace suggestion and gender. The server builds the real chart without OpenAI. Free preview includes:

- four BaZi pillars, Day Master, chart balance, five elements and current major period;
- key Zi Wei parameters, four transformations, current age palace and expandable 12-palace/star chart.

Free preview must not expose the full premium interpretation or trigger AI generation.

### Premium layer

The paid one-time product is a combined personal interpretation: character and motives, strengths and growth, career, money, relationships, current period, coming years, action plan, combined BaZi/Zi Wei reading and full PDF.

Preferred microcopy: **«Ба-цзы + Цзы Вэй · Персональный разбор · Полный PDF-отчёт»**.

Launch price: **599 RUB**. The current **100 RUB** is only a DEV/mock-flow placeholder (`PREMIUM_REPORT_PRICE_RUB` is the server-side configuration point) and is not the production price. The production amount is owned by server configuration; the frontend only displays the value returned by the server.

## Current architecture

### Calculation and time

- `calculator/` contains the TypeScript BaZi/Zi Wei calculation layer and `lunar-typescript` integration.
- `calculator/local-chart.ts` is the unified calculation interface used by the web pipeline.
- `web/lib/birth-chart-pipeline.cjs` connects validated birth input to the calculator.
- Time/location handling includes historical timezone rules and `TRUE_SOLAR_TIME_V1`.

This calculation core is protected. UI, payment, report and deployment tasks should not alter it unless explicitly requested and independently verified.

### Local web application

- `web/server.cjs`: local Node HTTP server and API routes.
- `web/public/`: Russian frontend; `web/scripts/build.cjs` copies it to `web/dist/` after syntax checks.
- `web/lib/free-preview.cjs`: safe free payload built from canonical calculation data.
- `web/lib/location-provider.cjs`: local `city-timezones` provider. Russian names are a presentation layer; canonical coordinates and IANA timezone remain provider data.
- `web/lib/report-*`: report fingerprints, strict report schema, OpenAI provider abstraction, generation and local persistence.
- `web/lib/pdf-*`: separate Premium PDF layer.

Run from `web/`:

```text
npm run build
npm test
npm start
```

The build also compiles the calculator; the test command runs calculator and web suites.

### Location search contract

Autocomplete must support partial case-insensitive search from 2+ characters, Russian display names where available, mouse and keyboard selection, and reject arbitrary unconfirmed text. Selection preserves canonical coordinates/timezone.

After backend changes, restart Node fully. A stale process can serve fresh static `app.js` from disk while retaining an old `location-provider.cjs` in memory. Verify that a new `npm start` did not fail with `EADDRINUSE`.

### Birth-time certainty metadata

The birth form sends `birthTimeCertainty: "exact" | "approximate"`. It describes how confidently the user knows the entered civil time; it never changes `time`, timezone handling, true-solar correction or the calculation core. `canonicalBirthInput()` in `web/lib/personalization.cjs` validates and persists it, with missing legacy values read as `exact`. Free-preview data exposes it as `person.birthTimeCertainty`, while calculated `metadata.calculationSensitivity` and `metadata.sensitivityFlags` remain separate signals.

### Web design

The current design system is effectively frozen: premium editorial, dark green, warm light background, gold accents, serif display typography, restrained spacing and softly rounded cards. Free preview is the visual benchmark. Calculated compact objects may be centered when natural; explanatory/editorial content is normally left-aligned. Do not turn the product into a generic SaaS dashboard or start a redesign without an explicit request.

## Monetization foundation already implemented

Relevant files: `web/lib/product-config.cjs`, `order-store.cjs`, `payment-provider.cjs`, `premium-service.cjs`, server premium routes and frontend DEV flow.

Current state set:

`FREE_PREVIEW` → `CHECKOUT_STARTED` → `PAYMENT_PENDING` → `PAID` → `REPORT_GENERATING` → `REPORT_READY` / `REPORT_FAILED`.

Rules already enforced:

- free preview is separate from premium order creation;
- browser input cannot set `PAID`; server/provider logic is authoritative;
- unpaid orders cannot pass the generation gate;
- `REPORT_GENERATING` prevents a parallel duplicate and `REPORT_READY` reuses the saved result;
- failed generation can retry without another payment;
- checkout/order/report IDs are stable for the same context, and refresh recovery reuses persisted state;
- DEV orders live under `web/.local-orders/`, saved reports under the existing local report store;
- mock payment is development-only; production provider/storage remain unavailable and fail closed;
- the current paid generation step is a stub and makes no OpenAI call.

Do not rewrite this foundation merely to add a production provider.

## Lorentsen production payment integration

Lorentsen is the selected production provider. The provider, consent checkout, authenticated reconciliation, verified webhook endpoint and PostgreSQL persistence are implemented. The production connection and webhook configuration were reported active on 2026-08-12; provider reachability delivery must be rechecked after the deferred-reconciliation fix is deployed. API calls and secrets remain backend-only. Activation instructions are in `web/LORENTSEN_DEPLOYMENT.md`.

The first production create attempt was rejected with HTTP `422`, provider code `amount_out_of_range`, because the former `399 RUB` launch price was below Lorentsen's `500 RUB` minimum. The amount format was correct (`39900` minor units). The launch price is now `599 RUB` (`59900` minor units). Safe redacted diagnostics preserve provider code/type/message and invalid field names without secrets or payer data.

### Create and retrieve payment

- Production base: `https://api.lorentsen.pro` (no separate sandbox base is documented in the available guide).
- Create: `POST /api/v1/integration/payments` with server-side bearer authorization, `Idempotency-Key` and JSON.
- Main fields: `external_order_id`, `customer_amount_minor`, `customer_currency: RUB`, `payer_email`, `webhook_endpoint_id`, `description`, `locale`, `terms_accepted` plus terms version, `auto_redemption_accepted` plus version, and `external_consent_reference`.
- `customer_amount_minor` is an integer: `500 RUB` is `50000`; floats are forbidden.
- Retrieve/poll: `GET /api/v1/integration/payments/{payment_public_id}`.

Create may return `201`, `status=preparing`, `payment_method=null`; this is normal. Poll using `retry_after_seconds` or HTTP `Retry-After`, with about 5 seconds as fallback. At `requires_action`, use `payment_method.image` as QR, the exact `payment_method.link`, and `expires_at`. Never decode a payment URL from the QR. A temporary polling failure must not hide a still-valid QR.

Provider statuses: `preparing`, `processing`, `requires_action`, `succeeded_pending`, `settled`, `manual_review`, `failed`, `expired`. Treat `provider_result_unknown` as manual investigation. Only **`settled`** authorizes fulfillment; never fulfill from browser redirect or `succeeded_pending`.

Do not create another attempt while the existing one is non-terminal. New IDs are allowed only after confirmed `failed` or `expired`. Late success updates the original attempt. Fulfill an order exactly once even if multiple attempts are accidentally paid.

### Idempotency

For one logical attempt, keep `external_order_id`, `Idempotency-Key` and request body identical. On timeout/5xx retry the same request, not a new payment. Interpret `201` as new, `200` as the existing idempotent result, and `409` as same key with a different body (client error).

### Webhooks

Webhooks accelerate updates; REST polling remains fallback. Generic correctly signed reachability/service events are accepted without payment semantics. Every verified event is durably saved first; new events receive `202`, identical duplicates `200`. Only `payment.succeeded` and `payment.settled` enter deferred reconciliation. Reconciliation errors remain queued in the durable inbox and never turn an already accepted webhook into non-2xx. Confirm the final payment state with authenticated GET after a payment webhook.

Header spelling is Lorentsen's documented spelling:

- `X-Lorensten-Event-Id`
- `X-Lorensten-Timestamp`
- `X-Lorensten-Signature`
- `X-Lorensten-Signing-Key-Version`

Verification requirements:

1. Preserve exact raw body bytes before JSON parsing.
2. Verify HMAC-SHA256 over the raw body using the signing secret; compare Base64 `v1=` signature in constant time.
3. Validate signing-key version, header event ID against `event.id`, and timestamp against `event.created_at`; reject timestamps more than about 300 seconds in the future, but do not reject valid old retries solely for age.
4. Before returning 2xx, durably save the event. Deduplicate by event ID; same ID plus a different body hash is a conflict. Durable-save failure returns 5xx. A database-backed worker processes and retries payment reconciliation separately, including work recovered after process restart.

Production records use PostgreSQL tables for orders, payment attempts/history, consent audit, webhook inbox, anomalies and future saved premium reports. DEV `.local-orders` / `.local-reports` remain unchanged. Production setup still requires an active server token, registered webhook endpoint, signing secret/key version, public HTTPS backend, `GET /connection` verification from production, and any required IP/CIDR allowlist. Store all secrets outside Git.

## Premium generation and PDF

Future production chain: server-confirmed Lorentsen `settled` → one premium AI generation → persistence → web report → Premium PDF. A generation failure leaves the order paid and retryable without a new payment. A ready report must be reused without another paid AI call.

The current strict report schema and report fingerprint/persistence architecture already exist. Do not change them casually. Real OpenAI generation is opt-in per task and must never be used for layout QA.

Premium PDF is functionally developed but has a separate visual backlog. Do not modify it during payment or deployment tasks.

## Quality status and next stages

At context creation: calculation core is considered stable; free preview, location autocomplete, monetization foundation, mock retry/recovery and duplicate-generation protection exist. Stale Node runtime behavior is covered by regression tests.

Last known suite status: **146 pass, 0 fail, 4 skipped**; skipped tests require external astrological verification. This is a snapshot—rerun tests after meaningful changes.

Planned sequence, not work authorized by this file:

1. production deployment architecture and public HTTPS backend;
2. Lorentsen integration plus production persistence/durable webhook inbox;
3. real end-to-end payment verification;
4. real OpenAI premium generation after `settled` and report persistence/recovery;
5. separate Premium PDF visual refresh;
6. pre-launch QA and launch.

See `BACKLOG.md` for active details.
