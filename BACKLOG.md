# Backlog

## NOW

- Complete the separate Premium PDF v4 editorial/product polish, including exact and approximate birth-time review fixtures.
- Finish human review of the generated Premium PDF. Do not mark the PDF finally approved until typography, pagination, chart pages, time-certainty communication and both fixtures are accepted.

## BLOCKED / WAITING

- Lorentsen production payment: the existing authenticated provider state is `manual_review`; no QR/link was issued. Wait for provider resolution and do not create a new real attempt while it remains non-terminal.
- Lorentsen account profile still exposes the external organization label `Edward`; request a provider-side rename to `Тянь Мин`. Tian Min-controlled checkout copy already uses the canonical product name.
- Controlled production payment validation: the flow is not end-to-end proven until a deliberately supervised attempt reaches authenticated GET `settled`. No real payment should be initiated without a separate explicit task.
- Independent specialist verification remains required for the explicitly skipped Zi Wei star/bureau/period cases, late 子-hour school rule and selected `TRUE_SOLAR_TIME_V1` astrological references.
- Promo codes `FRIEND100` (`100 RUB`) and `SUPPORT399` (`399 RUB`) are configured but inactive. The current verified Lorentsen minimum rejects both targets. A planned reduction to `100 RUB` must be verified separately before either code is activated; paid promos still require authenticated `settled`.

## NEXT

- After PDF human approval and Lorentsen resolution, run one controlled production checkout: create/recover payment → provider `requires_action` if supplied → authenticated `settled` → internal `PAID`. Verify webhook/polling/reload/idempotency and that a failed or pending payment never unlocks Premium.
- Run production pre-launch QA across mobile/desktop, payment recovery, report generation, PDF download, direct API protection, browser console, horizontal overflow and Unicode/replacement glyphs.
- Perform the final commercial `LICENSE`/`NOTICE` and dependency-license audit; retain required Yiqi and `lunar-typescript` attribution in distributed artifacts.

### Product foundation

- Chinese-symbol color language: first audit stems/branches, palace markers, transformations and personal Chinese signs on ivory and deep-jade surfaces; then extend the existing muted-red cultural accent selectively. Red must not imply error, success, good or bad, and Chinese text must not be recolored globally.
- Email delivery and purchase recovery research: compare low-cost transactional email options, consent/privacy requirements and secure report links so closing a browser or Telegram does not require a second purchase. Do not promise email delivery before implementation.
- Report storage optimization: measure PostgreSQL semantic-artifact size, PDF render CPU and retention needs before considering immutable PDF object storage. An already purchased report must never require OpenAI regeneration.
- Privacy-safe share card: future native mobile share / desktop copy-link flow with Tian Min branding, one personal Chinese sign, a human label and one short insight. Never expose birth data, payment IDs, order IDs or the full personal PDF in a public URL.
- Add a PDF compatibility CTA («Хотите сравнить карту с близким человеком?») only after the compatibility product exists; do not add a dead CTA.

Brand architecture note: brand `Tian Min / Тянь Мин`, Chinese wordmark `天命`, standalone symbol and favicon candidate `命`, primary site lockup `[命] ТЯНЬ МИН 天命`. No current logo change is authorized by this backlog note.

## LATER

- Add minimal privacy-safe analytics and operational monitoring only after deciding what launch metrics and alerts are actually needed.
- Measure and control the real OpenAI cost per Premium report after paid generation is enabled.
- Revisit optional product improvements only after launch evidence; WEB visual v1 remains frozen unless a material defect or new product requirement is documented.
- Compatibility as the first likely repeat/viral product: two deterministic charts plus a dedicated evidence-backed cross-chart comparison architecture, not a single AI prompt over two reports.
- Separate yearly report products such as «Ваш 2027», then later years.
- Gift reports.
- Referral/campaign attribution using future promo codes, referral links and campaign/source records.
- Recurring products or subscription only after real repeat demand is demonstrated.

## DONE

- Deterministic BaZi + Zi Wei core, unified `local-chart.ts`, historical timezone/location pipeline and `TRUE_SOLAR_TIME_V1` integration.
- Local and Railway-ready web application with free calculation, confirmed-place autocomplete and real free preview.
- Mobile-first WEB v1, sticky/Telegram/mobile Safari fixes, final birth-form spacing and `birthTimeCertainty` UX. WEB visual v1 is frozen.
- `birthTimeCertainty: exact | approximate` with default/legacy `exact`, independent from deterministic calculation sensitivity.
- Monetization foundation: server-owned product config, order state machine, payment gate, persistence/recovery, idempotency, duplicate-generation protection and production fail-closed behavior.
- Railway deployment structure, PostgreSQL production persistence and Lorentsen provider/webhook integration.
- Lorentsen response parser/recovery for nested payment records, `payment_public_id`, provider status, optional payment method, retry timing and trace ID.
- Premium Report `personal-report-v4`: deterministic evidence catalog, strict Structured Outputs schema, evidence validation, unsupported-claim protection and legacy compatibility.
- Shared Premium PDF v4 renderer/design system and saved-report compatibility. Final editorial approval remains in NOW, not DONE.
- Production incident diagnosed: three `399 RUB` attempts received HTTP `422` / `amount_out_of_range`, without `payment_public_id`, QR or payment link. The server-owned temporary early-user price was restored to the provider-compatible **599 RUB** (`59900` minor units).
- Promo Codes v1: collapsed checkout UX, canonical server validation, durable promo/event/redemption schema, atomic limited `FAMILY0` complimentary entitlement bound to one order/report, and inactive configured `FRIEND100`/`SUPPORT399` paid targets.
- Premium Generation & Delivery v1: server-verified paid-settled or complimentary access, persisted generation lifecycle and atomic duplicate guard, immutable semantic report storage, deterministic authorized PDF open/download, safe retry and same-browser recovery. Transactional email and cross-device recovery remain unfinished.
- Tian Min favicon set: standalone `命` in deep jade/ivory/gold as SVG, 16×16, 32×32 and Apple Touch Icon assets. The main site logo remains unchanged.
