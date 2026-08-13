# Backlog

## NOW

- Complete the separate Premium PDF v4 editorial/product polish, including exact and approximate birth-time review fixtures.
- Finish human review of the generated Premium PDF. Do not mark the PDF finally approved until typography, pagination, chart pages, time-certainty communication and both fixtures are accepted.

## BLOCKED / WAITING

- Lorentsen production payment: the existing authenticated provider state is `manual_review`; no QR/link was issued. Wait for provider resolution and do not create a new real attempt while it remains non-terminal.
- Lorentsen account profile still exposes the external organization label `Edward`; request a provider-side rename to `Тянь Мин`. Tian Min-controlled checkout copy already uses the canonical product name.
- Controlled production payment validation: the flow is not end-to-end proven until a deliberately supervised attempt reaches authenticated GET `settled`. No real payment should be initiated without a separate explicit task.
- Independent specialist verification remains required for the explicitly skipped Zi Wei star/bureau/period cases, late 子-hour school rule and selected `TRUE_SOLAR_TIME_V1` astrological references.

## NEXT

- After PDF human approval and Lorentsen resolution, run one controlled production checkout: create/recover payment → provider `requires_action` if supplied → authenticated `settled` → internal `PAID`. Verify webhook/polling/reload/idempotency and that a failed or pending payment never unlocks Premium.
- Connect real Premium generation to the existing paid server gate: `settled`/`PAID` → one `personal-report-v4` OpenAI generation → production persistence → reusable web/PDF result. Preserve retry after generation failure without another payment and never regenerate a ready report.
- Run production pre-launch QA across mobile/desktop, payment recovery, report generation, PDF download, direct API protection, browser console, horizontal overflow and Unicode/replacement glyphs.
- Perform the final commercial `LICENSE`/`NOTICE` and dependency-license audit; retain required Yiqi and `lunar-typescript` attribution in distributed artifacts.

## LATER

- Add minimal privacy-safe analytics and operational monitoring only after deciding what launch metrics and alerts are actually needed.
- Measure and control the real OpenAI cost per Premium report after paid generation is enabled.
- Revisit optional product improvements only after launch evidence; WEB visual v1 remains frozen unless a material defect or new product requirement is documented.

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
- Temporary closed early-user Premium price set to **399 RUB** (`39900` minor units), owned by server configuration; the previous 599 RUB test price is not current.
