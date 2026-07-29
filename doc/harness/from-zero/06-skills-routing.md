# 06 — 技能发现与路由（循环叠层）

> **挂在哪**：自建 loop 组 prompt / turnTools 时注入 shortlist；`load_skill` 仍走第 4 章 tool-loop。  
> **本阶段目标**：discovery → shortlist → `load_skill`，避免每轮塞全量 SKILL.md。
---

## 关键契约

1. **发现**：扫描仓库 `skills/**/SKILL.md`，并默认递归合并 `~/.agents/**/SKILL.md`（同名后者覆盖）。  
   - 关：`RAW_AGENT_AGENTS_SKILLS=0`  
   - 改目录：`RAW_AGENT_AGENTS_SKILLS_DIR`
2. **路由**：`RAW_AGENT_SKILL_ROUTING_MODE=legacy|hybrid`；词法 shortlist（TF-IDF / fusion），延迟低、无外部 embedding 依赖。
3. **加载**：模型调 `load_skill`；`RAW_AGENT_SKILL_LOAD_STRICT=1` 时仅允许当轮 shortlist 内技能。

基线说明：[`skill-router-baseline.md`](../../skill-router-baseline.md)。

---

## 关键落点

| 模块 | 路径 |
|------|------|
| 注册/扫描 | `packages/core/src/skills/skill-registry.ts` |
| 匹配原语 | `skills/skill-matcher.ts` |
| 路由编排 | `skills/skill-router.ts` |
| 内置片段 | `skills/builtin-skills.ts` |
| 披露进 prompt | `skills/skill-disclosure.ts` |

Domain 包可通过 `extraSkills` 注入（与 tools/agents 一并 merge）。

---

## 从 0 实现顺序

1. 约定 SKILL.md frontmatter（name / description / …）。
2. 启动时扫描 → `SkillSpec[]`。
3. 每轮 user 文本 → shortlist → 写入 dynamic prompt（名称+一句话，非全文）。
4. 实现 `load_skill` 工具，把全文注入后续上下文。
5. 再加 hybrid 模式与 strict 闸门。

---

## 本阶段验收

- [ ] 仓库内任意 skill 能被列出；`~/.agents` 同名覆盖生效。
- [ ] 相关用户话术出现 shortlist；无关话术不灌入全文。
- [ ] strict 模式下加载 shortlist 外技能被拒绝（或明确错误结果）。

**深读**：[07-skills-and-routing](../07-skills-and-routing.md)、工具面合章 [18-model-tools-sandbox](../18-model-tools-sandbox.md)  
**下一章**：[07-sandbox-and-safety](07-sandbox-and-safety.md)
