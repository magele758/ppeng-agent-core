# 自动化发布可靠性计划

目标：用可重复的测试、失败即阻断的门禁和可恢复的部署，减少每次发布的人肉验收。不是通过拆小函数优化 CRAP 数字，也不承诺测试能证明任意生产输入绝无故障。

## 1. 本轮落地（2026-10-08）

| 改动 | 验证方式 | 边界 |
|------|----------|------|
| SQLite warning 过滤确定性测试 | 子进程主动触发警告，覆盖过滤、保留、堆栈与 opt-out | 不依赖 Node 自动产生实验警告 |
| Jev route 行为测试 | 阈值等号、继续信号优先、goalGate 互斥、HTTP/网络/解析/取消失败、snapshot 上限 | mock HTTP，不验证真实服务准确率 |
| CRAP 工具链预检与环境记录 | runner/provider/hoisted runner 版本一致性测试 | 不自动改依赖或抬高基线 |
| npm / Docker 发布硬门禁 | 工作流依赖契约；实际汇总脚本的 25 种 success/failure/cancelled/skipped/空值组合 | 仅 success/success 放行；没有触发实际发布 |
| fast eval 纳入 CI 与本地 ci | 必带 `--exit-on-fail`，工作流契约测试保护 | 不代表真实模型质量 |
| 失败证据保留 | 工作流 always 上传已有测试报告/trace | 不能补回尚未生成的证据 |

第一阶段局部收益：warning 回调从 CRAP 72 降到 8，Jev `applyJevRoute` 从 39.6 降到 10，计分语句覆盖率均为 100%。从基线中只删除已消除的 Jev 债务；没有新增/放宽债务。第二阶段新增反例发现并修复协议和状态问题，不以拆函数降低分数。

Node 22.21.1 与 Node 26.7.0 的本地 CRAP 均通过；CI 仍使用 `.nvmrc` 的 Node 22。跨主版本验证用于发现环境依赖，不意味着已承诺所有 Node 版本/平台支持。GitHub 实际执行、分支保护、生产发布未在本轮验证。

## 2. 目标发布链与当前缺口

```text
确定性逻辑/协议测试 + 状态不变量
                  ↓
HTTP / UI / 权限与持久化回归
                  ↓
同一 SHA 的必过门禁                 ← 已接入
                  ↓
打包后安装/启动验证                 ← 已接入 npm / Docker
                  ↓
候选部署：真实地址探测 + 状态检查   ← 已实现，有边界
                  ↓
自动晋级；失败留证据并回滚          ← 反例测试通过，生产演练待完成
```

第二阶段已补最终产物检查：npm 在临时目录安装 tarball、检查全部 exports/type exports/mini 便携性并运行最小会话；发布的是同一 tarball。Docker 两个镜像先本地加载，按 image ID 启动隔离测试，检查鉴权、SSE、重启持久化，再推送同一 image ID。证据分别为 `test-results/npm-artifacts.json` 和 `image-smoke.json`。仍需明确边界：

- main 合并是否强制要求 `Release gate / Main release gate`，取决于远端 Ruleset/分支保护。本轮未修改或声称已验证这些设置。
- 桌面 Release 不在本轮范围；本地 `publish:npm` 已有 tarball 自检，但仍不等于完整 release-gate。不能声称所有入口都有全套保护。
- G1 已改为命中真实 candidate 地址的只读候选 suite，不再自拉临时 daemon；它确认可用性而非全面业务能力。Docker 隔离环境另验证有写入的关键用户路径。
- Compose / Helm 晋级固定测试过的 image ID / digest，失败恢复旧镜像或旧 Helm revision 后必须再通过探测，才标记回滚成功。数据库 schema 不同、没有已知稳定版本等情形直接阻断，需备份/迁移演练；不承诺自动逆向迁移。
- 两个镜像的 registry 标签更新不是原子事务，生产应记录并固定一组不可变版本，不能靠两个 `latest` 标签证明配对一致。

## 3. 第二阶段已落地

实现与验证范围：

1. **协议边界**：为 Responses 事件序列补 fixtures，覆盖文本/工具参数分片、结束、重复、截断、取消、429/5xx 和无效载荷；分别确认 SDK 默认链路与 core 参考实现，避免只测到旧内核。
2. **产物冒烟**：npm 打包改 scope 后，在隔离目录安装 tarball，验证 exports、mini 便携性和最小会话；Docker 构建后启动同一 digest，验证 readiness、鉴权、SSE 和数据持久化，再移动发布标签。
3. **状态可靠性**：为 SQLite 升级、重启后恢复、审批前后重复请求、tool_call/result 配对、checkpoint 回退补集成反例。已有 formal/PBT/MockLLM 用例复用，不再造第二套测试框架。
4. **候选与回滚**：探测必须命中真实候选地址，记录 SHA/digest、迁移版本和门禁结果；注入失败后验证“不晋级”和“恢复上一版”两个断言。数据迁移不可逆时禁止自动回滚旧程序并谎称成功。

上述四项均已实现自动测试。反例实际发现并修复：Responses incomplete/failed/cancelled 被错误当成功、重复 checkpoint rewind 错误吞入控制行、旧格式 SQLite 被破坏性重置、缺失数据库仍 readiness 成功。SDK 同步文档和测试。Playwright 使用独立输出子目录，避免清空其他门禁证据；重试后才成功也不算稳定通过。

合并主干后的纵向复审补充了四类回归：连续两次 Compose 晋级后的外层失败恢复；重新部署不能继承旧 gate/bake（并绑定镜像证据）；Helm 旧 revision 可变 tag 必须在晋级前阻断、恢复后核对实际 digest；评估从 transcript 按 toolCallId 统计所有调用尝试，包含执行前拒绝，正常执行不重复计数。子进程树测试通过 PID 就绪握手触发真实超时回调，消除 300ms 与进程启动速度的竞态，不放宽生产超时。

尚未完成的是外部环境验证：真实 GitHub Actions、生产 Compose/Helm 失败演练、远端分支保护及真实模型能力校准。没有执行生产部署或发布。能力与提示词的独立配对评估已实现，具体用法、统计边界及接入条件见 [Harness 评估](HARNESS_EVALUATION.md)。

## 4. 如何减少 Agent 与人工的循环成本

- **编辑期间**：先跑受影响模块的小测试；新增逻辑需覆盖 happy path 与失败/边界路径。Agent 自己读失败证据、修复并重跑。
- **合并/发布前**：完整强制门禁，不让“只跑局部测试”替代发布证明。不用 `|| true`、提高基线或反复重试直到变绿。
- **失败报告**：分清产品行为回归、测试不稳定、工具链/基础设施故障；后两种不能被误报为产品通过。
- **人只处理例外**：权限/密钥缺失、不可逆迁移、业务验收标准变更、主动接受风险；普通格式/编译/测试失败由 Agent 修复。
- **优化耗时**：先记录每层耗时，再考虑合并目前重复的单测采集、缓存同 SHA 构建产物与并行独立套件。优化不得削弱覆盖或复用另一 SHA 的绿灯。

跟踪实际指标：发布失败/回滚次数、测试不稳定率、定位耗时、每次发布人工介入次数、门禁耗时、Coding Agent 修复轮数与无关修改文件数。先积累基线再定数值目标；CRAP 只作局部风险信号，不作总体可靠性评分。

相关入口：[测试矩阵](TESTING.md) · [CI 与发布门禁](CI.md) · [CRAP](CRAP_GATE.md) · [Jev 接入](JEV_INTEGRATION.md)。
