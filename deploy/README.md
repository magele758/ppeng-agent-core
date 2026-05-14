# Deployment

## Docker Compose（本地/单机部署）

```bash
# 在仓库根目录准备 .env（复制并填入模型 API key）
cp .env.example .env

# 启动全部服务
cd deploy/compose
docker-compose up --build

# 后台运行
docker-compose up -d --build
```

服务启动后：
- daemon API：http://localhost:7070
- web 控制台：http://localhost:13000

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
| `RAW_AGENT_DAEMON_PORT` | daemon 端口 | `7070` |
| `RAW_AGENT_BASE_URL` | 模型 API base URL | — |
| `RAW_AGENT_API_KEY` | 模型 API key | — |
| `RAW_AGENT_MODEL_NAME` | 模型名称 | — |
| `DAEMON_PROXY_TARGET` | web-console 代理到 daemon 的地址 | `http://daemon:7070` |

## 健康检查端点

- `GET /api/health` — 轻量存活检查，返回 `{ ok: true }`
- `GET /api/readiness` — 就绪检查，验证 stateDir 可写 + SQLite 可访问，返回 `{ ready: true, checks: {...} }` 或 400
