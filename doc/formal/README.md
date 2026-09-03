# Formal methods（可执行不变量，不是 TLC 证明）

对照 `ai-agent-node` 的 formal 方案与其 `docs/formal/2026-08-26-uncommitted-scheme-evaluation.md`：那边把 TLA / 运行时 LTL / Petri / 分析公式铺开后，**规格未对准实现、半接线进热路径、缺文件当绿、过称「已验证」**。本仓只吸收有用的核，并避开那些坑。

## 本仓做了什么

| 层 | 落点 | 诚实边界 |
|---|---|---|
| L1 可执行不变量 | `packages/core/src/formal/` | 谓词打在真实 transcript / Goal SM / Session 状态表上 |
| L1 PBT | `formal/pbt.ts` + `test/formal-invariants.test.js` | 固定种子随机走表；**不是**形式化证明 |
| L2 TLA 草稿 | `specs/formal/tla/*.tla` | 与 TS 转移表注释对齐；`test:formal` **不跑 TLC** |
| L3 MockLLM E2E | `MockLlmProvider` + `test/mock-llm-e2e.test.js` | 脚本化 adapter 驱动整条 `runSession`，结束后检查 pairing |

**不**把窗口启发式叫 LTL monitor，**不**挂进 AgentLoop / Recovery，**不**写 VERIFICATION PASSED。缺文件 = 失败。

## 命令

```bash
npx tsc -b packages/core
npm run test:formal
```

`test:formal` 会：检查必存在文件 → 跑 invariants / MockLLM / goal SM / surface 单测。未安装 JRE / 未跑 TLC **不能**解释成「规格已穷举」。

可选本机 TLC（非门禁）：

```bash
java -cp /path/to/tla2tools.jar tlc2.TLC specs/formal/tla/GoalStateMachine.tla
```

## MockLLM

```ts
import { RawAgentRuntime, createMockLlm, mockText, mockToolUse } from '@ppeng/agent-core';

const model = createMockLlm([
  mockToolUse({ name: 'read_file', input: { path: 'docs' } }),
  mockText('done')
]);
const runtime = new RawAgentRuntime({ repoRoot, stateDir, modelAdapter: model });
```

比 heuristic 更适合单测：无关键词猜测、回合顺序确定、可断言 `tool_call`↔`tool_result` 闭合。
