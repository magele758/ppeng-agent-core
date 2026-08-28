# Deployment

## Docker Compose（本地/单机部署）

```bash
# 在仓库根目录准备 .env（复制并填入模型 API key）
cp .env.example .env

# 启动全部服务（本机 build）
cd deploy/compose
docker-compose up --build

# 后台运行
docker-compose up -d --build
```

服务启动后：
- daemon API：http://localhost:37070
- web 控制台：http://127.0.0.1:33815

## Docker Compose（GHCR / Kubernetes）

拉每日镜像、不在集群里 build。对应清单：`k8s/compose/`（`kubectl apply -k`）。

```bash
cd deploy/compose
cp .env.k8s.example .env.k8s
# 可选：填 RAW_AGENT_AUTH_TOKEN；模型建议进 Lab，不必写进 env
docker compose --env-file .env.k8s -f docker-compose.k8s.yml up -d
```

```bash
# K8s：namespace ppeng，web 为 NodePort，daemon 仅 ClusterIP
kubectl apply -k deploy/k8s/compose

# 可选密钥（Lab 未配置时的模型回退 / 同源鉴权）
kubectl -n ppeng create secret generic ppeng-runtime \
  --from-literal=RAW_AGENT_AUTH_TOKEN= \
  --from-literal=RAW_AGENT_API_KEY= \
  --from-literal=RAW_AGENT_BASE_URL= \
  --from-literal=RAW_AGENT_MODEL_NAME=

# 私有 GHCR 时再加 imagePullSecret，见 GitHub Packages 登录文档
# 换 tag：在 kustomization.yaml 改 images[].newTag，或
# kubectl -n ppeng set image deploy/daemon daemon=ghcr.io/magele758/ppeng-agent-core/daemon:latest
```

`kompose convert -f deploy/compose/docker-compose.k8s.yml` 也能转，但仓库已带一份等价 YAML，不必先装 kompose。

daemon **必须 1 副本**（SQLite）。PG/Redis/MinIO 多副本请用 Helm。

## Dockerfiles

| 文件 | 用途 |
|------|------|
| `docker/Dockerfile.daemon` | 多阶段构建 daemon，生产镜像仅含 dist + 运行时依赖 |
| `docker/Dockerfile.web` | 多阶段构建 Next.js standalone 输出，生产镜像约 200MB |

单独构建镜像：

```bash
# 在仓库根目录执行（build context 为根目录）
docker build -f deploy/docker/Dockerfile.daemon -t ppeng-daemon .
docker build -f deploy/docker/Dockerfile.web    -t ppeng-web .
```

## Helm Chart（Kubernetes）

```bash
# 安装
helm install ppeng ./deploy/helm/ppeng-agent-core \
  --set secret.rawAgentApiKey=<YOUR_KEY> \
  --set secret.rawAgentBaseUrl=<YOUR_BASE_URL> \
  --set secret.rawAgentModelName=<YOUR_MODEL>

# 升级
helm upgrade ppeng ./deploy/helm/ppeng-agent-core

# 卸载
helm uninstall ppeng
```

默认 values（`values.yaml`）使用 `ClusterIP` Service、5Gi PVC 存储 agent state。
生产环境建议用 Ingress 暴露 web service。

## 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `RAW_AGENT_STATE_DIR` | SQLite 和 trace 文件存储路径 | `.agent-state/` |
| `RAW_AGENT_DAEMON_HOST` | daemon 监听地址（容器内需设为 `0.0.0.0`） | `127.0.0.1` |
| `RAW_AGENT_DAEMON_PORT` | daemon 端口 | `37070` |
| `RAW_AGENT_BASE_URL` | 模型 API base URL | — |
| `RAW_AGENT_API_KEY` | 模型 API key | — |
| `RAW_AGENT_MODEL_NAME` | 模型名称 | — |
| `DAEMON_PROXY_TARGET` | web-console 代理到 daemon 的地址 | `http://daemon:37070` |

## 健康检查端点

- `GET /api/health` — 轻量存活检查，返回 `{ ok: true }`
- `GET /api/readiness` — 就绪检查，验证 stateDir 可写 + SQLite 可访问，返回 `{ ready: true, checks: {...} }` 或 400
