# Тянь Мин / 天命 — project context

Read this file after `AGENTS.md`. Use `BACKLOG.md` as the operational source of truth for unfinished work, and verify implementation details in code before changing them.

## Product

Тянь Мин is a Russian-language product that combines two Chinese astrology traditions:

- Ба-цзы;
- Цзы Вэй Доу Шу.

Product principle: **«Две традиции — один цельный портрет»**. The systems remain independently calculated and are compared only at the interpretation layer. Russian meaning comes first; Chinese terms are a secondary professional layer. Interpretations must be personal, evidence-backed and non-fatalistic, without guaranteed events or medical, legal or financial claims.

### Free and Premium

The free calculation accepts an optional name, local Gregorian birth date, local civil birth time, a confirmed birthplace suggestion and gender. It returns the real deterministic BaZi/Zi Wei chart without OpenAI. The free preview includes BaZi pillars, Day Master, balance, five elements and current major period, plus key Zi Wei parameters, transformations, current age palace and the expandable 12-palace chart.

Premium is a separate one-time purchase: **«Ба-цзы + Цзы Вэй · Персональный разбор · Полный PDF-отчёт»**. The public price is **599 RUB** (`59900` minor units). Production price is server-owned; the frontend only displays `/api/premium/config`. The default development/mock price may remain `100 RUB` when no explicit development override is set. Lower amounts are available only through explicitly active server-owned promo codes.

Current product principle:

- **FREE:** several understandable personal calculated points, proof that BaZi and Zi Wei were actually calculated, and technical details on demand;
- **PREMIUM:** explains how the calculated data works together and what it means personally: strengths, growth areas, work and money, relationships, the current life stage, upcoming periods and practical orientation.

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

In the first two real-user tests, both users selected `approximate` / ±30 minutes. This is a research observation, not evidence of general behavior. For the next 5–10 users, ask: **«Почему вы выбрали примерное время, а не точное?»** Distinguish people who genuinely do not know their precise time from people made uncertain by the wording or UI. Do not change the current certainty logic without further evidence.

## Web application

- `web/server.cjs` serves the application and API; production binds to `0.0.0.0` and uses `process.env.PORT`.
- `web/public/` is the Russian frontend; `web/scripts/build.cjs` copies it to `web/dist/` after checks.
- The mobile-first free funnel, sticky navigation, Telegram/WebView fallback, mobile Safari input protection, location autocomplete, free preview and Premium offer are implemented.
- Production uses the personal-first **Free Result Variant B** (`b31bcbe2494351cb11756c5fe244c174914eb372`). It presents personal meaning first, calculation proof second, Premium value next and professional detail through progressive disclosure. Technical depth was not removed.
- The technical-first Variant A remains preserved at commit `34f7358d4e3f1dc704cdfedc9439a9d4ea36920b` and tag `free-result-v1-technical-first`. Do not build automated A/B infrastructure yet; compare qualitative observations after 3–5 additional Variant B tests.
- The free Zi Wei result explains the 12 life-area palaces in human language. Palace cards use local static accessible disclosures for generic sphere meanings; calculated stars and age periods remain unchanged, while the Premium bridge clearly reserves personal interpretation for the existing paid flow.
- WEB visual v1 is **FROZEN**. Variant B Iteration 2, including its final Free→Premium framing micro-polish, is frozen for the next 3–5 real-user tests. Do not continue subjective frontend iteration without repeated user feedback, an objective bug or conversion/analytics evidence.

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

The deterministic calculation remains authoritative. AI only interprets the supplied evidence. Real OpenAI generation is opt-in and must never be used for visual QA. Premium Generation & Delivery v1 connects this existing pipeline only after a server-verified legitimate entitlement: authenticated Lorentsen `settled`/paid access or a separate `complimentary_promo` entitlement. Generation uses an atomic persisted claim and explicit `REPORT_GENERATING` / `REPORT_READY` / `REPORT_FAILED` lifecycle. The immutable `personal-report-v4` semantic artifact is stored in the existing report store; PDF is deterministically rendered from that saved artifact and never requires another OpenAI generation.

Development and tests are safe by default: inheriting `OPENAI_API_KEY` does not select the real provider. Local real generation additionally requires `ALLOW_REAL_OPENAI_LOCAL=true`; automated tests block the real provider even if that flag leaks into their environment. Production does not require the local flag and continues to fail closed unless its real OpenAI configuration is complete.

The first real Premium user successfully completed the full production path: `FAMILY0` → `complimentary_promo` entitlement → real OpenAI generation → Report v4 validation → immutable semantic persistence → PDF render → `REPORT_READY` → secure open/download. No user PII is recorded here. Once the semantic report has been persisted, a PDF retry or re-render must reuse it and make **zero** additional OpenAI generation calls.

## Premium PDF

`web/lib/pdf-template.cjs` routes full `personal-report-v4` documents to the shared renderer in `web/lib/pdf-template-v4.cjs`; `web/lib/pdf-service.cjs` supplies the same validated semantic report, calculated chart view, evidence catalog and birth metadata. Legacy rendering exists only for saved-report compatibility.

The current PDF design uses one shared v4 renderer/design system. The older “Premium PDF v5.2” work is a visual/reference source, not the current semantic schema. **Premium PDF v4 is FROZEN.** Change it only for an objective bug/regression or concrete real-user feedback; do not start internal visual iterations without a user signal. Railway runtime includes the verified Unicode/CJK font fix required by the frozen renderer.

Ready Premium reports are delivered through a separate high-entropy capability token. Open and download routes recheck entitlement and report/chart binding server-side, use a privacy-safe filename and disclose no birth, order or payment ID in the URL. Same-browser recovery stores the order capability in local browser storage and restores generating/ready/failed state; email and cross-device recovery remain out of scope.

## Monetization and Lorentsen

The internal order state machine is implemented:

`FREE_PREVIEW` → `CHECKOUT_STARTED` → `PAYMENT_PENDING` → `PAID` → `REPORT_GENERATING` → `REPORT_READY` / `REPORT_FAILED`.

Implemented safeguards include server-side price ownership, payment-gated generation, stable order/report IDs, persistence/recovery, duplicate-generation protection, idempotent callbacks, production fail-closed behavior and a closed legacy `/api/report` route. Development mock payments are unavailable in production.

Production uses Lorentsen plus PostgreSQL (`web/lib/lorentsen-provider.cjs`, `lorentsen-webhook.cjs`, `production-store.cjs`, `premium-service.cjs`). The parser accepts the actual nested provider response contract and preserves `payment_public_id`, `payment_status`/`status`, optional `payment_method`, retry timing and `trace_id`. A `preparing` response without a payment method is valid. Existing attempts are recovered and reconciled rather than recreated. Webhooks are verified and durably stored; authenticated GET remains authoritative. Only Lorentsen `settled` may set internal `PAID`; redirects, QR/link, `payment.succeeded` and `succeeded_pending` do not.

Lorentsen has clarified the user-facing payment-session contract: one Tian Min order may own multiple durable provider attempts/QRs while retaining exactly one entitlement and one report. Each explicit Pay/New QR action creates a fresh attempt with its own external order and idempotency key only when no current user payment session exists. Cancel ends only the Tian Min user session (no provider cancellation); server-side 15-minute expiry or authoritative `expires_at` makes the QR session replaceable. Old provider attempts remain auditable and reconcilable but never restore a cancelled/expired QR. A late authenticated `settled` still idempotently authorizes the original order, and multiple settled attempts are recorded as an anomaly without automatic refund logic.

Historical `manual_review` attempts without a usable payment method are migrated out of the current user session and no longer lock the offer; their provider history remains intact. Earlier `399 RUB` attempts were rejected before payment creation with HTTP `422` / `amount_out_of_range`; they received no `payment_public_id` or payment method. On 2026-08-13, the authenticated Tian Min partner quote form accepted an exact `100 RUB`, displayed `Клиент оплатит 100,00 ₽` and enabled link generation without a form submission. This account-level read-only check supersedes the old minimum for pricing eligibility, but the production payment flow is not considered end-to-end validated until one controlled payment reaches authenticated `settled`.

Promo Codes v1 is server-owned and bound to one exact order/report. `FAMILY0` targets `0 RUB` and creates an atomic `complimentary_promo` entitlement without a provider payment and without setting `PAID`. It has an expiry, active toggle and redemption limit. `FRIEND100` (`100 RUB`) and `SUPPORT399` (`399 RUB`) are active paid promos after the account-level `100 RUB` quote verification. They retain the normal Lorentsen checkout and authenticated `settled` requirement; applying a promo or starting a payment never grants Premium. Promo application, payment attempts, settlement and complimentary entitlement creation are stored as separate events.

## Deployment and persistence

- Source repository: `eteroganezov/tian-min`, branch `main`.
- Railway deployment support is implemented: root `package.json` enables Node detection; the web server honors deployment host/port; Railway uses the repository with the web application and PostgreSQL persistence.
- Production Lorentsen configuration and secret requirements are documented in `web/LORENTSEN_DEPLOYMENT.md`.
- Local DEV orders/reports use ignored filesystem stores; production Lorentsen records use PostgreSQL.
- Secrets belong only in environment/deployment secret storage and must never enter Git, logs or frontend payloads.

Production OpenAI configuration, immutable PostgreSQL semantic-report persistence, deterministic PDF re-render and Railway Unicode/CJK font support are deployed. The real complimentary `FAMILY0` path has completed successfully. The paid path remains architecturally tested but is **not verified with real money** until a controlled `FRIEND100` attempt reaches authenticated Lorentsen `settled`; `SUPPORT399` and the normal `599 RUB` path are likewise not yet real-payment verified. A separate old `manual_review` attempt remains blocked on authoritative provider clarification.

## First-user product research

The first two users showed that the technical-first Variant A created excessive cognitive load: people saw many professional calculated values before understanding why they mattered, what they meant personally or what additional value Premium would provide. Variant B therefore follows:

**PERSONAL MEANING → TRUST / CALCULATION PROOF → PREMIUM VALUE → TECHNICAL DETAILS ON DEMAND.**

Repeated feedback shows that users do not understand terms such as Four Pillars, Heavenly Stem / Earthly Branch, Ten Gods, «Грабитель богатства», «Семь убийц», Four Transformations, palace age ranges and traditional Chinese labels without context. Emotionally loaded traditional terms may be interpreted literally. Free should not try to teach the whole field of Chinese metaphysics: technical terminology is a secondary, progressively disclosed professional layer, while Premium explains combinations and personal meaning.

The underlying questions are: **«Что это означает лично для меня? Почему это важно? На что обратить внимание? Как это связано с отношениями, работой, деньгами и текущим жизненным этапом?»** The product should offer actionable reflection, focus and practical orientation—not deterministic commands to divorce, relocate, have children, change a name, place an object or plant, or make major life decisions solely from the chart.

## Product and engineering decisions

- BaZi and Zi Wei are calculated independently and combined only as one interpreted portrait.
- Free calculation remains free; Premium is a separate one-time personal interpretation plus PDF.
- Public Premium price is 599 RUB and remains server-controlled; 100/399 RUB are paid promo prices only.
- Frontend state can never prove payment or set `PAID`.
- Reports must be evidence-backed; unsupported predictive claims are rejected rather than softened into apparent facts.
- Ready reports must be persisted and reused; retries after generation failure must not require another payment or unnecessary AI call.
- WEB visual v1 and Premium PDF v4 are frozen; change either only for a material requirement, objective regression or concrete user feedback.
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
- OpenAI Responses API for legitimate real Premium generation;
- `pdfkit` and fonts available to the runtime for PDF generation;
- Railway for the current production deployment.

See `BACKLOG.md` for the current NOW / BLOCKED / NEXT / LATER / DONE status.
