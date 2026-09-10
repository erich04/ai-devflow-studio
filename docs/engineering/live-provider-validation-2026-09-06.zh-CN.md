# 真实 Provider 流程验证记录 · 2026-09-06 / 07

状态：**已完成从项目创建、配对到真实 Draft PR 和业务验收，修复后的第二轮也已完成。** 第一轮 Run 于 2026-09-07 08:03:02 UTC 完成，云端产物为 [Draft PR #1](https://github.com/erich04/devflow-mini-agent-live-20260906/pull/1)。第二轮于 09:04:35 UTC 完成，产物为 [Draft PR #2](https://github.com/erich04/devflow-mini-agent-live-20260906/pull/2)。所有时间均为 UTC。受控测试中的 fake Provider 不计入真实调用证据。

**证据口径更正（2026-09-07）：上面的 completed 证明两次已记录的流程执行完成，不能直接等同于“只给一句原始需求即可完整接球交付”的验收通过。** 本轮曾在产品外准备仓库副本，并在设计失败后向需求/规划补充 README 摘要、测试命令组成及基线信息；修复后的复验也复用了项目和配对。准备已有测试仓库属于环境配置，不代表产品自动建仓，但额外提供实施上下文会影响对产品自行承接原始需求能力的判断。用户要求的小需求端到端验证不应被另行解释为自动建 GitHub 仓库或生成项目脚手架。按一句原始需求、先 Team Request 再 pairing 的补验见[后续记录](one-sentence-validation-2026-09-07.zh-CN.md)，该补验已完成，独立交付为 Draft PR #3；原始记录与补验记录分别保留。

## 范围与边界

需求仅修改 mini Agent 的 README：在开头项目摘要之后新增独立段落，精确内容为：

> Use this repository to validate one small change through clarification, design, implementation, verification, and Draft PR delivery in AI DevFlow Studio.

验收要求：该句在指定位置恰好出现一次，其他内容逐字节保留，只变更 README.md，`corepack pnpm verify` 通过，经产品正常 GitHub Delivery 创建 Draft PR，不合并。

- 新建私有仓库：[erich04/devflow-mini-agent-live-20260906](https://github.com/erich04/devflow-mini-agent-live-20260906)，repository ID `1359740566`。
- main 基线：`8491ff3f20918cd4f26390fa34373b7d224aecf4`。
- Team Project：`p-mini-agent-isolated-live-20260906`；Local Project：`local-151324aa88ad`。
- 源 checkout：`out/live-provider-20260906/mini-agent-isolated`；实现、依赖安装和验证均由产品在 managed worktree 执行。
- Provider：已安全保存的 DeepSeek direct provider，模型 `deepseek-v4-flash`；编码使用 DevFlow Native v2 和同一 Provider。
- Team 与 Desktop 预算：月限额 $1.00，预警 $0.50。Provider usage 来自实际返回，应用费用估算不等同于云端账单。
- Team 使用真实 GitHub 登录、已有 API/Postgres 服务；修复后的生产 Web 副本运行于 4313，Desktop 使用实际 Electron main/preload 与既有 local-development 配置。
- 原 mini Agent、原 Team 绑定、历史 Run 和原 Docker 服务保留。未直接改写工作流数据库、伪造真实登录、手工 push 或使用 gh 创建交付 PR。真实界面通过 CUA 操作。

## 项目创建与配对

1. 在 Team Web 从空表单创建新项目；复现过期登录，并经正常 GitHub 重新登录恢复输入，同一 slug 只创建一次。
2. 导入新仓库的独立 clone，以 Web 发放的一次性配对码完成 Desktop 与 Team Project 的绑定。
3. 在 Team Web 创建 Work Request，从 Desktop Inbox 创建本地 Run，经产品同步 Team 投影。
4. 在现有 GitHub App 安装 `153168718` 的 Selected repositories 加入新仓库并保存；原两个仓库保留。GitHub 页面确认安装已更新，共 3 个仓库。
5. 正常 Team UI 验证新仓库绑定：`github-binding-6149fa34-e263-4a1b-8234-3b38e811e6d5`，active v1，验证时间 `2026-09-07T07:55:32.607Z`。原项目绑定仍为 active。

Mac 自动锁屏、GitHub Confirm access 和 selected repository 授权曾阻断操作，均在恢复正常用户界面后继续。Web 验证运行副本曾缺少 static，重新配套复制 standalone/static 后恢复；该项属于运行环境准备错误。重复使用已消费配对码产生的一次 401 不计为产品缺陷。

## 初始失败样本

初始 Work Request `work-request-b4312a53-770c-41d4-be1e-19edbd78cbc0`，Run `run-work-request-80b23c151926198ef4747666971cafb9` 保留在方案 Gate。

| 调用 | 时间 | 输入 / 输出 token | 结果 |
| --- | --- | ---: | --- |
| 澄清 | 04:41:34 | 401 / 841 | 成功 |
| 需求审查 | 04:43:41 | 4804 / 694 | warn，非阻断 |
| 设计 | 04:50:57 | 1483 / 878 | 重复澄清格式，缺实际实施内容 |
| 方案审查 | 04:52:16 | 4918 / 649 | 指出设计不足；按质量阻塞处理，记录 #69 |

## 第一轮完整交付

Work Request：`work-request-010522fc-b32a-4a5e-b8cf-4671316a9410`。

Run：`run-work-request-09b489a2902d1c7581979830d63c9210`，最终 completed，v12。

为规划补充了 README 当前摘要、verify 的组成、依赖命令与 main 基线，并要求编码 Agent 在编辑前自行核实。这些输入没有被当作已经执行的测试证据。

| 阶段 | 时间 | 实际结果 |
| --- | --- | --- |
| 澄清 | 06:54:52 | DeepSeek，547 / 803 token |
| 需求审查 | 06:58:16、06:58:55 | DeepSeek，4937 / 359、4937 / 368；均为 warn。界面反馈延迟造成一次重复调用，全部保留计量 |
| 需求 Gate | 07:09:26 | UI 批准 |
| 设计失败 | 07:12–07:20 | 4 次空 content 导致 schema_invalid；Run 不推进。已知一次返回 1942 / 1953 token，但旧实现未持久化 usage，记录 #70，未补造历史账目 |
| 修复后设计 | 07:24:52 | DeepSeek，2228 / 1192 token，完整实施 Markdown 正文 |
| 方案审查 | 07:27:03、07:29:45 | DeepSeek，4601 / 747、4601 / 1196；warn。一次重复调用保留 |
| 方案 Gate | 07:31:20 | UI 批准 |
| Native Coding | 07:33:50–07:34:46 | 两次真实 Provider 调用合计 5954 / 213 token；独立 worktree 安装依赖、提议精确 diff、UI 批准、实施并执行测试 |
| Native 内部测试 | 07:34:41 | `coding-test-61b4872f-34ec-4c42-84b0-f3e62308359f`，4955 ms，exit 0 |
| 正式 Test 首次 | 07:36:43 | 错误使用源 checkout，exit 2；失败证据 `evidence-6c0655cf-2abc-4e7c-862d-e41a5fe7baf8` 保留，记录并修复 #71 |
| 正式 Test 重试 | 07:52:46 | 在匹配的 managed worktree 执行 verify，6351 ms，exit 0；`evidence-aefa142c-e837-48a6-a35c-dfd79ae1e16d` |
| PR package | 07:53:18 | 正常产品生成 |
| 准备交付及精确 commit 测试 | 07:57:34 | 产品创建 commit 并再次 verify，2628 ms，exit 0，证据绑定交付 SHA |
| Team Delivery 审批与发布 | 08:00:14 | 在 Web 核查仓库、commit、diff、测试后审批，产品发布 Draft PR #1 |
| 验收 bundle | 08:01:27 | 产品生成 |
| 真实最终审查 | 08:01:50 | DeepSeek，3659 / 917 token，warn；发现上下文缺失真实交付和已有 policy/bundle，记录 #72 |
| 业务验收 | 08:03:02 | 独立核实实际代码、测试与 Draft PR 后正常 UI 通过；Run completed |

Native Coding Run：`coding-run-87f8f1eb-8e4e-4426-908f-29690b485946`。

交付 commit：`0356f7735957bcbcf1ca7282e00bbcc677034968`，父 commit 为上述 main 基线。真实 Git diff 只包含 README.md 的 2 行新增；独立字节比较验证指定句子一次、位置正确、其他内容不变。

- Delivery intent：`github-delivery-intent-e8cd4201-9739-4a60-a4f6-51db7c7dfde7`。
- Team request：`github-delivery-23254efd-4f76-47c2-8352-e2ad7149c58d`，completed。
- 精确 commit 测试：`github-delivery-test-43c1f278-1c23-4a2c-99d9-d94a8febc0a6`。
- [Draft PR #1](https://github.com/erich04/devflow-mini-agent-live-20260906/pull/1)：GitHub 只读核实 OPEN、isDraft=true、base=main、head=上述 SHA、changedFiles=1。

## 修复后的完整复验

第二轮从 Team Web 新需求开始，复用已创建并授权的隔离项目，保留第一轮历史。

- Work Request：`work-request-16b5064a-0c20-4788-a22f-bd431e706c3f`。
- Run：`run-work-request-d276f93457e0da98a0a1ef29fe9c7efa`。
- 标题：README workflow note - final regression。
- 同一 README 小需求，由真实 DeepSeek 重新澄清、生成设计与审查，继续 Native Coding、正式测试、云端交付和最终验收。

最终状态：**completed，v11，2026-09-07T09:04:35.065Z**。经 Desktop 正常“同步团队”操作后，Postgres 只读核验两轮 Run 均为 completed，云端交付请求也为 completed。

| 阶段 | 时间 | 实际结果 |
| --- | --- | --- |
| 澄清 | 08:25:35 | DeepSeek，547 / 656 token |
| 需求审查 | 08:26:45 | DeepSeek，5809 / 624；warn，正常 UI 通过 Gate |
| 设计 | 08:30:17 | DeepSeek，1923 / 1388；完整实施方案 |
| 方案审查 | 08:31:16 | DeepSeek，5492 / 710；warn，正常 UI 通过 Gate |
| 首次 Native Coding | 08:33:25–08:40:06 | 初始分析/变更/repair 三次真实调用合计 9084 / 409 token；依赖文件丢失导致测试失败，错误 repair 提议经 UI 拒绝，运行 interrupted |
| 修复后 Native 重试 | 08:48:00–08:48:38 | 在持久 worktree 中正常 bootstrap，两次真实调用合计 6082 / 259 token，精确变更审批后测试通过，4384 ms |
| 正式 Test | 08:50:57 | 最新成功 Coding worktree 中 verify 通过，2594 ms，exit 0 |
| PR package | 08:52:07 | 产品正常生成 |
| 精确 commit 测试 | 08:53:02 | 产品固定 `33d2431` 并 verify，2609 ms，exit 0 |
| Team 审批与发布 | 08:59:45 | 正常 Web 审批，产品创建 Draft PR #2 |
| 验收 bundle | 09:01:05 | 实际 commit、测试、diff、Provider 来源及历史失败完整绑定 |
| 最终真实审查 | 09:02:30 | DeepSeek，5862 / 410；正确确认实现与交付，保留 3 项独立核实提示 |
| 业务验收 | 09:04:35 | 直接核实 GitHub 后，经产品 UI 通过，Run completed |

第二轮首次 Native Run `coding-run-6f83b9fe-67c3-4859-9b0c-ad826e893270` 的 bootstrap 返回成功，之后新旧两个系统临时 worktree 的部分依赖文件在 08:35:04–05 消失；实际测试出现 `MODULE_NOT_FOUND`。删除来源未知，未据此断言是 OS 清理。模型 repair 提议删除正确新增的句子，已在 UI 拒绝。发现并修复 #74 / #75 后，同一 Workflow 正常新建 Coding Run 重试，没有重写失败记录、手工补装依赖或人工修改目标代码。

成功 Coding Run：`coding-run-cc5ad22e-1e6c-440c-b450-40a0a84c27c1`，新 worktree 位于当前 Desktop profile 的 `coding-worktrees`。原临时路径记录保持原义，失败工作区由产品拒绝流程正常清理。

- 内部测试：`coding-test-2ef087c6-bf45-47cd-a9a2-d0ee99ed2c97`。
- 正式测试：`evidence-53190caf-2b53-49a1-9413-01271f0c62b0`。
- 精确 commit 测试：`github-delivery-test-fc9285b3-e1db-4bab-8f5d-32a206209f8d`。
- 交付 commit：`33d243176445cbda10b4a299f8ffb2dc9fc384f9`。
- Delivery intent：`github-delivery-intent-2044346b-2f91-4f78-b8b6-8be7e1c1f32f`。
- Team request：`github-delivery-8e8617f9-b140-4cb2-9ab6-82c68b83cc36`，completed。
- 最终审查：`agent-review-review-request-1788771750830-electron`。

#72 的实际复验：Review manifest 中 policy、github_delivery、acceptance_evidence、test_evidence 均为 available，完整内容以确定性分块传入。模型正确区分历史失败与交付 commit 的成功验证，也识别真实 Provider 执行证据，没有再把已有 policy 或验收 bundle 报为缺失。

最终审查仍为 warn，不把它表述为零风险。三个独立核实提示分别是句子全文件唯一性、PR 当前 Draft 状态、完整变更文件范围。随后直接读取 GitHub 当前 PR、files 和精确 commit 的 README，确认：OPEN、Draft、未 merge；只变更 README，2 行新增；指定句子一次且位于要求位置；其余字节与 main 基线完全一致。README SHA-256：`e2feb7f9bf29661f67705c0f1a236426db4b7ef68fc627f926c5bbe352680538`。脱敏检查结果保存于 `out/live-provider-20260907/final-delivery-verification.json`。

## Issue 与代码修复

| Issue | 修复与验证 |
| --- | --- |
| [#66](https://github.com/erich04/ai-devflow-studio/issues/66) | 过期登录创建项目报整页错误：Server Action 返回结构化结果，保留表单并支持恢复登录；真实过期、重新登录及仅创建一次通过。 |
| [#67](https://github.com/erich04/ai-devflow-studio/issues/67) | 创建成功无反馈、列表不刷新：显式请求状态及 revalidation，移除干扰的根 loading 边界；生产 UI 无手动刷新出现新项目。 |
| [#68](https://github.com/erich04/ai-devflow-studio/issues/68) | 第二项目无预算入口：保留所选 projectId、允许选择预算项目并重置面板；真实新项目预算保存和重复编辑通过。 |
| [#62](https://github.com/erich04/ai-devflow-studio/issues/62) | Desktop 预算已存但顶部 not loaded：共享项目预算 hook，区分策略加载和执行评估，隔离异步返回；真实重启恢复 $1.00 / $0.50 通过。 |
| [#69](https://github.com/erich04/ai-devflow-studio/issues/69) | 设计格式复用澄清：统一阶段输出指令，强制完整非空 content，并提供完整 JSON 形状示例；真实后续设计和审查通过。 |
| [#70](https://github.com/erich04/ai-devflow-studio/issues/70) | schema_invalid 丢失已返回 usage：错误携带经过验证的实际 token 计量，提取失败审计模块，原子写入 Trace/Event/usage，唯一 ID 区分失败重试；诊断脱敏、有界。回归覆盖 SQLite 持久化失败、版本冲突、重开数据库、重复失败和无可信 usage 不估算。未补造旧调用记录，也未声称故意制造了新的真实坏响应。 |
| [#71](https://github.com/erich04/ai-devflow-studio/issues/71) | 正式 Test 执行源 checkout：提取 Workflow Test 命令，选择当前 Build 的最新成功 Coding worktree，校验仓库/分支/HEAD/关联并持有 workspace lease 至证据原子提交；保留无 Coding 的旧本地路径。实际失败后正常 UI 重试通过。 |
| [#72](https://github.com/erich04/ai-devflow-studio/issues/72) | 验收审查遗漏已完成交付与策略：按 Local/Team 映射加载 policy；投影已有 bundle/PR；bundle 包含精确 SHA、对应测试、真实 diff 和 Provider 执行来源；区分历史失败、规划审查与最终验收。上下文与证据错配回归通过；第二轮真实最终审查正确识别已有证据。 |
| [#74](https://github.com/erich04/ai-devflow-studio/issues/74) | Native repair 强制无关改动、repair 失败时漏存测试：允许无法安全修复的空 changes，原请求与路径约束保持；先保存真实失败测试，再做 repair。实际错误提议已拒绝，真实 Git/Node 回归覆盖无法修复与坏响应。 |
| [#75](https://github.com/erich04/ai-devflow-studio/issues/75) | 生产 worktree 默认共享系统临时目录：main 装配到当前 profile 的持久目录。Electron 实际创建路径断言先失败后通过；真实新 Coding Run 在持久路径完整执行和交付。 |
| [#73](https://github.com/erich04/ai-devflow-studio/issues/73) | Postgres smoke 旧假设：读取当前 schema 版本，构造完整 Gate Review 测试样本，允许布尔型 includeInProviderPrompt 元数据且保留其他泄漏检查；独立空库完整 smoke 通过。 |

Issue 中已保留原始问题与复测进展。本分支修复尚未发布，不将本地实现状态等同于已经合入主分支。

## 自动化验证

- `corepack pnpm verify`：260 个测试文件、3671 个测试通过，类型检查和跨平台检查通过。
- `corepack pnpm build` 通过。
- `test:e2e`：9 个受控场景通过。
- `test:build-output-smoke`：API、Web、Worker 生产产物检查通过。
- `test:postgres-smoke`：独立临时 Postgres、全新空库通过；从 v12 保留凭据迁移至 v25，并覆盖后续 API、投影、审批等既有检查。未对 live 数据库执行 smoke。
- `test:electron-smoke` 通过，包含实际 main/preload、独立 profile 下工作区路径、权限、运行与重启持久化检查。
- 临时 Postgres 容器已停止并删除；真实 API/Postgres/Web 服务保留。

此前微重构和真实流程期间所有失败证据均保留。自动化 smoke 使用受控 Provider/仓库，只证明产品契约；本文真实交付部分才是云端调用与 Draft PR 的实证。

## 本地提交

分支：`codex/architecture-micro-refactor-20260906`，应用修复尚未推送或合入。除已有 `output/` 外，本轮修改均纳入本地提交。

| 提交 | 范围 |
| --- | --- |
| `4b86e93` | Local MCP 持久化边界微重构 |
| `94bd992` | Web 项目创建与预算入口 |
| `f03152b` | 阶段输出契约与设计正文验证 |
| `f4d7fd4` | Desktop 项目预算共享状态 |
| `69721d0` | Workflow Test 的 worktree 选择与执行边界 |
| `d94e1a8` | 失败审计与已返回 Provider usage |
| `0d734b1` | 明确完整设计响应形状 |
| `836c588` | 验收的真实交付、测试与 policy 上下文 |
| `cbee48b` | 无安全 repair 出口与失败测试保留 |
| `7ae98b5` | 当前 profile 的持久 Coding worktree |
| `04f21b2` | Postgres smoke 迁移与审查夹具 |
