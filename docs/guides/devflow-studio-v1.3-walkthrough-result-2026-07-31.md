<a id="devflow-studio-v13-walkthrough-result--2026-07-31"></a>

# DevFlow Studio v1.3 演练结果 — 2026-07-31

<a id="signoff-outcome"></a>

## 验收结果

V1.3 通过了绑定候选提交的发布演练，可以形成正式验收提交。本报告保留当时结果，不代表当前候选版的新验收。

| 字段 | 结果 |
| --- | --- |
| 目标版本 | `1.3.0` |
| 候选提交（`C`） | `b4d0b3b317d594a05bdc6c90433e776ea578a671` |
| 产品演练 | 使用真实 Electron 与电脑控制，通过 |
| 团队项目 | `p-payments`（`Payments API`） |
| 产品 Run | `run-82322917-944d-43c1-9ff2-7edbf032182c` |
| 产品 Run 状态 | `completed` |
| 仅发布时执行的真实 OpenCode 冒烟 | 一次通过，没有重试 |
| 总体结果 | **通过** |

演练使用 `C` 的干净分离检出目录、全新隔离的 Electron `userData`、真实本地 API/Web 服务；所有直接界面交互均使用电脑控制。本报告不记录本地绝对路径、配对码、换取的 Bearer 令牌值或模型服务商密钥。

绑定候选提交的 [GitHub 验证工作流 30648476313](https://github.com/erich04/ai-devflow-studio/actions/runs/30648476313) 也已通过：头部 SHA 精确等于 `C`，结论为 `success`，macOS 验证、Windows 兼容性、Postgres 集成和 Docker 冒烟作业全部成功。

<a id="team-pairing-and-persistence"></a>

## 团队配对与持久化

前置设置通过本地 API，以 owner 权限为团队项目 `p-payments` 创建一次性配对码。电脑控制在真实 Electron 界面选择当前本地项目、输入配对码、点击 **绑定**，再点击 **同步团队**。配对身份为 `org-demo` / `p-payments` / `u-erich`，本地项目为 `local-b459393b549c`。

配对码与换取的 Bearer 令牌值没有写入日志或证据。本次没有操作 Web 配对界面，因此不声明该独立界面路径通过。

Run 完成后，团队同步成功。随后关闭 Electron，使用同一隔离 `userData` 重启，且不再携带确定性模拟运行时启动标记。本地项目与 `p-payments` 的绑定无需新配对码即可恢复，同一个已完成 Run 仍可查看，再次团队同步也成功。
远端只接收脱敏摘要；完整 Run、产物、事件、审查和测试证据仍以本地为准。

<a id="end-to-end-computer-use-walkthrough"></a>

## 端到端电脑控制演练

| 步骤 | 观察结果 |
| --- | --- |
| 选择候选版 | 将 `C` 的确切干净检出目录选为本地项目。 |
| 配对并同步 | 本地项目绑定到 Payments API；界面显示已绑定且已同步。 |
| 创建 Run | 创建 `修复 webhook retry 失败边界`，要求澄清失败边界、设计最小实现，并完成实现、测试、PR 交接和验收证据。 |
| 需求澄清 | 生成澄清产物。 |
| 澄清审查 | 对 `需求确认 Gate` 运行知识审查，归档后批准门禁。 |
| 方案设计 | 生成设计产物。 |
| 设计审查 | 对 `方案评审 Gate` 运行知识审查，归档后批准门禁。 |
| 编码 | 在托管工作树中运行确定性模拟编码 Agent，批准请求的权限一次，得到脱敏差异与标记测试证据。该补丁中没有需要替换的敏感标记。 |
| 独立测试 | 保留首轮全套测试的失败证据，修正启动环境后记录后续通过证据，再继续推进。 |
| PR 交接 | 生成 PR 草稿产物，没有创建真实 GitHub PR。 |
| 验收证据包 | 生成业务验收证据包。 |
| 验收策略执行 | 缺少对应验收 Agent 审查时，最终验收正确保持阻断。操作按钮定位到 Agents 的 `业务验收`；随后知识审查完成并归档，不阻止审批，同时保留针对先前失败证据的一条高严重性历史 `test_risk` 警告。 |
| 最终门禁 | 返回工作台后，最终验收门禁通过，Run 进入 `completed`。 |
| 完成后同步 | 团队同步成功，未用远端摘要替换完整本地 Run。 |
| 冷启动 | 同一 `userData` 重启后，配对、已完成 Run、产物和同步能力均保留。 |

此过程专门验证 `C` 修复的验收审查跳转：产品执行必需审查规则，将操作按钮引导到审查流程，只有对应审查存在后才接受门禁审批。
审查没有剩余风险或缺失证据，不阻断审批，同时保留非阻断的历史 `test_risk` 发现项；没有绕过审查要求。

<a id="test-evidence-and-the-preserved-failed-attempt"></a>

## 测试证据与保留的失败尝试

验收 Run 共有三份测试证据：

| 证据 | 命令 | 结果 |
| --- | --- | --- |
| 编码标记 | 标记验证命令 | `68ms` 通过 |
| 首轮全套测试 | `corepack pnpm test` | `10186ms` 后失败，退出码 `1`；通过 `70/71` 个文件、`655/656` 项测试 |
| 最新全套测试 | `corepack pnpm test` | `10815ms` 通过，退出码 `0`；`71` 个文件、`656` 项测试全部通过 |

首轮失败刻意保留。测试界面曾被要求移除 `DEVFLOW_ENABLE_FAKE_RUNTIME`，但持久化和实际执行的命令被规范化成 `corepack pnpm test`。
由于 Electron 进程本身携带确定性模拟运行时标记启动，测试子进程继承了该标记，导致 `apps/api/src/routes/team-routes.test.ts` 的一个“标记关闭”契约测试失败。Run 留在测试阶段，没有进入 PR。

关闭 Electron，使用同一隔离数据、不携带该启动标记重启后，标准命令通过全部 `71` 个文件和 `656` 项测试。只有这份后续通过证据允许 Run 继续推进。
这验证了失败/重跑行为，不能把演练表述为首次即通过。启动环境失败属于测试驱动的观测，不是已独立验证候选版的失败。

<a id="persisted-product-evidence"></a>

## 持久化产品证据

最终本地数据库记录：

- 一个已完成 Run，创建于 `2026-07-31T16:52:45.068Z`，更新于 `2026-07-31T16:58:31.802Z`。
- 需求澄清、方案设计、开发、测试、PR 与验收六阶段中的八个节点均为 `success`。
- `11` 个产物：原始请求、澄清、设计、三份审查报告、三份测试证据、PR 草稿和验收证据包。
- `3` 次知识审查：需求确认门禁、方案评审门禁与最终验收。
- `1` 次编码 Agent 运行、`3` 份测试证据。
- 最终同步刷新了 `p-payments` 的团队策略快照。

<a id="required-deterministic-gates"></a>

## 必需的确定性检查

| 检查 | 结果 | 证据 |
| --- | --- | --- |
| `verify` | 通过 | 本地 `corepack pnpm verify`；绑定候选提交的 macOS 验证作业 |
| `windows-compatibility` | 通过 | 绑定候选提交的 Windows 兼容性作业 |
| `e2e` | 通过 | 本地演示验证；绑定候选提交的 macOS 验证作业 |
| `electron-smoke` | 通过 | 本地演示验证；绑定候选提交的 macOS 验证作业 |
| `postgres-smoke` | 通过 | 一次性 PostgreSQL 16；绑定候选提交的 Postgres 作业 |
| `docker-smoke` | 通过 | 本地 Docker 冒烟；绑定候选提交的 Docker 作业 |
| `build` | 通过 | 本地生产构建；绑定候选提交的 macOS 验证作业 |
| `build-output-smoke` | 通过 | 本地构建产物冒烟；绑定候选提交的 macOS 验证作业 |

形成证据提交之前，独立候选验证已完成 `71` 个测试文件、`656` 项测试、工作区类型检查、生产构建与跨平台检查。

<a id="release-only-real-opencode-smoke"></a>

## 仅发布时执行的真实 OpenCode 冒烟

在用户明确批准费用之后，此付费服务商验收恰好运行一次，没有重试。历史授权不延伸为本次文档修改的新增调用授权。

| 字段 | 观察结果 |
| --- | --- |
| OpenCode | `1.18.10` |
| 服务商 / 模型 | `double` / `ark-code-latest` |
| 服务商 API | Volcengine Ark 的 OpenAI 兼容端点 |
| 显式真实调用开关 | `DEVFLOW_RUN_OPENCODE_SMOKE=1` |
| 引擎 | `opencode-http` |
| 耗时 | `40s` |
| 权限转发序列 | `external_directory -> bash -> external_directory -> edit -> external_directory -> bash -> external_directory -> bash` |
| 变更路径 | `devflow-opencode-smoke.txt` |
| 测试样例证据 | 通过 |
| 托管工作树清理 | 通过，工作空间已删除 |
| 脱敏检查 | 通过 |

临时 OpenCode 配置仅引用环境变量名，不含真实凭据值。真实冒烟产生了工具调用/结果证据、脱敏差异元数据、通过的样例测试和成功清理记录。
本报告不包含原始服务商输出、原始提示词、原始补丁、工作树绝对路径或服务商凭据值。权限序列等技术标识保留原文，便于对照原始证据。

<a id="claim-boundaries"></a>

## 结论的适用边界

- 完整产品演练使用确定性模拟编码 Agent；真实付费服务商行为由独立的发布 OpenCode 冒烟样例证明。
- 生成的是 PR 草稿产物。产品 Run 没有执行真实 GitHub PR 创建、推送、合并或自动批准门禁。
- 没有验证 Web 配对界面。
- Windows 结果是兼容性作业，不是完整 Windows Electron 界面冒烟。
- MCP、RAG 和向量检索不在本次 V1.3 验收范围。
- 团队同步证明脱敏摘要同步与本地权威状态恢复，不声明远端摘要可以替代完整本地工作流记录。

<a id="verdict"></a>

## 最终判断

候选提交 `b4d0b3b317d594a05bdc6c90433e776ea578a671` 满足 V1.3 发布演练、必需确定性检查、团队项目配对/同步/重启、验收审查跳转，以及唯一一次必需的真实 OpenCode 发布冒烟要求。可以形成 V1.3 验收提交，并进行随后创建标签前的检查。
