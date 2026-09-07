# 一句原始需求的端到端补验 · 2026-09-07

状态：**本轮已完成。Team Web 创建 Project / Request → Desktop pairing / 承接 → 澄清 → 设计 → Native 实施 → 测试 → GitHub Draft PR → Acceptance → Team Web 回传完成。**

Run `run-work-request-e4cd15efee768f98033566c237bdd90d` 在 `2026-09-07T12:20:54.875Z` 达到 completed / version 11。Team Web 显示 100% 和全部节点 DONE。交付为 [Draft PR #3](https://github.com/erich04/devflow-mini-agent-live-20260906/pull/3)，未合并。

## 验收口径

在已有 mini Agent 测试仓库上，从真实 Team Web 的新 Project 和一句原始 Work Request 开始。需要模型的阶段调用真实 Provider；项目创建、配对、审批和交付调用产品真实服务。Team API/Postgres/Web 是本地启动的真实服务；外部云端包括 DeepSeek 和 GitHub，不能把 localhost Team 服务表述为已部署的 SaaS。

原始需求只有：

> 请把这个 mini Agent 项目的 README 主标题改为“Mini Agent — Ready for DevFlow”，其余内容保持不变。

未补充原文件正文、原标题、测试脚本、实施步骤或设计答案。未复用旧 Run、设计、测试或 PR。允许正常项目配置与产品审批；本轮无需额外回答需求问题。已有测试仓库的干净 clone 是本地环境准备，不证明产品自动创建 GitHub 仓库或脚手架。发布终点为 Draft PR 与业务验收，不包括合并、应用部署或生产上线。

## 实际过程

| 环节 | 本轮证据 |
| --- | --- |
| Team Project | Web 创建 Mini Agent One Sentence QA 20260907，ID `p-mini-agent-one-sentence-20260907` |
| Work Request | `work-request-9e8069f4-255d-429c-ae74-3f59d9a58048`，标题“修改 README 主标题”；`2026-09-07T11:53:22.179Z` 创建，先于 Desktop pairing |
| 本地准备 | main 干净 clone 至 `out/one-sentence-20260907/mini-agent`；基线 `8491ff3f20918cd4f26390fa34373b7d224aecf4` |
| 导入与 pairing | Electron 目录选择器导入 `local-5656958e0917`；初始无 Run；使用 Web 一次性配对码绑定后 Inbox 显示原始请求 |
| 承接 | 产品创建本地 Run，`2026-09-07T12:03:15.471Z` materialized |
| 澄清与需求 Gate | 真实 DeepSeek 生成澄清、审查，正常审批 |
| 设计与方案 Gate | 真实 DeepSeek 生成设计、审查；设计明确实施前检查与 diff 验证；非阻塞警告经核对后正常审批 |
| Native Coding | `coding-run-1e67bcd6-bf82-4452-9073-73ebd4799c80`；产品创建持久化 worktree、准备依赖、读取仓库、调用 Provider、提出精确修改 |
| 修改审批 | Change Set `coding-change-set-73d513a8-97ac-4b49-ae24-c858ff212f8a`；只替换 README H1，核对后在产品批准，由 Native 应用 |
| 测试 | Native、正式 Test、Delivery 精确 commit 三次 `corepack pnpm test` 均通过：4 个文件、6 个用例；测试命令由产品导入时识别 |
| 交付 | 产品生成 PR 包，Prepare 固定 commit 并复测；Web 审批精确 intent；Desktop 发布分支、创建 Draft PR #3 |
| 验收 | 产品生成 Acceptance Bundle；真实 DeepSeek approve；正常通过 Gate；两端同步完成 |

没有手工修改目标代码、安装执行工作区依赖、写数据库推进状态，或手工 push / gh 创建交付 PR。

## 真实 Provider 调用

模型均为 deepseek-v4-flash。初次全流程：

| 阶段 | UTC 时间 | 输入 / 输出 token |
| --- | --- | --- |
| 澄清 | 12:03:53.790 | 323 / 430 |
| 需求审查 | 12:04:56.018 | 4694 / 323 |
| 设计 | 12:06:02.195 | 1405 / 1134 |
| 设计审查 | 12:08:34.113 | 4842 / 530 |
| Native analysis | 12:15:57.259–12:15:58.649 | 3918 / 66 |
| Native initial | 12:15:58.663–12:15:59.374 | 3864 / 66 |
| 最终验收审查 | 12:19:58.584 | 5026 / 235 |

7 次真实模型调用，共 26856 token。产品记录费用合计约 $0.01250，不等同于云端账单核销；显式预算为 $1 / 月、$0.50 预警。Native 调用记录包含 HTTP 200、请求耗时、选取的仓库内容和费用归档。

## 交付独立核验

- SHA `50e6c0d2169dc37fa040828cc283891254f408ab`。
- Delivery Request `github-delivery-87290512-959a-408d-b52b-fb2a1ea65d21`，completed，attempt 1。
- 精确提交测试 `github-delivery-test-6fef9ce4-deab-4584-ad87-8c9a35efad23`，sourceCommitSha 与上述 SHA 一致；passed / exit 0 / 1290 ms。
- 正式 Test `evidence-e53e8db1-04b2-481b-892b-aff8863d0181`：passed / exit 0 / 1366 ms。
- Native Test `coding-test-81bde49f-4df4-409e-aa5c-de64856757a5`：passed / exit 0 / 2326 ms。
- 只读 Git 核验：README 与基线仅替换该标题的字节结果完全一致；仅 README.md，1 insertion / 1 deletion；worktree clean。
- GitHub 独立只读核验：OPEN + Draft，head SHA 一致，仅该 README 修改。
- 最终审查 `agent-review-review-request-1788783598544-electron` 确认标题、其余内容不变、精确 commit 测试及 PR，并将早期警告视为历史。余下 advisory 涉及没有额外人工审查说明和 Knowledge chunk；精确修改、Web 交付审批与最终人工核验均实际执行。

## 本轮问题与修复

- 原生控制通道曾返回 noWindowsAvailable；恢复后 CUA 能自动切换 Chrome / Electron，完成界面操作。无需用户一直保持 Desktop 在前台；操作时桌面需可访问，Provider 与测试可后台执行。
- 测试 Web 在 4313 重启时漏配 DEVFLOW_WEB_APP_URL，仓库撤销请求被同源校验拒绝。补齐正确来源后正常操作成功。这是测试启动配置错误，没有绕过同源校验。
- 产品要求同一组织内仓库只有一个 active binding。正常撤销旧隔离绑定（revoked / v2），再绑定新 Project（active / v1）；旧 PR #1、#2 保留。原 `p-devflow-mini-agent` / repository ID 1351895943 仍 active / v1，原仓库未改。
- [Issue #76](https://github.com/erich04/ai-devflow-studio/issues/76)：设计 Review 错把全局测试规则和本次 Review 输出当成输入前置条件。已用失败用例复现并修复阶段投影与提示；实际 Gate 授权规则不变，显式输入要求仍保留。
- [Issue #77](https://github.com/erich04/ai-devflow-studio/issues/77)：已有 Native diff、精确测试和上游 PR 包仍显示缺失。已用失败用例复现并接入对应真实证据；失败测试仍显示 failed，不按节点完成状态推断证据存在。

初次全流程在 #76、#77 修复前正常带 advisory 完成。修复后的验证单独记录，不改写首次执行历史。此前报告中的全量测试、旧 PR 和保留的失败 Run 也不替代本轮证据。

## 修复后的复验

修复提交：`c6f0d20`，保留在本地 `codex/architecture-micro-refactor-20260906` 分支，未推送或合并产品修复。

- 先验证失败用例：#76 两项失败、#77 三项失败；修复后定向测试通过。
- 全量测试：260 文件、3676 用例通过。类型检查、cross-platform、root build 通过；这些检查覆盖 verify 的组成步骤。
- E2E：9 passed；Electron smoke exit 0；独立临时 Postgres smoke passed。未对 live 数据库执行 smoke，临时容器已停止。
- 构建后重启真实 Desktop，已完成 Run、pairing、PR 与测试记录保留。CUA 实际确认 build 的 Coding diff ready、PR 的 Handoff readiness ready、交付版本测试 passed，以及 Acceptance 的上游 PR Delivery Package ready。
- #76 的额外真实回归请求为 `work-request-4e291e09-b84e-4422-816b-6b807ebc42f7`，Run `run-work-request-d31f23324f30654ed290208e35f85802`。它仅验证到设计审查，不冒充另一轮完整交付，也不创建 Coding Run 或测试。
- 上述回归通过真实 Provider 完成澄清、需求审查、设计与设计审查。在测试记录为 0 的情况下，设计审查 `agent-review-review-request-1788784806181-electron`（12:40:06.212Z）记录 agent_review 为 not_applicable、test_evidence 为 optional，明确说明实施测试应在设计审批后产生，设计合理且无阻塞项。
- 模型仍把“测试尚未产生但不属于设计缺口”的解释放进 missingEvidence 数组，因此 advisory 仍有警告；保留原始输出，不宣称零警告或删除模型结论。仓库核验建议由真实实施阶段解决。
- 附加回归时浏览器会话过期，创建请求仅显示通用失败；正常刷新、GitHub 登录后成功恢复。该反馈问题作为 #66 的相关后续现象记录，不影响已完成的首次全流程。

此前非阻塞积压（如 #60、#61、#63、#64、#65、新 Web 功能迁移 #52、OpenCode 验证 #56）仍独立存在；此次真实通过的是 Direct DeepSeek + DevFlow Native 路线，不能推导为所有 Provider/执行器和 UI 问题均已解决。
