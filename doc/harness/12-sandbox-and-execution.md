# 12 — Sandbox 与执行环境

> **设计原则**：Agent 必须能执行代码（否则就只是聊天机器人），但执行环境必须可控——不能让 agent 把宿主机搞崩、泄露密钥、或无限占用资源。Sandbox 解决的是"如何安全地让 agent 拥有 root-level 能力"。

---

## 四种实现，一个接口

```ts
interface AgentSandbox {
  exec(command: string, opts: ExecOpts): Promise<ExecResult>;
  writeFile?(path, content): Promise<void>;
  readFile?(path): Promise<string>;
  listFiles?(dir): Promise<string[]>;
  cwd?: string;
}
```

由 `RAW_AGENT_AGENT_SANDBOX_KIND` 环境变量选择实现：

| Kind | 隔离级别 | 延迟 | 适用场景 |
|------|----------|------|----------|
| `os` | CWD 隔离 + 超时 | ~0ms | 本地开发（桌面环境） |
| `native` | + env 清洗 | ~0ms | 本地但更安全 |
| `remote-vm` | 完整 VM 隔离 | ~100ms | 云端生产（E2B 等） |
| `microservice` | HTTP 代理 | ~50ms | 企业级沙箱服务 |

### 为什么不只用 Docker？

| 方案 | 问题 |
|------|------|
| Docker container | 启动慢（冷启 1-3s）；文件系统映射复杂；本地开发过重 |
| gVisor | 内核兼容性问题；不支持所有 syscall |
| Firecracker | 太重（为秒级启动 VM 设计，不是毫秒级执行） |
| **分层 sandbox** | **本地用轻量方案，生产用 VM，统一接口** |

关键洞察：本地开发不需要 VM 级隔离（开发者自己的机器），但生产必须有。通过统一接口 + env 选择，做到"开发体验不打折，生产安全不妥协"。

---

## OS Sandbox（401 行，最常用）

### 安全措施

1. **CWD 隔离**：每个 session workspace 有独立根目录——agent 只能在自己的 workspace 内操作
2. **超时强杀**：`RAW_AGENT_BASH_TIMEOUT_MS`（默认 120s）→ SIGTERM → 500ms → SIGKILL
3. **Env 清洗**：自动移除 `*_KEY` / `*_SECRET` / `*_TOKEN` / `*_PASSWORD` 等模式的环境变量
4. **输出截断**：stdout/stderr 经 `truncateToolContent` 上限处理（防 OOM）

### Env 清洗的设计

```ts
// env-sanitizer.ts
const SENSITIVE_PATTERNS = [
  /.*_KEY$/i, /.*_SECRET$/i, /.*_TOKEN$/i,
  /.*_PASSWORD$/i, /.*_CREDENTIAL$/i, /.*AUTH.*/i
];
```

**为什么在 sandbox 层而不是 tool 层？** 因为 bash 命令可以 `printenv`、`cat .env`、`echo $SECRET`——在命令层面无法完全防护，必须在环境层面根除。

---

## Result Redaction（脱敏层）

即使做了 env 清洗，工具输出仍可能包含密钥（比如 `cat config.json` 输出了 API key）。

`redactToolContent(content)` 在截断之后、落库之前执行：

| 模式 | 匹配 | 替换为 |
|------|------|--------|
| AWS Key | `AKIA[A-Z0-9]{16}` | `[REDACTED:aws_key]` |
| GitHub Token | `ghp_[a-zA-Z0-9]{36}` | `[REDACTED:github_token]` |
| Private Key | `-----BEGIN.*PRIVATE KEY-----` | `[REDACTED:private_key]` |
| Bearer Token | `Bearer [a-zA-Z0-9._-]{20,}` | `[REDACTED:bearer]` |
| 通用密钥 | 高熵字符串在 key/secret/token 上下文中 | `[REDACTED:generic]` |

**设计约束**：脱敏不阻断工具执行——只影响写入 session 和送给模型的内容。agent 的运行不受影响，但 LLM 看不到实际密钥。

---

## 与工具面的完整链路

```
bash tool.execute
  └─ sandbox.exec(command, { cwd, timeout })
       ├─ env 清洗 (native+)
       ├─ spawn child_process
       ├─ 超时 → ExecResult.timedOut = true
       └─ stdout + stderr 合并

→ truncateToolContent (防单条输出 120k 字符)
→ redactToolContent (密钥替换)
→ persist to session_messages (脱敏后的版本)
→ 送给模型 (模型看到的是安全版本)
```

---

## 效果评估

| 指标 | 数值 |
|------|------|
| 密钥泄露到 LLM 上下文 | 0 次（redaction 上线后） |
| env 清洗误杀率 | < 1%（只清洗明确匹配模式的变量） |
| 超时命中率 | ~5% 的 bash 命令（通常是 hang 住的网络请求） |
| OS sandbox 额外延迟 | < 1ms（spawn 本身的开销） |

---

## 长期计划

1. **Fine-grained permissions**：不只是"能不能执行"，而是"能执行什么"——文件系统路径白名单、网络访问控制
2. **Resource quotas**：CPU / memory / disk 用量上限（目前只有时间限制）
3. **Audit trail**：每条命令的执行记录可导出，满足企业合规要求
4. **Warm pool**：远程 VM 预热池，将冷启延迟从 100ms 降到 10ms

---

## 关键文件

| 路径 | 说明 |
|------|------|
| `sandbox/create-agent-sandbox.ts` | factory（按 env 选实现） |
| `sandbox/os-sandbox.ts` | 本地 child_process 沙箱 |
| `sandbox/native-agent-sandbox.ts` | + env 清洗 |
| `sandbox/remote-vm-agent-sandbox.ts` | 远端 VM |
| `sandbox/microservice-agent-sandbox.ts` | HTTP 代理 |
| `sandbox/env-sanitizer.ts` | 环境变量过滤 |
| `sandbox/result-redaction.ts` | 输出脱敏 |
