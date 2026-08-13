# Backlog

## Production / Payments

- Production launch price is fixed at **599 RUB** (`59900` minor units), above Lorentsen's confirmed `500 RUB` minimum; keep the server as the price source of truth.
- Подготовить production deployment architecture и публичный HTTPS backend.
- Подключить Railway PostgreSQL и добавить production Lorentsen variables/secrets по `web/LORENTSEN_DEPLOYMENT.md`.
- Создать production client, проверить `GET /connection`, зарегистрировать webhook endpoint и выполнить reachability/signature test.
- Согласовать с Lorentsen публичное partner name `Edward` vs `Тянь Мин` до первого реального платежа.
- Провести production checkout QA: payment → server-confirmed `settled` → `PAID` → разрешение report generation.

## Premium Generation

- Подключить реальную OpenAI generation только после server-confirmed Lorentsen `settled` / внутреннего `PAID`.
- Сохранять готовый premium report и обеспечивать повторный доступ без повторной AI-generation.
- Сохранить retry generation после ошибки без новой оплаты.
- Измерить и контролировать реальную стоимость одного premium report.

## Premium PDF

- В будущей интерпретации времени объединить `birthTimeCertainty` и calculated sensitivity как два независимых сигнала: approximate влияет только на осторожность часозависимых формулировок; legacy missing certainty читать как exact.
- После фиксации web design system провести отдельный visual refresh Premium PDF, приблизив его к финальной premium web design system без буквального копирования web.
- Стр. 3: отполировать типографику и композицию блока «12 дворцов Цзы Вэй».
- Стр. 3: уменьшить вертикальный воздух и проверить spacing блока четырёх трансформаций.
- Стр. 3: исправить декоративную полоску у «Дворца партнёрства и отношений».
- Стр. 32: выровнять блок «Точность времени».
- Стр. 34: убрать или исправить vertical divider между «Делать чаще» и «Чего избегать».
- При future PDF polish проверить оставшиеся clipping/alignment/spacing defects, сохранив calculation content и астрологические данные без изменений.

## Web Polish

Выполнено и удалено из активного backlog: скругления карточек четырёх столпов Ба-цзы и compact metadata chips. В дальнейшем проверять только точечную consistency radius/padding free preview cards при обнаружении реального дефекта, без нового redesign.

## Pre-launch QA

- Desktop и mobile QA в production environment, включая horizontal overflow и browser console.
- Sandbox/test payment и полный payment → report generation → PDF download сценарий.
- Failed payment, failed generation, refresh/recovery, duplicate callback и duplicate click.
- Защита direct API access и подтверждение production fail-closed.
- Проверка русской терминологии, Unicode/replacement glyph scan.
- До запуска принять решение по минимальным analytics и monitoring.
