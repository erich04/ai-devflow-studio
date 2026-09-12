# 空白项目连续端到端验证（进行中）

## 验收目标

从本轮首次创建的空白 Team Project、Work Request、GitHub 仓库、本地目录和 Desktop 数据档案开始，记录首次配对，使用真实 Provider 完成需求承接、澄清、设计、实施、测试、GitHub 交付和业务验收。若包含合并或发布，需要单列它们的实际执行者、提交和可访问结果；Draft PR 不能代表生产发布。任何阶段尚未验证时，不以旧项目的分段成功代替。

## 当前证据

- 产品基线：main `582976a0b4c438d360655e81577aa62dd29fcca1`。
- 初始独立验证分支：`codex/blank-project-e2e-20260911`；PR #105 合并后，继续修复使用基于 main `cab6d073` 的 `codex/blank-project-live-fixes-20260912`。用户原 checkout 的未提交修改保留。
- 全新 Desktop 档案 `blank-project-e2e-20260911` 实际启动，关闭 demo data / fake runtime。真实界面初始为 0 Run、未选择项目、未配对，无历史证据。
- 新 GitHub 仓库：[erich04/devflow-blank-mini-agent-20260911](https://github.com/erich04/devflow-blank-mini-agent-20260911)，private，Repository ID `1366921281`，创建于 `2026-09-12T03:53:36Z`（当地 9 月 11 日）。初始 size 为 0，Git refs API 返回 `409 Git Repository is empty`。仓库由操作者通过 GitHub CLI 首次创建，不是 DevFlow 自动建库能力的证明。
- 新本地目录 `blank-mini-agent` 的初始条目为空。通过真实 Desktop 的原生目录选择器首次接入，未写代码、未生成脚手架、未创建工作流或配对。
- GitHub CLI 旧登录失效，用户完成 device flow 后独立查询确认当前身份 erich04；未读取或输出访问令牌。
- 本轮服务端使用本机 Docker API/Postgres（4310）及候选生产 Web（4313）；真实外部服务是 DeepSeek 和 GitHub。这验证 Web/服务端与 Desktop 的完整交互，但不是远端 DevFlow 云部署验证。
- 用户已确认 GitHub App 安装 `153168718` 将新仓库加入 Selected repositories。`2026-09-12T04:08:46Z` 使用产品 GitHub App 客户端只读核验通过，返回本轮 Repository ID、仓库名称、private 状态及默认分支 main；未提前写入 Team Project 或仓库绑定记录。
- 首次本地 Git 初始化及初始空提交 `4bda12d` 已执行。初始提交无代码、脚手架、README 或测试文件，用于现有受管 worktree / Draft PR 流程要求的 Git 基线。这是本轮操作者执行的初始化步骤，不是复用旧项目，也不是 DevFlow 自动初始化能力的证明。
- 旧 DeepSeek 凭据导入曾遇到 macOS `errSecAuthFailed`（-25293）；用户随后在本轮新档案的正常 Provider 表单保存 Key，此接入问题已解除。配置为官方 `https://api.deepseek.com` / `deepseek-v4-flash`，无明文凭据进入聊天、日志或测试文档。
- 实际 Web 创建新 Team Project `p-blank-mini-agent-e2e-20260911`，首次绑定本轮新仓库，并在该 Project 创建新 Work Request `work-request-bce761e3-69f3-4c8d-a42b-43734b313437`。原始一句话：“从空白仓库创建一个中文任务清单网页，支持新增、完成、删除任务，刷新后保留内容，并提供自动化测试和运行说明。”
- 在上述新对象创建后，通过 Web 首次生成 pairing code，在新 Desktop 档案首次消费。Desktop Inbox 承接后创建唯一 Run `run-work-request-b88e91b724aaffc72b522a4932abd2b4`，本地项目为 `local-6e83099daa26`。没有复用旧项目、旧需求或旧 Run。
- 2026-09-12T04:59:18.068Z，真实 Direct DeepSeek 成功生成首版澄清；Provider 报告 input 362 / output 806 tokens，产品按定价快照估算 $0.001038168。首次失败的旧记录保留，重试沿用同一个需求。操作者随后通过“结构化修订意见”明确原生前端、localStorage、Node 内置测试及浏览器验收范围，请求真实 Provider 生成修订版。

## 已发现问题

### #104：空目录继承上级仓库边界

[Issue #104](https://github.com/erich04/ai-devflow-studio/issues/104) 来自本轮真实目录选择：空目录位于另一个仓库内，Desktop 显示上级仓库的分支。隔离真实 Git 回归进一步证明 createManagedCodingWorkspace 会从祖先提交创建工作树，sourcePath 却仍标记空目录。

反例通过一次约 1.2 秒的测试稳定复现。测试仅在临时 fixture 中创建分支；用户原仓库没有因此创建分支或启动 Provider。只读现场检查确认目录为空、不是符号链接，且它与 Git 返回的实际根目录不同。

修复统一检查实际路径是否就是 Git working-tree root，用于 Desktop Git 状态、Coding 就绪/工作树创建和本地只读 Agent 执行前校验。拒绝祖先继承与 `.git` 元数据目录；独立嵌套仓库、路径别名和正常 linked worktree 保持支持。

回归先失败后通过，27 项相关测试通过。完整 `corepack pnpm verify` 通过：273 个测试文件 / 3819 项测试、全仓类型检查与 Web 构建、跨平台检查。Desktop build 通过。重启实际 Desktop 后，同一空目录显示 `not a git repo`，不再显示祖先分支，0 Run / 未配对状态保留。PR #105 已于 2026-09-12T04:24:25Z 合并，Issue 已关闭。

### #106：Windows 集成测试总时限不足

[Issue #106](https://github.com/erich04/ai-devflow-studio/issues/106) 来自 PR #105 的 Windows CI：验证 Native Coding 修复阶段 Provider 超时的集成测试耗时 5078 ms，超过 Vitest 默认 5000 ms；同批其余 3814 项通过，4 项按平台跳过。

本地只为真实 Git 启动增加 500 ms 延迟，即可复现同一外层测试超时。将这一个场景的总时限设为与相邻持久化重启测试相同的 15 秒后，同一延迟场景耗时 6249 ms 并通过；Provider 自身的 25 ms 超时和失败轨迹、无残留审批、工作树已删除断言保持不变。去掉延迟后，相关三个文件的 22 项测试通过。诊断包装器位于验证证据目录，未进入产品或实时验证环境。PR #105 的 macOS、Windows、Postgres、Docker smoke、Docker lifecycle 五项 CI 均通过（run 34672418242），合并提交 `cab6d073` 与候选代码树相同；Issue 已关闭。

### #107：同步团队后预算显示未刷新

[Issue #107](https://github.com/erich04/ai-devflow-studio/issues/107) 来自本轮 Web 首次保存预算后，Desktop 点击“同步团队”仍显示“未配置”；正常 reload 后才显示服务端保存的 $1.00/月、$0.50 预警。

同步完成回调原先只刷新 Gate policy，未刷新独立的 runtime budget hook。新增 App 交互回归先失败，再将预算刷新加入同一个成功同步回调；读取失败时清除旧预算显示。实际 Web 将预警改为 $0.60，Desktop 仅点“同步团队”即显示 $0.60；随后在 Web 恢复 $0.50 并再次同步。没有重载窗口、重新 pairing 或新建 Run。

### #108：真实阶段 Provider 失败诊断丢失

[Issue #108](https://github.com/erich04/ai-devflow-studio/issues/108) 来自首次真实澄清失败（04:50:58.829Z），审计只记录通用“执行失败”。初次失败的底层原因无法从旧记录追溯，不能把后续成功当作已经证明其根因。

本地真实 HTTP fixture 在生产 Stage Executor → SQLite 审计链复现：明确 401 也被替换为通用错误。修复复用现有 Provider 分类，保留安全的 HTTP、投递与费用状态；不保留原始响应、凭据、提示词或底层 cause。覆盖 401、429、503、无效响应 JSON、无效模型 JSON、断开连接，以及原有未知错误脱敏/无产物/不推进工作流行为。相关 233 项回归、全仓类型检查与 Desktop build 通过。重启同一档案后，原需求真实澄清重试成功。

## 尚未完成

需求澄清修订及其门禁、方案设计、代码生成、应用测试、GitHub Delivery、业务验收以及最终合并/发布尚待完成。#107、#108 仍需推送及云端 CI 后关闭。本文件不是端到端通过报告。
