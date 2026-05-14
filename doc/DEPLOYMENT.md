# 部署与上线回归卡点规划

本文定义项目从本地 daemon/Next 运行，演进到可容器化、可 K8s 部署、可回滚、可自闭环运行的最小方案。

## 目标

1. daemon 与 web-console 可以被重复构建、部署、回滚。
2. stateDir / SQLite / images / traces 有明确持久化策略。
3. 发布前 gate 能确认核心闭环仍可运行：会话、工具、self-heal、Evolution、展示站构建。
4. 后续可扩展到 Helm、Ingress、SLO、告警和 SRE 自动诊断。

## 最小部署拓扑

```
client
  -> ingress / service
  -> web-console (Next.js)
  -> /api/* proxy
  -> daemon
  -> state volume (SQLite, traces, images)
  -> optional external services (model API, Prometheus, Loki, PagerDuty)
```

建议先拆成两个容器：

| 组件 | 职责 | 端口 | 持久化 |
|------|------|------|--------|
| `daemon` | HTTP API、scheduler、runtime、self-heal、gateway、domain loader | `7070` | `RAW_AGENT_STATE_DIR` PVC |
| `web-console` | Next.js UI 与 `/api/*` 代理 | `13000` | 无状态 |

## 容器化建议

第一阶段只做生产镜像，不把开发依赖和 workspace 全部带入运行层。

建议文件：

```text
deploy/docker/Dockerfile.daemon
deploy/docker/Dockerfile.web
deploy/compose/docker-compose.yml
```

daemon 镜像需包含：

- `apps/daemon/dist`
- `packages/core/dist`
- `packages/capability-gateway/dist`
- domain packages dist（如 `agent-sre`、`agent-stock`）
- `package.json` / lockfile 中运行时依赖

web 镜像需包含：

- `apps/web-console/.next`
- `apps/web-console/public`
- Next runtime 依赖
- `DAEMON_PROXY_TARGET=http://daemon:7070`

## Helm / K8s 目录建议

```text
deploy/helm/ppeng-agent-core/
  Chart.yaml
  values.yaml
  templates/
    daemon-deployment.yaml
    web-deployment.yaml
    service-daemon.yaml
    service-web.yaml
    ingress.yaml
    secret.yaml
    pvc.yaml
    configmap.yaml
```

最小 values：

```yaml
image:
  daemon: ppeng-agent-core-daemon:latest
  web: ppeng-agent-core-web:latest

state:
  size: 10Gi
  storageClassName: ""

env:
  RAW_AGENT_MODEL_PROVIDER: openai-compatible
  RAW_AGENT_MODEL_NAME: ""
  RAW_AGENT_BASE_URL: ""

secrets:
  RAW_AGENT_API_KEY: ""

web:
  daemonProxyTarget: http://ppeng-agent-core-daemon:7070
```

## Health / readiness

现有 `/api/health` 可作为 liveness 基础，但 readiness 应更严格。

建议新增或扩展 readiness 检查项：

- 进程可响应 HTTP。
- `RAW_AGENT_STATE_DIR` 存在且可写。
- SQLite 可打开并完成简单查询。
- model provider 配置可解析，但不强制真实调用模型。
- gateway config 可读取（如果启用 gateway）。
- domain bundle 加载结果可列出，缺失 env 不应导致 daemon 崩溃。

建议端点：

| 端点 | 用途 |
|------|------|
| `/api/health` | liveness，轻量存活 |
| `/api/ready` | readiness，依赖可用性 |
| `/api/version` | 镜像版本、git sha、build time |

## 上线回归卡点

发布前必须经过 release smoke gate：

```text
candidate
  -> build
  -> unit / integration / e2e
  -> contract / security
  -> deploy staging
  -> health / readiness
  -> loop smoke
  -> release or rollback
```

建议脚本入口：

```bash
npm run build
npm run test:unit
npm run test:integration
npm run test:e2e
npm run release:smoke
```

`release:smoke` 最小检查：

1. `GET /api/health` 返回 ok。
2. `GET /api/ready` 返回 ready。
3. `GET /api/version` 返回版本。
4. 创建一条 heuristic session 并完成一轮无密钥对话。
5. `GET /api/traces` 可读。
6. `GET /api/self-heal/status` 可读。
7. `npm run evolution -- --learn-only` 支持 dry-run 或受控小样本。
8. `npm run evolution:showcase-build` 可构建展示站，不默认 push。

## SQLite 单副本约束

SQLite 不支持多进程并发写入。在 K8s 中 daemon Deployment 必须 `replicas: 1`。如果未来需要水平扩展，须迁移到 PostgreSQL 或其它支持并发写的存储。短期通过单 Pod + PVC 满足需求，不做多副本。

## CI/CD 极简 pipeline

```
git push
  -> CI: build + unit + integration + e2e
  -> docker build & push (daemon + web)
  -> helm upgrade --install (staging namespace)
  -> release:smoke (staging)
  -> 通过 -> helm upgrade (production namespace)
  -> 失败 -> helm rollback + 告警
```

镜像 registry 建议先用 GitHub Container Registry 或私有 Harbor；Helm install 可由 GitHub Actions 或本机 `helm upgrade` 手动触发。

## deploy-smoke 在容器/集群内的注意事项

- `evolution --learn-only`：生产 Pod 可能无 `gateway.config.json` 或无 RSS 网络。建议 release:smoke 中此项改为 **dry-run 模式**（检查脚本可执行、inbox 目录可写），不实际拉 RSS。
- 若 Pod 内无 git（精简镜像），self-heal smoke 只检查 API 可达，不实际启动 worktree。

## 回滚策略

失败时必须保留：

- 镜像 tag / git sha
- Helm release revision
- daemon logs
- web-console logs
- `/api/ready` 失败原因
- release smoke 输出

回滚顺序：

1. 停止自动合并与自动发布。
2. Helm rollback 到上一 revision。
3. 确认 `/api/ready` 和核心 smoke 通过。
4. 将失败记录转为 C 飞轮（SRE 修复）与 H 飞轮（eval 样本）。

## 与 8 飞轮的关系

| 飞轮 | 部署侧作用 |
|------|------------|
| C | 告警、诊断、回滚、自愈 |
| E | secret、RBAC、NetworkPolicy、审计 |
| F | 资源、并发、成本、容量 |
| G | API/SSE/A2UI/MCP 契约不被部署破坏 |
| H | release smoke 与 eval 防止上线即坏 |

