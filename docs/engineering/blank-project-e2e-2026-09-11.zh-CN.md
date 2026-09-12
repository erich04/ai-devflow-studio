# 空白项目连续端到端验证（进行中）

## 验收目标

从本轮首次创建的空白 Team Project、Work Request、GitHub 仓库、本地目录和 Desktop 数据档案开始，记录首次配对，使用真实 Provider 完成需求承接、澄清、设计、实施、测试、GitHub 交付和业务验收。若包含合并或发布，需要单列它们的实际执行者、提交和可访问结果；Draft PR 不能代表生产发布。任何阶段尚未验证时，不以旧项目的分段成功代替。

## 当前证据

- 产品基线：main `582976a0b4c438d360655e81577aa62dd29fcca1`。
- 独立验证分支：`codex/blank-project-e2e-20260911`。用户原 checkout 的未提交修改保留。
- 全新 Desktop 档案 `blank-project-e2e-20260911` 实际启动，关闭 demo data / fake runtime。真实界面初始为 0 Run、未选择项目、未配对，无历史证据。
- 新 GitHub 仓库：[erich04/devflow-blank-mini-agent-20260911](https://github.com/erich04/devflow-blank-mini-agent-20260911)，private，Repository ID `1366921281`，创建于 `2026-09-12T03:53:36Z`（当地 9 月 11 日）。初始 size 为 0，Git refs API 返回 `409 Git Repository is empty`。仓库由操作者通过 GitHub CLI 首次创建，不是 DevFlow 自动建库能力的证明。
- 新本地目录 `blank-mini-agent` 的初始条目为空。通过真实 Desktop 的原生目录选择器首次接入，未写代码、未生成脚手架、未创建工作流或配对。
- GitHub CLI 旧登录失效，用户完成 device flow 后独立查询确认当前身份 erich04；未读取或输出访问令牌。
- 远端 DevFlow 部署地址待用户确认。目前检测到的 Web/API/Postgres 为本机 Docker 自托管 QA，不将其表述为远端云部署。
- 用户已确认 GitHub App 安装 `153168718` 将新仓库加入 Selected repositories。`2026-09-12T04:08:46Z` 使用产品 GitHub App 客户端只读核验通过，返回本轮 Repository ID、仓库名称、private 状态及默认分支 main；未提前写入 Team Project 或仓库绑定记录。
- 首次本地 Git 初始化及初始空提交 `4bda12d` 已执行。初始提交无代码、脚手架、README 或测试文件，用于现有受管 worktree / Draft PR 流程要求的 Git 基线。这是本轮操作者执行的初始化步骤，不是复用旧项目，也不是 DevFlow 自动初始化能力的证明。
- 复用旧 DeepSeek 凭据时，macOS safeStorage 返回 `errSecAuthFailed`（-25293），没有向新档案转移凭据或执行 Provider 调用。实际 Provider 表单已填写名称、官方地址和模型，等待用户在正常界面保存 Key；不在聊天、文件或日志中输出明文凭据。

## 已发现问题

### #104：空目录继承上级仓库边界

[Issue #104](https://github.com/erich04/ai-devflow-studio/issues/104) 来自本轮真实目录选择：空目录位于另一个仓库内，Desktop 显示上级仓库的分支。隔离真实 Git 回归进一步证明 createManagedCodingWorkspace 会从祖先提交创建工作树，sourcePath 却仍标记空目录。

反例通过一次约 1.2 秒的测试稳定复现。测试仅在临时 fixture 中创建分支；用户原仓库没有因此创建分支或启动 Provider。只读现场检查确认目录为空、不是符号链接，且它与 Git 返回的实际根目录不同。

修复统一检查实际路径是否就是 Git working-tree root，用于 Desktop Git 状态、Coding 就绪/工作树创建和本地只读 Agent 执行前校验。拒绝祖先继承与 `.git` 元数据目录；独立嵌套仓库、路径别名和正常 linked worktree 保持支持。

回归先失败后通过，27 项相关测试通过。完整 `corepack pnpm verify` 通过：273 个测试文件 / 3819 项测试、全仓类型检查与 Web 构建、跨平台检查。Desktop build 通过。重启实际 Desktop 后，同一空目录显示 `not a git repo`，不再显示祖先分支，0 Run / 未配对状态保留。Issue 待修复提交和云端 CI 后关闭。

### #106：Windows 集成测试总时限不足

[Issue #106](https://github.com/erich04/ai-devflow-studio/issues/106) 来自 PR #105 的 Windows CI：验证 Native Coding 修复阶段 Provider 超时的集成测试耗时 5078 ms，超过 Vitest 默认 5000 ms；同批其余 3814 项通过，4 项按平台跳过。

本地只为真实 Git 启动增加 500 ms 延迟，即可复现同一外层测试超时。将这一个场景的总时限设为与相邻持久化重启测试相同的 15 秒后，同一延迟场景耗时 6249 ms 并通过；Provider 自身的 25 ms 超时和失败轨迹、无残留审批、工作树已删除断言保持不变。去掉延迟后，相关三个文件的 22 项测试通过。诊断包装器位于验证证据目录，未进入产品或实时验证环境。PR #105 等待更新后的云端 CI，不将该测试夹具误记为真实 DeepSeek 调用。

## 尚未完成

云端项目/需求首次创建、首次 pairing、真实 Provider 阶段、代码生成、测试、GitHub Delivery、业务验收以及最终合并/发布均尚未完成。本文件不是端到端通过报告。
