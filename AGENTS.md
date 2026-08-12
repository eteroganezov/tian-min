# Codex instructions

## Before work

- Read `PROJECT_CONTEXT.md` and `BACKLOG.md`.
- Check `git status`, then verify the current architecture in code instead of assuming it.
- Keep the requested scope narrow. Do not bundle unrelated product stages.

## Protected calculation core

Unless the user explicitly requests calculation changes, do not modify:

- the calculator core or `local-chart.ts`;
- `TRUE_SOLAR_TIME_V1`, historical-time handling, coordinates or timezone calculation;
- BaZi or Zi Wei calculation algorithms.

UI, payment, report and deployment work must leave this core unchanged.

## Separate Premium PDF layer

Premium PDF has its own backlog. Do not change it during unrelated web, payment, backend or deployment work. Treat PDF polish as a separate stage.

## API cost safety

- Default to **zero real OpenAI API calls**. Real generation requires an explicit task need.
- Reuse persisted reports and recovery paths; never regenerate an existing report without necessity.
- Never spend API balance on visual or layout QA.

## Payment safety

- Default to **zero real payments** and use DEV/mock flow where possible.
- A browser redirect or frontend flag never proves payment. Frontend must not set `PAID`.
- Premium generation requires server-confirmed payment. Production must fail closed.
- Never expose or commit production payment credentials.

## Secrets

Never commit API keys, bearer tokens, webhook signing secrets, passwords or production credentials. Use environment variables and the deployment platform's secret storage.

## Testing and runtime QA

- After meaningful executable changes, run relevant/full tests and the production build; report pass/fail/skipped and regression coverage.
- If Codex cannot access `localhost`, record that limitation; automated tests/build are still required.
- Node caches backend modules. After backend changes, stop the old server and start a fresh `npm start` before runtime QA. Confirm the old process did not survive with `EADDRINUSE`.

## Commits

Keep major stages in separate commits. For a completed stage: tests/build, commit, then `git status`. Do not commit when the user did not request or imply it.
