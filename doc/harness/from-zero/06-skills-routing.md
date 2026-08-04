# 06：Skills 发现、路由与加载

Skill 不会默认把所有 `SKILL.md` 全文塞进 system prompt。系统先发现清单，再按当前用户消息生成 shortlist；模型需要时调用 `load_skill` 读取正文。

## 数据流

```text
仓库 skills/**/SKILL.md ─┐
~/.agents/**/SKILL.md ───┼─ mergeSkillsByName → SkillSpec[]
domain / plugin skills ──┘
                              │
用户当前消息 → buildSkillRouting → dynamic context 中的 shortlist
                              │
                    load_skill(name)
                              │
             strict 校验 + progressive disclosure
```

同名时 `~/.agents` 版本覆盖仓库版本。`RAW_AGENT_AGENTS_SKILLS=0` 可关闭用户目录扫描，`RAW_AGENT_AGENTS_SKILLS_DIR` 可更换目录。

## 路由与加载不是一件事

- `skill-router.ts` 决定本轮推荐哪些 skill。
- `PromptBuilder.buildDynamicContext` 只披露名称、描述、分数和置信度。
- `RawAgentRuntime.resolveSkillLoad` 查找正文，并在 strict 模式检查是否位于本轮 shortlist。
- `skill-disclosure.ts` 控制正文的渐进披露。

相关开关：`RAW_AGENT_SKILL_ROUTING_MODE`、`RAW_AGENT_SKILL_ROUTING_TOP_K`、`RAW_AGENT_SKILL_ROUTING_FUSION`、`RAW_AGENT_SKILL_LOAD_STRICT`。

## 代码检查

从 `PromptBuilder.allSkills()` 走到 `buildDynamicContext()`，再跳到 runtime 的 `resolveSkillLoad()`。确认 cache 失效入口是 `reloadWorkspaceSkills()`。

继续 [07 沙箱与恢复](07-sandbox-and-safety.md)。
