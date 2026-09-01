# Compose 对应的 Kubernetes 清单

与 [`../../compose/docker-compose.k8s.yml`](../../compose/docker-compose.k8s.yml) 同一套拓扑：GHCR `daemon` + `web`，SQLite PVC，daemon Service 名必须是 `daemon`（web 的 `DAEMON_PROXY_TARGET=http://daemon:37070`）。

多副本 / Postgres / Redis / MinIO 请用 Helm chart，不要扩这份清单的 daemon replicas。
