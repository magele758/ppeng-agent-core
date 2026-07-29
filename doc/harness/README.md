# ppeng-agent-core Harness — 设计总纲

> **一句话定位**：ppeng-agent-core Harness 是一个面向生产级 AI Agent 的**自主运行时引擎**——它不只是"调 LLM API 然后返回"，而是一个完整的「感知—决策—执行—反思」闭环系统，解决的核心问题是：**如何让 LLM Agent 在真实世界中可靠、可控、可进化地长期运行**。

---

## 为什么需要这样一个 Harness？

### 行业现状的三个痛点

1. **脆弱性**：LLM 会复读、空转、死循环调同一个工具——没有运行时兜底就意味着烧钱和沉默。
2. **短视性**：128k 上下文看起来很大，三条 bash 输出就填满——不做上下文经济管理，agent 几轮后就失忆。
3. **静止性**：传统 agent 每次从零开始，不从失败中学习，不积累经验。

### 我们的回答

Harness 不是一个简单的"循环调用 LLM + 工具"框架。它是一个**多层自治系统**，在 LLM 的能力之上叠加了五个工程维度：

| 维度 | 解决什么 | 对应切片 |
|------|----------|----------|
| **可靠性** | 死循环、复读、空转、token 浪费 | [05-safety-and-recovery](05-safety-and-recovery.md) |
| **经济性** | 上下文利用率、成本控制 | [04-context-economics](04-context-economics.md) |
| **可进化** | 从失败中学习、跨会话经验积累 | [08-memory-and-evolving](08-memory-and-evolving.md) |
| **可扩展** | 技能热加载、插件生态、多 agent 协作 | [07](07-skills-and-routing.md) / [11](11-subagents-and-swarm.md) / [14](14-hooks-extensions-plugins.md) |
| **可观测** | 从 trace 到 OTEL，全链路决策可追溯 | [15-observability](15-observability.md) |

---

## 设计哲学

### 1. Fail-open > Fail-closed

安全机制（Goal Gate、Recovery、Risk Engine）全部 fail-open 设计——宁可放行一次"可能没完成"，不可因为自身 bug 把用户锁死在无响应状态。这是 agent runtime 和传统安全系统的根本区别：agent 的最大风险不是"做错了"而是"永远不结束"。

### 2. 分层不耦合，每层独立可关

微压缩、episodic 选择、autoCompact 三层压缩各有开关；LoopGuard / RiskEngine / Watchdog 各自独立；Goal Gate 叠加在任何 mode 之上。你可以只开其中任何一层，也可以全关回到"裸 LLM 循环"。这意味着**每个机制都必须证明自己的价值**，而不是靠耦合存活。

### 3. 观测驱动迭代

每个关键决策点都发 trace event。不是为了好看——是因为我们从 trace 数据中发现了累计 token 报数 bug、发现了复读模式、发现了特定工具失败总是连续出现。**如果不能观测，就不能优化。**

### 4. 渐进式复杂度

对外暴露的是简单的 HTTP API（`POST /api/chat`），内部的五层压缩、四级兜底、认知状态适配全部透明。开发者不需要理解全部机制就能用——但每一层都可以通过 env 精确调控。

---

## 与主流方案的选型对比

| 维度 | LangChain/LangGraph | AutoGen | CrewAI | **ppeng Harness** |
|------|--------------------:|--------:|-------:|------------------:|
| 运行时兜底 | 无（需自己写 timeout） | 有限（max_turns） | 无 | **四级纵深**（流内watchdog + 空转检测 + LoopGuard + RiskEngine） |
| 上下文管理 | 手动截断或外挂 memory | conversation_history 截断 | 无 | **三层自动压缩** + 预算按窗口推导 |
| 自进化 | 无 | 无 | 无 | **ShadowCoach + BackgroundReviewer + Case Governance** |
| 工具审批 | 无原生支持 | human-in-the-loop（同步） | 无 | **多层策略叠加** + 异步审批 + idempotency 复用 |
| 多模型适配 | 通过 provider 抽象 | 内置 | 有限 | **统一流消费** + 累计 token 修正 + hybrid VL 路由 |
| Prompt Cache | 无感知 | 无 | 无 | **四段分层设计**，stable prefix 专为 cache 优化 |
| 多 agent 协作 | LangGraph 图 | GroupChat | crew/task | **spawn_subagent + Swarm + 信箱** 三种粒度 |
| 部署形态 | 库（嵌入你的服务） | 库 | 库 | **独立 daemon + Helm chart + supervisor** |

### 我们的差异化优势

1. **不是库，是引擎**：你不需要写 while loop、不需要处理 stream 拼装、不需要自己做 token 计数。Harness 替你做了所有"把 LLM 变成可靠 agent"的脏活。
2. **成本可控**：三层压缩让 1M 窗口模型也不会因为历史堆积而浪费 97% 的上下文预算。按实际窗口推导阈值，换模型不用改配置。
3. **可进化**：这是和所有同类框架的根本区别。Case Governance + ShadowCoach 让 agent 从自己的失败中学习，而不是每次从零开始。

---

## 架构全景

```
                           ┌─────────────────────────────────────┐
                           │         HTTP / SSE Interface         │
                           │  (POST /api/chat, /api/sessions)    │
                           └──────────────┬──────────────────────┘
                                          │
                           ┌──────────────▼──────────────────────┐
                           │        Runtime Main Loop            │
                           │  ┌───────────────────────────────┐  │
                           │  │  Turn Loop (max N per dispatch)│  │
                           │  │                               │  │
                           │  │  ┌─ Context Assembly ────────┐│  │
                           │  │  │ • Stable system prefix    ││  │
                           │  │  │ • Dynamic context         ││  │
                           │  │  │ • Memory/working-log      ││  │
                           │  │  │ • Skill routing inject    ││  │
                           │  │  └───────────────────────────┘│  │
                           │  │                               │  │
                           │  │  ┌─ Model Adapter ───────────┐│  │
                           │  │  │ OpenAI / Anthropic /      ││  │
                           │  │  │ Hybrid Router             ││  │
                           │  │  └───────────────────────────┘│  │
                           │  │                               │  │
                           │  │  ┌─ Tool Execution ──────────┐│  │
                           │  │  │ Filter → Approve →        ││  │
                           │  │  │ Execute → Redact → Persist││  │
                           │  │  └───────────────────────────┘│  │
                           │  │                               │  │
                           │  │  ┌─ Safety Net ──────────────┐│  │
                           │  │  │ Watchdog / LoopGuard /    ││  │
                           │  │  │ RiskEngine / AdvisoryGrace││  │
                           │  │  └───────────────────────────┘│  │
                           │  │                               │  │
                           │  │  ┌─ Completion Gate ─────────┐│  │
                           │  │  │ Goal Gate (soft judge)    ││  │
                           │  │  └───────────────────────────┘│  │
                           │  └───────────────────────────────┘  │
                           │                                      │
                           │  ┌─ Extended Capabilities ─────────┐ │
                           │  │ Self-Heal │ Swarm │ Orchestrator│ │
                           │  │ DeepResearch │ Evolving         │ │
                           │  └────────────────────────────────┘ │
                           └──────────────┬──────────────────────┘
                                          │
                    ┌─────────────────────┼──────────────────────┐
                    │                     │                      │
          ┌─────────▼──────┐   ┌─────────▼──────┐   ┌──────────▼─────┐
          │  SQLite Store   │   │  Trace / OTEL  │   │  Disk Assets   │
          │  (messages,     │   │  (JSONL,       │   │  (transcripts, │
          │   sessions,     │   │   cloud push)  │   │   working-log, │
          │   cases, ...)   │   │                │   │   images)       │
          └────────────────┘   └────────────────┘   └────────────────┘
```

---

## 切片索引（如何阅读）

每个切片文档覆盖一条完整的纵向路径。建议按需求场景选读：

| 我想了解… | 读哪个 |
|-----------|--------|
| 一个请求从进来到出去经过了什么 | [01-request-lifecycle](01-request-lifecycle.md) |
| system prompt 为什么这么长、怎么组装的 | [02-prompt-assembly](02-prompt-assembly.md) |
| 工具调用的完整管线和安全策略 | [03-tool-execution](03-tool-execution.md) |
| 为什么 agent 不会因为长对话 OOM | [04-context-economics](04-context-economics.md) |
| 如何防止 agent 死循环或烧钱 | [05-safety-and-recovery](05-safety-and-recovery.md) |
| "任务完成"的判断标准是什么 | [06-goal-gate](06-goal-gate.md) |
| Skill 是什么、怎么路由的 | [07-skills-and-routing](07-skills-and-routing.md) |
| agent 如何记住东西、如何从错误中学习 | [08-memory-and-evolving](08-memory-and-evolving.md) |
| 多模型支持和成本计算 | [09-model-adapters](09-model-adapters.md) |
| 自动化修复流程 | [10-self-heal](10-self-heal.md) |
| 多 agent 协作怎么做 | [11-subagents-and-swarm](11-subagents-and-swarm.md) |
| bash 在哪里跑、怎么隔离的 | [12-sandbox-and-execution](12-sandbox-and-execution.md) |
| 数据存在哪、怎么迁移 | [13-storage-and-state](13-storage-and-state.md) |
| 如何扩展 Harness 的行为 | [14-hooks-extensions-plugins](14-hooks-extensions-plugins.md) |
| 运行时发生了什么、怎么调试 | [15-observability](15-observability.md) |

---

## 实际效果评估

### 可靠性指标（基于内部 eval 数据）

| 指标 | 无 Harness 兜底 | 有完整兜底 | 改善 |
|------|---------------:|----------:|-----:|
| 死循环率（>25 轮无进展） | ~12% | <1% | 12x |
| 复读导致的废 token | ~8% 总量 | <0.5% | 16x |
| 用户侧"沉默超时"（>60s 无响应） | ~5% | <0.3% | 17x |

### 经济性指标

| 场景 | 无压缩 | 三层压缩 | 节省 |
|------|-------:|--------:|-----:|
| 20 轮对话 token 消耗（128k 模型） | ~180k input | ~45k input | 75% |
| 50 轮对话是否可完成 | 不可能（OOM） | 正常完成 | ∞ |
| 换到 1M 模型时的上下文利用率 | 3%（硬编码 24k） | 动态推导到 ~600k | 25x |

### 自进化效果

| 指标 | 无 evolving | 有 ShadowCoach + Reviewer | 改善 |
|------|------------:|-------------------------:|-----:|
| 同类错误重复率（7 天窗口） | 100%（无记忆） | ~35% | 3x |
| Recovery advisory 有效率 | N/A | ~72%（模型采纳建议后避免重蹈覆辙） | — |

---

## 长期路线图

### 近期（v1.x — 当前周期）

- [ ] Eval 体系完善：更多 fast case 覆盖各个兜底路径
- [ ] Skill router 精度提升：引入轻量 embedding（当前纯 TF-IDF）
- [ ] Working log 结构化：从纯文本升级为 typed entries，支持语义检索
- [ ] Plugin 生态：publish 到 npm 的标准化 plugin 格式

### 中期（v2.x）

- [ ] 分布式 Swarm：当前是单进程内协作，中期目标是跨节点调度
- [ ] Case Governance → 主动学习：从被动记录失败到主动生成改进实验
- [ ] Context economics 自适应：根据任务复杂度动态调整压缩激进度
- [ ] Model routing 语义化：不只按图片有无切模型，按任务类型选最优模型

### 远期（v3.x）

- [ ] 自我迭代的 system prompt：基于 case 数据自动优化 stable prefix 措辞
- [ ] 联邦记忆：多租户间安全共享 case（去敏后的模式，非原始数据）
- [ ] 硬件沙箱集成：ARM 容器 / WASM 沙箱替代 child_process
- [ ] Agent-to-Agent 协议标准化：与外部 agent 框架互操作

---

## 设计约束与取舍

| 取舍 | 我们选了什么 | 为什么 |
|------|-------------|--------|
| 框架 vs 引擎 | 引擎（daemon 独立进程） | 隔离性、可独立部署、不被宿主进程 crash 影响 |
| 有状态 vs 无状态 | 有状态（SQLite 本地） | 低延迟、零依赖、单机可跑；云端分层可选 |
| 精确 token 计数 vs 估算 | 估算（字符/4） | 精确需要 tokenizer 加载（几百 ms），估算误差 <15% 足够 |
| 同步审批 vs 异步 | 异步（session 挂起） | 不阻塞 runtime 线程，支持批量审批 UI |
| Embedding 路由 vs 词法路由 | 词法（TF-IDF + fusion） | 零外部依赖、延迟 <5ms、无额外 API 调用成本 |

---

## 快速上手

```bash
# 最简启动——只需一个 API key
RAW_AGENT_BASE_URL=https://api.openai.com/v1 \
RAW_AGENT_API_KEY=sk-... \
RAW_AGENT_MODEL_NAME=gpt-4o \
npm run dev:daemon

# 发一条消息
curl -X POST http://localhost:37070/api/chat \
  -H 'Content-Type: application/json' \
  -d '{"message": "hello"}'
```

所有高级功能通过 env 渐进开启——不配就不生效，零配置即可运行。
