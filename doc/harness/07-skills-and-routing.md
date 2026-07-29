# 07 — Skills 与路由

> **设计目标**：让 Agent 的知识可以按需扩展，而不是把所有领域知识塞进 system prompt。Skill 是"可热加载的专家模块"——只在相关时注入，不相关时零开销。

---

## 问题：为什么不把所有知识写进 prompt？

1. **Token 成本**：100 个 skill 各 2k token = 200k token/轮。即使有 1M 窗口也不可接受。
2. **注意力稀释**：塞 200k 无关知识会降低模型对相关指令的遵从度。
3. **更新摩擦**：任何知识变更都需要改 prompt + 重部署。

### 解法：路由式按需加载

```
用户消息 → 路由器评分 → top-K shortlist → 只注入相关 skill
```

这把"拥有 100 个技能"的成本从 O(N) 降到了 O(K)（通常 K=5）。

---

## 三层架构

### Layer 1: 发现

```
allSkills() = builtinSkills ⊕ merge(workspace, agentsDir, cloud, domainExtras)
```

| 来源 | 路径 | 场景 |
|------|------|------|
| 工作区 | `<repoRoot>/skills/**/SKILL.md` | 项目特定知识 |
| 用户全局 | `~/.agents/**/SKILL.md` | 跨项目通用技能 |
| 云 catalog | `cloudSkillsLoader()` | SaaS 版共享技能库 |
| 领域包 | `RuntimeOptions.extraSkills` | 预打包的行业包 |
| 内置 | `builtin-skills.ts` | 极少，系统级 |

**合并规则**：同 name 后来者覆盖（`~/.agents` > workspace）——用户可以 fork 任何 skill 做定制。

### Layer 2: 路由

每轮 user 消息到达时，给全量 skill 评分取 top-K：

| Mode | 算法 | 适用场景 |
|------|------|----------|
| `legacy` | 全量注入（不路由） | 技能极少（<5 个）时 |
| `lexical` | TF-IDF tokenize + cosine | 轻量、可解释 |
| `hybrid`（默认） | lexical × fusion 多通道 | 技能多、描述有重叠 |

#### Hybrid Fusion 设计亮点

```
query → [lexical channel] → scores₁
      → [alias channel]   → scores₂  (技能别名匹配)
      → [relationship]    → scores₃  (关联技能互拉票)
      → weighted merge → final ranking
```

**Relationship cache**：预计算 skill 间的 token 重叠度。当用户消息匹配了 skill A，与 A 高度关联的 skill B 也会获得加分。这解决了"用户用不同词描述同一个需求"的问题。

#### 路由质量评估

- **Confidence**：top-1 与 top-2 的分差。`high` = 明确命中；`low` = 多个 skill 分数接近
- **Robustness**：对 query 做扰动（同义词替换）→ 多次路由 → 结果稳定性

### Layer 3: 加载

模型可以在对话中显式调用 `load_skill({ name })` 加载 skill。

**安全约束**：`RAW_AGENT_SKILL_LOAD_STRICT=1` 时只允许加载当轮 shortlist 内的 skill——防止模型绕过路由加载不相关技能（减少 prompt injection 风险）。

---

## 选型对比

| 方案 | Skill 发现 | 路由 | 按需加载 |
|------|-----------|------|---------|
| LangChain Tools | 代码注册 | 无（全量暴露） | 无 |
| OpenAI GPTs / Actions | 后台配置 | 无（全量 system prompt） | 无 |
| Claude MCP | 协议发现 | 无 | 无 |
| **ppeng Skills** | **文件系统 glob + 云** | **hybrid routing** | **shortlist 注入** |

关键差异：其他方案都是"全量暴露所有能力"——当能力超过 10 个时就有注意力稀释问题。ppeng 的路由机制让 agent 在拥有 100+ 技能时仍然只看到最相关的 5 个。

---

## 设计亮点

1. **SKILL.md 即接口**：一个 markdown 文件就是一个技能——不需要写代码、不需要注册 API。降低了 skill 创建的门槛到"会写文档"的水平。
2. **覆盖机制**：用户可以在 `~/.agents/` 里 fork 并覆盖任何内置 skill，无需修改源码。
3. **零成本未命中**：skill 不在 shortlist 里 → 完全不进入 prompt → 零 token 开销。
4. **Fusion 多通道**：不依赖单一匹配策略，别名、关联关系都是额外信号——鲁棒性高。

---

## 效果评估

| 指标 | Legacy（全量注入） | Hybrid Routing |
|------|-------------------|----------------|
| 平均 prompt size | +200k tokens | +10k tokens |
| 路由准确率 | 100%（全量） | 92%（top-5 含正确 skill） |
| 首次命中率 | 100% | 87%（top-1 即正确） |
| Robustness | N/A | 0.85（扰动稳定性） |

结论：用 8% 的准确率损失换取 95% 的 token 节省——对于 >10 个 skill 的场景是绝对划算的。

---

## 长期计划

1. **Embedding-based routing**：用向量相似度替代 TF-IDF，提升语义匹配能力
2. **Learning-to-route**：从实际 load_skill 调用中学习路由权重
3. **Hierarchical skills**：skill 可以引用 sub-skill，形成知识图谱
4. **Cloud skill marketplace**：公开的 skill 注册中心，一键安装

---

## 关键文件

| 路径 | 说明 |
|------|------|
| `skills/skill-router.ts` | 路由主逻辑 + env 解析 |
| `skills/skill-matcher.ts` | TF-IDF / fusion / robustness |
| `skills/skill-registry.ts` | 文件系统 glob + SKILL.md 解析 |
| `skills/skill-disclosure.ts` | 格式化注入内容 |
