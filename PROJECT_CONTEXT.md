# Тянь Мин / 天命 — project context

Read this file after `AGENTS.md`. Use `BACKLOG.md` as the operational source of truth for unfinished work, and verify implementation details in code before changing them.

## Product

Тянь Мин is a Russian-language product that combines two Chinese astrology traditions:

- Ба-цзы;
- Цзы Вэй Доу Шу.

Product principle: **«Две традиции — один цельный портрет»**. The systems remain independently calculated and are compared only at the interpretation layer. Russian meaning comes first; Chinese terms are a secondary professional layer. Interpretations must be personal, evidence-backed and non-fatalistic, without guaranteed events or medical, legal or financial claims.

### Free and Premium

The free calculation accepts an optional name, local Gregorian birth date, local civil birth time, a confirmed birthplace suggestion and gender. It returns the real deterministic BaZi/Zi Wei chart without OpenAI. The free preview includes BaZi pillars, Day Master, balance, five elements and current major period, plus key Zi Wei parameters, transformations, current age palace and the expandable 12-palace chart.

Premium is a separate one-time purchase: **«Ба-цзы + Цзы Вэй · Персональный разбор · Полный PDF-отчёт»**. The current temporary closed early-user test price is **599 RUB** (`59900` minor units). A production attempt proved that `399 RUB` (`39900` minor units) is below the Lorentsen-supported range and is not a valid production price. Production price is server-owned; the frontend only displays `/api/premium/config`. The default development/mock price may remain `100 RUB` when no explicit development override is set.

## Calculation and time architecture

- `calculator/` contains the TypeScript BaZi/Zi Wei algorithms, the vendored Yiqi core, enrichment logic and `lunar-typescript` integration.
- `calculator/local-chart.ts` is the unified calculation entry point reused by the web pipeline.
- `web/lib/birth-chart-pipeline.cjs` resolves confirmed location data, historical timezone rules and `TRUE_SOLAR_TIME_V1`, then calls the existing calculation core.
- `web/lib/chart-view.cjs`, `free-preview.cjs` and localization/formatting modules create safe presentation views without recalculating astrology.
- Location autocomplete accepts partial case-insensitive input from two characters, but the user must select a provider result. Canonical coordinates and IANA timezone are preserved.

The calculation core, `local-chart.ts`, `TRUE_SOLAR_TIME_V1`, historical-time rules, coordinates and BaZi/Zi Wei algorithms are protected. UI, payment, report, PDF and deployment work must not change them unless calculation work is explicitly requested and independently verified. Several exact astrological cases remain deliberately skipped pending external specialist verification.

## Birth-time certainty

`birthTimeCertainty` is user-provided metadata with values `exact | approximate`; `exact` is the default and the legacy fallback. It never changes the entered time, timezone resolution, true-solar correction or calculated chart.

`metadata.calculationSensitivity` and `metadata.sensitivityFlags` are separate deterministic signals produced by the calculation pipeline. They must not be merged with user certainty:

- `birthTimeCertainty` describes how confident the user is in the supplied civil time;
- calculated sensitivity describes whether the resulting calculation is near a time-dependent boundary.

Future user-facing Premium/PDF wording must account for both signals without treating either as the other.

## Web application

- `web/server.cjs` serves the application and API; production binds to `0.0.0.0` and uses `process.env.PORT`.
- `web/public/` is the Russian frontend; `web/scripts/build.cjs` copies it to `web/dist/` after checks.
- The mobile-first free funnel, sticky navigation, Telegram/WebView fallback, mobile Safari input protection, location autocomplete, free preview and Premium offer are implemented.
- WEB visual v1 is **FROZEN**. Do not continue cosmetic polish without a separate material requirement.

Run from `web/`:

```text
npm run build
npm test
npm start
```

After backend changes, restart Node fully and confirm an old process did not survive with `EADDRINUSE`.

## Premium Report v4

`personal-report-v4` is the current semantic report architecture. Main components:

- `web/lib/report-content.cjs` builds a versioned deterministic evidence catalog;
- `web/lib/report-service.cjs` creates a frozen AI context containing presentation data, method/sensitivity metadata and `evidenceCatalog`;
- raw `calculationData` and `chartView` are intentionally not sent as the old unrestricted AI snapshot;
- `web/lib/report-provider.cjs` uses OpenAI Responses API with strict Structured Outputs when a real provider is explicitly enabled;
- `web/lib/report-schema.cjs` validates evidence IDs, cross-system evidence types, insight references and forbidden predictive fields;
- unsupported claims such as guaranteed outcomes, medical conclusions, exact marriage/relocation dates or promised income are blocked by prompt and local validation;
- persisted legacy reports and `personal-report-v3` retain explicit compatibility paths.

The deterministic calculation remains authoritative. AI only interprets the supplied evidence. Real OpenAI generation is opt-in and must never be used for visual QA. Production paid generation is not yet enabled: `PremiumService.generate()` fails closed for `PAYMENT_MODE=lorentsen`, while non-production monetization tests use a persisted generation stub.

## Premium PDF

`web/lib/pdf-template.cjs` routes full `personal-report-v4` documents to the shared renderer in `web/lib/pdf-template-v4.cjs`; `web/lib/pdf-service.cjs` supplies the same validated semantic report, calculated chart view, evidence catalog and birth metadata. Legacy rendering exists only for saved-report compatibility.

The current PDF design uses one shared v4 renderer/design system. The older “Premium PDF v5.2” work is a visual/reference source, not the current semantic schema. A final editorial/product polish and exact/approximate review PDFs are active in a separate workstream. Do not call the current PDF finally approved until human review is complete, and do not edit PDF files during unrelated work.

## Monetization and Lorentsen

The internal order state machine is implemented:

`FREE_PREVIEW` → `CHECKOUT_STARTED` → `PAYMENT_PENDING` → `PAID` → `REPORT_GENERATING` → `REPORT_READY` / `REPORT_FAILED`.

Implemented safeguards include server-side price ownership, payment-gated generation, stable order/report IDs, persistence/recovery, duplicate-generation protection, idempotent callbacks, production fail-closed behavior and a closed legacy `/api/report` route. Development mock payments are unavailable in production.

Production uses Lorentsen plus PostgreSQL (`web/lib/lorentsen-provider.cjs`, `lorentsen-webhook.cjs`, `production-store.cjs`, `premium-service.cjs`). The parser accepts the actual nested provider response contract and preserves `payment_public_id`, `payment_status`/`status`, optional `payment_method`, retry timing and `trace_id`. A `preparing` response without a payment method is valid. Existing attempts are recovered and reconciled rather than recreated. Webhooks are verified and durably stored; authenticated GET remains authoritative. Only Lorentsen `settled` may set internal `PAID`; redirects, QR/link, `payment.succeeded` and `succeeded_pending` do not.

The available official Lorentsen production guide and granted client scopes document payment create/read, but not cancellation of an active unpaid payment. Tian Min therefore provides a safe exit back to the result without pretending to cancel or changing provider state. Replacement attempts remain limited to provider-confirmed `failed`/`expired` states.

Historical real provider attempts in `manual_review` remain non-terminal and must not be replaced automatically. Separate `399 RUB` attempts were rejected before payment creation with HTTP `422` / `amount_out_of_range`; they received no `payment_public_id` or payment method. The production payment flow is not considered end-to-end validated until one controlled provider-compatible payment reaches authenticated `settled`.

Promo Codes v1 is server-owned and bound to one exact order/report. `FAMILY0` targets `0 RUB` and creates an atomic `complimentary_promo` entitlement without a provider payment and without setting `PAID`. It has an expiry, active toggle and redemption limit. `FRIEND100` (`100 RUB`) and `SUPPORT399` (`399 RUB`) are configured but inactive: neither may create a production payment until the actual Lorentsen minimum is independently confirmed at or below its target. A planned provider change is not treated as active configuration. Promo application, payment attempts, settlement and complimentary entitlement creation are stored as separate events.

## Deployment and persistence

- Source repository: `eteroganezov/tian-min`, branch `main`.
- Railway deployment support is implemented: root `package.json` enables Node detection; the web server honors deployment host/port; Railway uses the repository with the web application and PostgreSQL persistence.
- Production Lorentsen configuration and secret requirements are documented in `web/LORENTSEN_DEPLOYMENT.md`.
- Local DEV orders/reports use ignored filesystem stores; production Lorentsen records use PostgreSQL.
- Secrets belong only in environment/deployment secret storage and must never enter Git, logs or frontend payloads.

Deployment exists, but launch readiness is not complete while payment is in external `manual_review`, controlled `settled` validation is absent, real paid report generation remains gated, and final PDF human review is open.

## Product and engineering decisions

- BaZi and Zi Wei are calculated independently and combined only as one interpreted portrait.
- Free calculation remains free; Premium is a separate one-time personal interpretation plus PDF.
- Current Premium price is 599 RUB for the temporary closed early-user test and remains server-controlled; 399 RUB is not supported by the current production provider range.
- Frontend state can never prove payment or set `PAID`.
- Reports must be evidence-backed; unsupported predictive claims are rejected rather than softened into apparent facts.
- Ready reports must be persisted and reused; retries after generation failure must not require another payment or unnecessary AI call.
- WEB visual v1 is frozen. Premium PDF is a separate layer and is not yet human-approved.
- `birthTimeCertainty` and calculated sensitivity are independent signals.
- Promo discounts, availability and redemption limits are server/database-owned. A complimentary entitlement is not a payment and never sets `PAID`; paid promos retain the authenticated `settled` requirement.
- Brand architecture is `Tian Min / Тянь Мин`, Chinese wordmark `天命`, standalone symbol `命`, primary lockup `[命] ТЯНЬ МИН 天命`. The site includes scalable and 16/32/180 favicon assets without changing the main logo.

## Licensing and external dependencies

The repository is MIT-licensed. `NOTICE` records attribution for the vendored Yiqi BaZi/Zi Wei core and `lunar-typescript`; required copyright, permission and attribution notices must not be removed. Before a public commercial launch, perform a final repository-wide dependency/license and distributed-artifact `LICENSE`/`NOTICE` audit.

Main external/runtime dependencies:

- Node.js 18+ and npm;
- `lunar-typescript` and the vendored Yiqi core for calculation;
- `city-timezones` and `timezonecomplete` for location/time handling;
- PostgreSQL (`pg`) for production order/payment/report persistence;
- Lorentsen API/webhooks for production payment;
- OpenAI Responses API for future real Premium generation;
- `pdfkit` and fonts available to the runtime for PDF generation;
- Railway for the current production deployment.

See `BACKLOG.md` for the current NOW / BLOCKED / NEXT / LATER / DONE status.
