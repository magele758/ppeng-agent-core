# 12 — Sandbox 与执行环境

工具（尤其 `bash`）在沙箱内执行，防止 agent 失控。四种实现按 env 选择。

---

## 选择逻辑 (`sandbox/create-agent-sandbox.ts`)

```ts
RAW_AGENT_AGENT_SANDBOX_KIND → 'os' | 'native' | 'remote-vm' | 'microservice'
```

| Kind | 实现 | 场景 |
|------|------|------|
| `os` | `os-sandbox.ts` | 本地桌面——用 cwd 隔离 + 超时 |
| `native` | `native-agent-sandbox.ts` | 同 os 但额外 env 清洗 |
| `remote-vm` | `remote-vm-agent-sandbox.ts` | 云上隔离虚拟机（E2B 等） |
| `microservice` | `microservice-agent-sandbox.ts` | HTTP 代理到外部 sandbox 服务 |

---

## AgentSandbox 接口 (`sandbox/agent-sandbox-types.ts`)

```ts
interface AgentSandbox {
  exec(command: string, opts: ExecOpts): Promise<ExecResult>;
  writeFile?(path: string, content: string): Promise<void>;
  readFile?(path: string): Promise<string>;
  listFiles?(dir: string): Promise<string[]>;
  cwd?: string;
}

interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut: boolean;
}
```

---

## OS Sandbox (`os-sandbox.ts`, 401 行)

最常用的本地实现：

1. **CWD 隔离**：每个 session workspace 有独立根目录
2. **超时**：`RAW_AGENT_BASH_TIMEOUT_MS`（默认 120s）
3. **Env 清洗** (`env-sanitizer.ts`)：移除 `*_KEY` / `*_SECRET` / `*_TOKEN` 等模式
4. **输出截断**：stdout/stderr 经 `truncateToolContent` 上限处理
5. **异步 kill**：超时后 SIGTERM → 500ms → SIGKILL

---

## Result Redaction (`sandbox/result-redaction.ts`)

工具输出（尤其 bash stdout）可能泄露密钥。`redactToolContent(content)` 在截断之后、落库之前跑：

- 正则匹配常见密钥模式（AWS key / GitHub token / private key / bearer token）
- 替换为 `[REDACTED:<type>]`
- 不阻断工具执行——只影响写入 session 和送给模型的内容

---

## 与工具面的关系

```
bash tool.execute
  └─ sandbox.exec(command, { cwd, timeout })
       ├─ 超时 → ExecResult.timedOut = true
       ├─ 成功 → stdout + stderr 合并
       └─ 返回 content string

→ truncateToolContent → redactToolContent → persist
```

---

## Optional Tool Groups 门控

`sandbox` 组默认关闭。需 `RAW_AGENT_OPTIONAL_TOOL_GROUPS=1` + `DEFAULT_ENABLED_OPTIONAL_GROUPS` 含 `sandbox` 才暴露。

---

## 关键文件

| 路径 | 说明 |
|------|------|
| `sandbox/create-agent-sandbox.ts` | factory（按 env 选实现） |
| `sandbox/os-sandbox.ts` | 本地 child_process 沙箱 |
| `sandbox/native-agent-sandbox.ts` | native + env 清洗 |
| `sandbox/remote-vm-agent-sandbox.ts` | HTTP → 远端 VM |
| `sandbox/microservice-agent-sandbox.ts` | HTTP → 微服务 |
| `sandbox/env-sanitizer.ts` | env var 过滤 |
| `sandbox/result-redaction.ts` | 输出脱敏 |
