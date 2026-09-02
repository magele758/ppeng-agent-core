# 工具结果占位：进度与分 Agent 开发计划

| 字段 | 值 |
|------|----|
| 状态 | 核心已合入；页面真测与评测种子未完 |
| 日期 | 2026-09-02 |
| 已合入 | [#19](https://github.com/magele758/ppeng-agent-core/pull/19) `fe1fbaf` |
| 对照 | [CONTEXT_COMPILER.md](CONTEXT_COMPILER.md) §7、[harness/04-context-economics.md](harness/04-context-economics.md) |
| 并行会话 | [工具调用结果占位](https://cursor.com/agents/bc-a090428a-2da3-41a9-b9ae-1035361bcf5a)（仍在跑 A/B 种子） |

---

## 1. 结论：开发完了没有？

**运行时占位：完了（下一轮生效）。从页面验证效果：没完。**

对话区仍渲染落库 transcript（全文 `tool_result`）。占位只发生在送给模型的视图里，Lab 默认看不见。开关能保存，不等于能在页面上确认「模型下一轮吃的是占位」。

Chat Completions **做不到**「模型开始吐字的同时挖掉本轮 KV」。用户原话是中途抽离；实现只能对**之后的轮次**改视图。这点写死，不再当未完成 bug。

---

## 2. 你点名要过的功能（对照）

来源：并行 Agent「工具调用结果占位」的用户跟进（2026-09-02）。

| # | 原话要点 | 状态 | 落点 |
|---|---------|------|------|
| 1 | 工具结果先给模型，模型开始吐下一轮后再从主会话抽走 | **部分完成** | 下一轮 `prepareView` 里占位；不是吐字中途 |
| 2 | 只用「这里曾经有一个工具调用」占位 | **完成** | `micro-compact.ts` 占位行；不改 SQLite |
| 3 | 压上下文且尽量不影响效果 | **未证完** | 离线实验有；真模型 A/B 种子太玩具 |
| 4 | 同类论文 | **完成** | 该会话综述；本仓 `CONTEXT_COMPILER.md` |
| 5 | 加进本仓库 + **web-ui 开关方便测试** | **开关完成 / 页面看效果未完** | `CompactSettingsCard`（更多 + 对话区）；`GET/PATCH /api/compact/settings` |
| 6 | 真模型对比、密钥不进对话/PR | **完成** | `npm run test:compact-ab`；Actions 用 repo Secrets |
| 7 | 三方 key 怎么配 | **完成** | Lab「更多 → 模型服务商」优先，`.env` 回退 |
| 8 | 加 Compact A/B action | **完成** | `.github/workflows/compact-ab.yml` |
| 9 | action 不要每次都跑，手动触发 | **完成** | 仅 `workflow_dispatch` |
| 10 | 评测 tool 太简单，返回的是什么？ | **未完成** | 现为 `BEGIN_DUMP` + `SECRET_TOKEN` + 一串 `x` |

默认策略仍是 `keep_recent`（与现网一致）。实验档：`after_text_assistant`（推荐）、`after_any_assistant`（更激进）。策略走 Lab KV，**不新增功能开关 env**。

---

## 3. 分 Agent 任务

三个切片互不改同一核心文件，可并行。都从 `origin/main` 拉分支。  
**不要**再改 `RAW_AGENT_*` 功能开关。密钥只走 Lab / 已有 repo Secrets。

### Agent A — Lab 送模视图（页面可测）

**目标**：人在 Lab 里能看见「模型实际吃到的」和「落库全文」的差别。

**做：**

1. `GET /api/sessions/:id/model-view`（或等价）：对当前 session 走与 `prepareView` 相同的 micro-compact / 策略，返回 `{ stored, modelView, stats }`（`collapsed` / `charsSaved` / `policy`）。只读，不改库。
2. 对话区增加「送模视图」开关（默认关）。打开后 tool_result 显示占位/裁剪，并标明「仅模型视图」。
3. `CompactSettingsCard` 旁一行有效策略 + 本会话最近一轮 `charsSaved`（有则显示）。
4. Playwright：heuristic 下切到 `after_text_assistant` → 发会打出长 `bash` 的消息 → 再发一轮 → 打开送模视图 → 断言占位文案出现、落库全文仍在（关开关能看见原文）。
5. 单测：API 对同一 session 在两种 policy 下 `collapsed` 不同。

**不要动：** `compact-ab-eval.mjs` 种子、CI workflow 触发方式。

**验收：** 不改 `.env`、只点 Lab，能完成一次「开实验档 → 两轮对话 → 看见占位」。

### Agent B — 评测种子换成真命令输出

**目标：** 回答「tool 返回的是什么」，并让 A/B 能测「效果」。

**做：**

1. 把 `scripts/compact-ab-eval.mjs` / harness 里的假 dump 换成多行真实 stdout（例如 `ls -la`、`git status`、一段测试失败栈）。
2. 追问的事实**只出现在 stdout**，不出现在 user 指令或命令行里。
3. 报告写清：tool 名、stdout 摘要、silent/restated 召回、token、折叠字数。
4. 单测锁「事实不在 prompt 命令行」。
5. 保持 `workflow_dispatch`；不要拉回 PR 必跑。

**不要动：** Lab 设置卡片、`prepare-view` 策略语义。  
若 [占位 Agent](https://cursor.com/agents/bc-a090428a-2da3-41a9-b9ae-1035361bcf5a) 已推同类提交，先 rebase / 接上，禁止平行两套种子。

### Agent C — 占位带地址（索引记忆）

**目标：** 占位是线索，不是撕页表。对应 `CONTEXT_COMPILER.md` §7.1。

**做：**

1. 占位行带稳定地址：`tool` 名、`ok`、消息/part id 或归档 key（现有 spill / transcript 能指回去的）。
2. 只读工具或 API：按该 id 取回**落库原文**（给模型或 Lab「展开原文」）。
3. 单测：折叠后 `modelView` 无全文、retrieve 能拿回同一段。
4. Lab：送模视图里占位可点开「原文（落库）」。

**不要动：** A/B workflow、默认 `keep_recent` 行为（除非占位文案兼容旧断言）。

---

## 4. 明确不做（本轮）

- 吐字中途改 KV / 本轮已发出的 prompt。
- 把 Context Compiler 全套（query 编包、图谱、硬切）塞进这次。
- 新的 `RAW_AGENT_*` 策略开关。
- 每次 CI 自动跑 live A/B。
- SWE-bench 金标（除非另开任务）。

---

## 5. 建议顺序

A 与 B 可同时开。C 依赖占位文案，建议 A 的 API 形状稳定后再接「点开原文」，或 C 先做 core retrieve、Lab 点开跟 A 的开关复用。

合入顺序：B（评测可信）→ A（人能看见）→ C（线索可回指）。
