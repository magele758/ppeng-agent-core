# 07 — Skills 与路由

Skill 是可热加载的知识注入——从文件系统发现、路由评分、shortlist 注入到 stable prefix。

---

## 发现层

```
allSkills() = builtinSkills ⊕ merge(workspace, agentsDir, cloud, domainExtras)
```

| 来源 | 路径 | 说明 |
|------|------|------|
| 内置 | `skills/builtin-skills.ts` | 编译期固定（极少） |
| 工作区 | `<repoRoot>/skills/**/SKILL.md` | 递归 glob |
| 用户全局 | `~/.agents/**/SKILL.md` | 同名覆盖工作区 |
| 云 catalog | `cloudSkillsLoader()` | 可选 PG/Redis 远端 |
| 领域包 | `RuntimeOptions.extraSkills` | Domain bundle 注入 |

合并规则：同 `name` 后来者覆盖（`mergeSkillsByName`）。

---

## 路由层 (`skills/skill-router.ts`)

每轮 user 消息抵达时，用 query 去给全量 skill 评分，取 top-K shortlist。

### 三种 mode

| Mode | 策略 |
|------|------|
| `legacy` | 全量注入（不路由） |
| `lexical` | TF-IDF tokenize + cosine（`skill-matcher.ts`） |
| `hybrid`（默认） | lexical × fusion（多信号加权 + relationship cache） |

### 关键概念

- **Confidence** (`assessRoutingConfidence`)：`high` / `medium` / `low`——基于 top-1 与 top-2 的分差。
- **Robustness** (`computeParticleRobustness`)：扰动 query → 多次路由 → 结果稳定性。
- **Fusion** (`routeSkillsWithFusion`)：多通道（lexical + alias + relationship）weighted merge。
- **Relationship cache** (`buildSkillRelationshipCache`)：按 skill 间 token 重叠预计算互相关联度，路由时让关联 skill 互相拉票。

### 输出

```ts
SkillRoutingResult {
  mode, confidence, routed, shortlistNames
}
```

`shortlistNames` 进入 `turn_start` trace；`routed[0..topK]` 的正文经 `skill-disclosure.ts` 注入 stable prefix 尾部。

---

## 加载层 (`load_skill` 工具)

模型在对话中显式调用 `load_skill({ name })` 时：
1. 在 `allSkills()` 中 lookup by `name` / `id` / `aliases`
2. **`RAW_AGENT_SKILL_LOAD_STRICT=1`**（默认 off）：仅允许加载当轮 shortlist 内的 skill → 防止模型旁路路由
3. 返回 skill 正文（已经过 `discloseSkillBody` 格式化）

---

## Env

| 变量 | 默认 | 说明 |
|------|------|------|
| `RAW_AGENT_SKILL_ROUTING_MODE` | hybrid | 路由算法 |
| `RAW_AGENT_SKILL_ROUTING_TOP_K` | 5 | shortlist 大小 |
| `RAW_AGENT_SKILL_ROUTING_FUSION` | 1 | 是否启用 fusion 多通道 |
| `RAW_AGENT_SKILL_LOAD_STRICT` | 0 | load_skill 是否限于 shortlist |
| `RAW_AGENT_AGENTS_SKILLS` | 1 | 是否加载 `~/.agents/` skills |
| `RAW_AGENT_AGENTS_SKILLS_DIR` | `~/.agents` | 自定义全局 skill 目录 |

---

## 关键文件

| 路径 | 说明 |
|------|------|
| `skills/skill-router.ts` | 路由主逻辑 + env 解析 |
| `skills/skill-matcher.ts` | tokenize / TF-IDF / fusion / robustness |
| `skills/skill-registry.ts` | 文件系统 glob + SKILL.md 解析 |
| `skills/skill-disclosure.ts` | 格式化注入内容 |
| `skills/builtin-skills.ts` | 内置 skill 定义 |
