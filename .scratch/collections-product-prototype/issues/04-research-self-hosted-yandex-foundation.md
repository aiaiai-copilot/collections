# Исследовать self-hosted VPS и Yandex Cloud как фундамент продукта

Type: research
Status: resolved

## Question

Могут ли PostgreSQL + NestJS + SPA на собственном VPS либо в Yandex Cloud лучше удовлетворить требованиям демонстрационного продукта, чем ранее исследованные Supabase и Clerk + Neon, если OpenAPI 3.1 остаётся каноническим внешним Interface, а сравнение учитывает authentication, приватность, migrations, local/preview/test, deployment, backups, восстановление, наблюдаемость, email и полную стоимость владения?

## Answer

[Исследование self-hosted VPS и Yandex Cloud](../../../docs/research/self-hosted-and-yandex-product-foundation.md) подтверждает оба пути как жизнеспособные и разделяет их по операционной модели.

Self-hosted PostgreSQL + NestJS + SPA даёт наименьший прямой денежный счёт и полный контроль, но делает проект ответственным за OTP, обновления, TLS, secrets, off-site WAL/backups, restore drills, monitoring, deployment/rollback и отдельный test target. Yandex Compute VM является тем же вариантом с удобными Postbox/Object Storage/Monitoring.

Управляемый Yandex Cloud снимает runtime/database/email/secrets часть операций через Serverless Containers, Managed PostgreSQL, Postbox и Lockbox. При малой нагрузке backend и SPA дешевы, но Managed PostgreSQL задаёт порядок стоимости. Воспроизводимый ориентир для `s3-c2-m8` — около 5 665 ₽/месяц за один host без SLA либо около 11 330 ₽ за два hosts с высокой доступностью, до дополнительных сервисов; более компактный `c3-c2-m4` нужно отдельно проверить в актуальном calculator. Штатного per-PR database branching не обнаружено, поэтому preview/test isolation нужно проектировать отдельно.

NestJS подходит как HTTP Adapter, но OpenAPI 3.1 должен остаться spec-first source of truth: decorator-generated Swagger является только проверяемой производной.

Дополнительное сравнение VPS-провайдеров исключает Yandex Compute из ценовой таблицы и сопоставляет Selectel, Beget и Timeweb. При одинаковой политике независимых PostgreSQL backup/WAL расчёт даёт около 688 ₽, 1 178 ₽ и 1 388 ₽ за 30 дней соответственно; Beget использует ближайший фиксированный тариф с 40 ГБ вместо 50 ГБ. Selectel дешевле, но Beget даёт более сбалансированную базу за счёт включённых файловых бэкапов, мониторинга, DNS и private network.

Пользователь зафиксировал Beget как промежуточный выбор для self-hosted PostgreSQL + NestJS + SPA. Точные границы решения и условия пересмотра записаны в ticket [«Выбрать технический фундамент демонстрационного продукта»](01-choose-product-foundation.md).
