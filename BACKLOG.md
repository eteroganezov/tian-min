# Backlog

## NOW

- Validate the frozen personal-first Free Result Variant B with the next 3–5 users. Observe without active prompting: whether the first personal points make sense, whether the result feels personally calculated, whether users reach the Premium CTA unaided and how long it takes, whether they ask «что это значит?», whether they open technical details, whether Free vs Premium is clear, whether they apply a promo unaided, and whether they select Exact or Approximate and why. Do not make further subjective frontend iterations without repeated feedback, an objective bug or conversion/analytics evidence; do not claim conversion improvement from the first two users.
- Prepare one separately authorized controlled real-payment test with `FRIEND100`: `100 RUB` → one Lorentsen attempt → QR/link confirms `100 RUB` → user pays manually → authenticated GET `settled` → internal `PAID` → generation → semantic persistence → PDF → secure open/download. Until this happens, the paid path is architecturally tested but **not verified with real money**; `SUPPORT399` and normal `599 RUB` are also not real-payment verified.
- Research birth-time certainty over the next 5–10 users by asking: «Почему вы выбрали примерное время, а не точное?» Determine whether users genuinely lack an exact time or whether wording/UI creates doubt. The current logic remains unchanged.

## BLOCKED / WAITING

- **BLOCKED BY PROVIDER CLARIFICATION:** an old production payment can remain `manual_review` with `payment_method=null` and `expires_at=null`. Obtain authoritative Lorentsen answers: (1) can it later become `settled`; (2) when is it definitively unusable; (3) when is a replacement payment allowed; and (4) which API status/field is the authoritative signal. Do not fake-expire it, use the browser clock or create a second active payment.
- Lorentsen account profile still exposes the external organization label `Edward`; request a provider-side rename to `Тянь Мин`. Tian Min-controlled checkout copy already uses the canonical product name.
- Independent specialist verification remains required for the explicitly skipped Zi Wei star/bureau/period cases, late 子-hour school rule and selected `TRUE_SOLAR_TIME_V1` astrological references.

## P1

- **Birth Date Input UX:** both first users had difficulty quickly selecting a birth year decades in the past. After Variant B tests, research native-first day/month/year controls, manual `DD.MM.YYYY` entry, fast year selection, iOS, Android, desktop and accessibility. Do not build a custom wheel without demonstrated need.
- Transactional email delivery, a secure recovery link, cross-device report recovery and clear report-delivery UX. Same-browser recovery exists; do not promise email delivery before implementation.

## NEXT

- Add privacy-safe funnel analytics after the Variant B retest: `calculation_started`, `calculation_completed`, `premium_viewed`, `promo_applied`, `checkout_started`, `payment_started`, `settled`, `generation_started`, `report_ready`, `report_opened`, `report_downloaded`. Never collect birth data, email, report content or other PII. Promo/campaign attribution is allowed.
- Run production pre-launch QA across mobile/desktop, payment recovery, report generation, PDF download, direct API protection, browser console, horizontal overflow and Unicode/replacement glyphs.
- Perform the final commercial `LICENSE`/`NOTICE` and dependency-license audit; retain required Yiqi and `lunar-typescript` attribution in distributed artifacts.

### Product foundation

- Chinese-symbol color language: first audit stems/branches, palace markers, transformations and personal Chinese signs on ivory and deep-jade surfaces; then extend the existing muted-red cultural accent selectively. Red must not imply error, success, good or bad, and Chinese text must not be recolored globally.
- Report storage optimization: measure PostgreSQL semantic-artifact size, PDF render CPU and retention needs before considering immutable PDF object storage. An already purchased report must never require OpenAI regeneration.
- Add a PDF compatibility CTA («Хотите сравнить карту с близким человеком?») only after the compatibility product exists; do not add a dead CTA.

Brand architecture note: brand `Tian Min / Тянь Мин`, Chinese wordmark `天命`, standalone symbol and favicon candidate `命`, primary site lockup `[命] ТЯНЬ МИН 天命`. No current logo change is authorized by this backlog note.

## LATER

- Measure and control the real OpenAI cost per Premium report after paid generation is enabled.
- Revisit optional product improvements only after launch evidence; WEB visual v1 remains frozen unless a material defect or new product requirement is documented.
- Privacy-safe share card with native mobile share / desktop copy-link, Tian Min branding and no birth data, payment/order IDs or full report in a public URL.
- Compatibility as the first likely repeat/viral product: two deterministic charts plus a dedicated evidence-backed cross-chart comparison architecture, not a single AI prompt over two reports.
- Separate yearly report products such as «Ваш 2027», then later years.
- Gift reports.
- Referral/campaign attribution using future promo codes, referral links and campaign/source records.
- Recurring products or subscription only after real repeat demand is demonstrated.

Do not prioritize these future products ahead of: (1) Variant B user validation; (2) the controlled `FRIEND100` paid E2E; (3) provider clarification for stuck `manual_review`; (4) delivery/recovery/email; and (5) analytics v1.

## DONE

- Deterministic BaZi + Zi Wei core, unified `local-chart.ts`, historical timezone/location pipeline and `TRUE_SOLAR_TIME_V1` integration.
- Local and Railway-ready web application with free calculation and **Global Place Search v3 / GeoNames**, including Russian, English, native and historical place-name search with confirmed canonical coordinates/timezone.
- Mobile-first WEB v1, sticky/Telegram/mobile Safari fixes, final birth-form spacing and `birthTimeCertainty` UX. WEB visual v1 is frozen.
- `birthTimeCertainty: exact | approximate` with default/legacy `exact`, independent from deterministic calculation sensitivity.
- Monetization foundation: public price **599 RUB**, server-owned product config, order state machine, payment gate, persistence/recovery, terminal-payment recovery, idempotency, duplicate-generation protection and production fail-closed behavior.
- Railway deployment structure, PostgreSQL production persistence and Lorentsen provider/webhook integration.
- Lorentsen response parser/recovery for nested payment records, `payment_public_id`, provider status, optional payment method, retry timing and trace ID.
- Premium Report `personal-report-v4`: deterministic evidence catalog, strict Structured Outputs schema, evidence validation, unsupported-claim protection and legacy compatibility.
- Shared **frozen Premium PDF v4** renderer/design system, saved-report compatibility and Railway Unicode/CJK font fix. Further PDF work requires an objective bug/regression or concrete real-user feedback.
- Production incident diagnosed: three `399 RUB` attempts received HTTP `422` / `amount_out_of_range`, without `payment_public_id`, QR or payment link. The server-owned temporary early-user price was restored to the provider-compatible **599 RUB** (`59900` minor units).
- Promo Codes v1: collapsed checkout UX, canonical server validation, loading/applied/double-click feedback, durable promo/event/redemption schema and atomic limited `FAMILY0` complimentary entitlement bound to one order/report.
- Lorentsen `100 RUB` account-level quote verified read-only on 2026-08-13 without link/payment creation. `FRIEND100` (`100 RUB`) and `SUPPORT399` (`399 RUB`) are active paid promos; both retain the normal checkout and authenticated `settled` gate. Promo submission has immediate loading feedback and double-click protection.
- **Free Result Variant B** (personal-first) is deployed at `b31bcbe2494351cb11756c5fe244c174914eb372`. Variant A (technical-first) remains preserved at `34f7358d4e3f1dc704cdfedc9439a9d4ea36920b` and tag `free-result-v1-technical-first`; technical details remain available through progressive disclosure.
- Premium Generation & Delivery v1: production OpenAI configuration, server-verified paid-settled or complimentary access, persisted generation lifecycle and atomic duplicate guard, immutable PostgreSQL semantic report storage, PDF re-render without repeated OpenAI generation, secure open/download, safe retry and same-browser recovery. The first real `FAMILY0` user completed generation, Report v4 validation, semantic persistence, PDF render and report open/download successfully; no PII is recorded here.
- Tian Min favicon set: standalone `命` in deep jade/ivory/gold as SVG, 16×16, 32×32 and Apple Touch Icon assets. The main site logo remains unchanged.
