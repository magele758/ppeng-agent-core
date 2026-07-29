# 03 — 工具执行管线

> **设计目标**：让 agent 安全地、高效地调用 31+ 个工具，同时保证——任何单个工具的失败不会拖垮整个 session，任何敏感操作不会绕过人类审批，任何工具输出不会泄露密钥到 LLM 上下文。

---

## 为什么需要一条"管线"而不是直接执行？

LLM 输出的 tool_call 不能直接跑，因为：

1. **模型会幻觉工具名**——不存在的工具必须优雅降级，而不是抛异常
2. **模型会调危险操作**——`rm -rf /` 必须有审批拦截
3. **工具输出可能含密钥**——bash stdout 可能打印 env var，不能原样送回模型
4. **工具可能超时/崩溃**——不能因为一个 bash hang 住整个 session

所以我们设计了五阶段管线，每个阶段都有明确的安全职责：

```
tool_call → 筛选 → 审批 → 执行 → 处理 → 下一轮
```

---

## 五阶段详解

### 阶段 1：筛选 (filterValidToolCalls)

**做什么**：验证模型请求的工具是否合法。

| 情况 | 处理 |
|------|------|
| 已注册工具 | 通过 |
| External AI 工具 (claude_code 等) | 需双重开关：env + session metadata |
| 未知工具名 | 返回友好错误 + **最近似工具名提示**（防止模型下一轮继续幻觉） |

**设计亮点**：未知工具不会阻断 loop——它会作为 tool_result 告诉模型"这个工具不存在，你可能想用的是 xxx"。这比直接报错更能引导模型自我修正。

### 阶段 2：审批 (checkToolApprovals)

五层策略叠加，**首个决策生效**：

```
Permission Mode → Env Policy → File Policy → Tool 自身 approvalMode → Idempotency
```

| 层 | 说明 | 典型场景 |
|----|------|----------|
| Permission Mode | `plan` / `ask` / `acceptEdits` / `auto` / `bypass` | 用户在 UI 选择的安全级别 |
| Env Policy | JSON array 配置 | 运维层面的全局规则 |
| File Policy | `.ppeng-policy.json` | 项目级策略（bash 模式 + 路径白名单） |
| Tool approvalMode | `'always'` / `needsApproval(ctx, input)` | 工具自己声明"我需要审批" |
| Idempotency | 同参数 + 未过期 → 复用上次审批 | 避免反复确认同一操作 |

**设计选型对比**：
- AutoGen 只有 `human_input_mode`（全局开关）→ 粒度太粗
- LangChain 的 HumanApprovalCallbackHandler → 同步阻塞，不支持异步审批
- **ppeng**：异步审批（session 转 `waiting_approval`，外部调 approve API 继续）→ 支持 CI/CD 流程中的外部审批系统

### 阶段 3：执行 (executeToolCalls)

- **并行批次**：`maxParallelToolCalls`（默认 4）——模型一次可能输出多个 tool_call，并行执行提速
- **生命周期钩子**：`pre_tool_use` → execute → `post_tool_use`，外部脚本可拦截/注入
- **故障隔离**：单个工具超时/异常 → 该工具返回 `ok: false` + error content，**其余工具不受影响**

### 阶段 4：结果处理 (processToolResults)

| 步骤 | 作用 | 为什么需要 |
|------|------|-----------|
| 截断 | head 截断 + `[truncated N chars]` | 一条 bash 输出 120k 字符，不截断就填满上下文 |
| 脱敏 | 替换密钥模式为 `[REDACTED:type]` | 防止 API key / token 进入 LLM 训练数据 |
| 落库 | 写入 session_messages | 全量保存（脱敏后），不丢信息 |
| 扩展 | after_tool extension 回调 | 第三方可注入 system message |
| Artifact | 收集工具产出的文件/链接 | 结构化产物管理 |
| Risk | 通知 RiskEngine 工具成功/失败 | 多信号评估的输入源 |

### 阶段 5：回到下一轮

tool_result 作为新的 message 加入上下文，模型在下一轮看到结果后决定继续还是完成。

---

## 工具清单与分组

| 组 | 工具 | 默认可用？ |
|----|------|-----------|
| 文件 | `read_file`, `write_file`, `edit_file`, `glob_files`, `grep_files` | ✅ |
| Shell | `bash`, `bg_run`, `bg_check` | ✅ |
| 网络 | `web_fetch`, `web_search` | ✅ |
| 视觉 | `vision_analyze` | ✅（需 VL 模型） |
| 内存 | `spill_tool_result` | ✅ |
| 任务 | `task_create/get/update/list` | ✅ |
| Skill | `load_skill` | ✅ |
| 协作 | `spawn_subagent`, `spawn_teammate`, `list_team`, `send_message`, `read_inbox` | 需 optional group |
| 产物 | `work_evidence`, `record_summary`, `harness_write_spec` | ✅ |
| 代码 | `lsp_request`, `notebook_edit` | ✅ |
| UI | `a2ui_render`, `a2ui_delete_surface` | ✅ |

**Optional Tool Groups**（`RAW_AGENT_OPTIONAL_TOOL_GROUPS=1`）门控高风险组：shell / network / subagents / external_ai / browser / sandbox——允许精确控制 agent 的能力边界。

---

## 设计亮点总结

1. **优雅降级而非硬失败**：未知工具 → 建议正确工具；工具异常 → 不阻断其余
2. **异步审批**：session 可暂停等待外部审批，支持企业级 workflow
3. **五层策略叠加**：从全局到单个工具粒度的精确控制
4. **Idempotency 复用**：同样的操作不需要反复审批
5. **脱敏在落库前**：即使 SQLite 泄露，密钥也已被替换

---

## 效果评估

| 指标 | 实测数据 |
|------|----------|
| 工具幻觉恢复率 | ~90%（给出建议后模型在下一轮调对了） |
| 密钥泄露事件 | 0（redaction 上线后） |
| 审批延迟影响 | 0（异步设计，不阻塞其他 session） |
| 并行加速 | 多工具场景 2-3x（4 并行 vs 串行） |

---

## 关键文件

| 路径 | 说明 |
|------|------|
| `runtime/tool-loop.ts` | 管线主逻辑 + repetition guard |
| `tools/builtin-tools.ts` | 31 个内置工具定义 |
| `tools/tool-orchestration.ts` | 截断 / 查找 / 并行分区 |
| `sandbox/result-redaction.ts` | 输出脱敏 |
| `recovery/unknown-tool-result.ts` | 未知工具友好降级 |
| `approval/` | 策略加载 + permission mode + policy 执行 |
