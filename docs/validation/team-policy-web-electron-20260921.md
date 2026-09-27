<a id="web-to-electron-policy-acceptance--2026-09-21"></a>

# Web 到 Electron 的策略验收 — 2026-09-21

#133 通过完整的保存、拉取、行为变化及恢复序列。本次使用隔离 QA 项目，不是用户原任务清单项目；检查期间没有批准 Gate 或推进业务工作流。

<a id="environment-and-fixed-comparison"></a>

## 环境与固定对照

- API/Web：候选 `74c2a5043f85f0e78c97c8547b443dde21cca2aa`，隔离 Postgres 16，回环端口 58536/58537，仅供开发的本地登录。
- 桌面：打包候选 `a0b574688d1e297c67b68ae8eeb48068f921ab6f`，Electron 42.11.6，独立 QA 档案和仓库。后续组织功能提交未改动策略界面/评估代码；原生界面操作使用 CUA。
- 团队项目：**Policy QA**，`p-policy-qa-20260921`，组织 `org-local`；全程使用同一配对操作者 **Local Developer / lead**。
- 所选 Run：**OpenCode 验收：增加清除已完成按钮**，v2 / `paused_at_gate`，当前节点为需求确认 Gate。澄清修订 1 为 `review_requested`，全程缺少基于知识的 Gate 审查。
- 基线策略：v1，`remote_cache`，十条规则均采用警告动作，没有项目覆盖。修改前保存策略和两条 QA Run 记录。

<a id="actual-ui-and-persistence-results"></a>

## 真实界面与持久化结果

| 步骤 | Web 与持久化策略 | Electron 拉取后 | 同一 Gate 的实际结果 |
| --- | --- | --- | --- |
| 基线 | v1，缺少审查 = `warn` | v1，`remote_cache`，同步于 06:25:51.954Z | “Gate 可以通过，但仍有待处理项”；已通过 3、警告 1、缺失 1、阻断 0 |
| 修改 | Owner 只将 `missing_agent_review:protected_gate:missing` 从 `warn` 改为 `block`，预览一项修改并确认；重新读取仍为 v2 | v2，`remote_cache`，同步于 06:27:54.101Z；SQLite 与 Postgres 一致 | “Gate 暂时不能通过”；原因为缺少基于知识的审查；已通过 2、警告 0、缺失 1、阻断行 2 |
| 恢复 | 同一动作改回 `warn`，预览保存；重新读取仍为 v3 | v3，`remote_cache`，同步于 06:34:00.184Z；SQLite 与 Postgres 一致 | “Gate 可以通过，但仍有待处理项”；已通过 3、警告 1、缺失 1、阻断 0；明确显示“当前策略仅警告，不阻断审批” |

以上时间均为 2026-09-21 UTC。两条阻断行分别是 Gate 结论和策略/权限汇总，不是两条规则变化。操作者、所选节点、产物、缺少审查及其他九条规则均保持不变，因此比较不只依赖版本徽标或泛化的“同步成功”提示。原生可访问性文本提供界面证据；过期窗口图片不算最终界面证据。

恢复后逐条比较有效规则的键、目标、类别、状态/严重性、动作、底线、例外设置和来源，均与基线一致；版本与更新时间正常增加。两条 QA `workflow_runs` JSON 与基线精确一致，包括版本和节点状态。用户原 Run、会话、服务商和配对行另行比较，也与修复前备份一致。

<a id="separate-upload-diagnostic"></a>

## 独立的上传诊断

QA 档案还显示一个终态 `run-summary` 冲突，它与策略下载分开，比较期间一直存在。之前独立 OpenCode 调用属于 `local-user`，后续团队配对属于 `u-local-owner`。API 拒绝用量用户与已认证操作者不一致的阶段用量行，逻辑位于 `postgres-team-repository.ts` 的 `persistStageUsage`。失败上传未创建远端 Run，没有为使测试数据上传成功而改写身份或费用记录。本检查证明策略读取/评估路径，不证明能把独立用量迁移到其他团队身份。

<a id="evidence-and-limits"></a>

## 证据与限制

受限且被 Git 忽略的 QA 产物位于 `out/issue-resolution-20260919/`：

- `policy-ui-baseline.json`：基线策略及未改变的 Run JSON。
- `policy-ui-server-block.json`、`policy-ui-desktop-block.json`：v2 服务端/缓存。
- `policy-ui-server-restore.json`、`policy-ui-desktop-restore.json`：v3 服务端/缓存。
- `policy-ui-comparison.json`：版本 1 → 3，规则恢复，两条 Run 不变。
- `original-data-preservation-20260921.json`：用户数据数量/相等性检查。

未提交凭据、密文、配对码或原始会话。本策略检查未调用模型、修改代码、批准 Gate 或执行交付。#135 生命周期与签名安装边界另见[桌面凭据验证](./desktop-lifecycle-credentials-thinking-20260919.md)。
