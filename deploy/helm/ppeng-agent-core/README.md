# ppeng-agent-core Helm chart

Multi-replica daemon preset (optional): enable `postgresql` / `redis` / `minio` in values and merge `values-production-example.yaml`. Default `values.yaml` keeps **single PVC + single daemon** (backward compatible).

## First install

1. Apply SQL DDL once against Postgres when using `EVENT_BUFFER_PROVIDER=redis_postgres` or `SKILL_REGISTRY_PROVIDER=pg_redis`:

   `packages/core/src/storage/migrations/pg/001_initial.sql`

2. **Local / legacy chart:** defaults need no extra services.

3. **Cloud stack:** `helm upgrade --install ppeng ./deploy/helm/ppeng-agent-core -n ppeng --create-namespace -f deploy/helm/ppeng-agent-core/values-production-example.yaml`

Daemon reads `DATABASE_URL`, `REDIS_URL`, and `RAW_AGENT_S3_*` from `*-runtime-env` Secret when subsystems are enabled.

## GitOps / production notes

- Manage chart values in Git; inject secrets via your cluster secret store (SealedSecrets, External Secrets, etc.) rather than committing `runtime-secret` passwords.
- Schedule Postgres backups (logical `pg_dump` or operator); MinIO volume snapshots; Redis is cache-only by default.
- See `values-production-example.yaml` for a stricter starting overlay.
