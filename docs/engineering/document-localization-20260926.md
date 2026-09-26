# 仓库文档中文化逐文件清单

范围：#173。基线 `658c511658daa21cc716f10b5a3f0470adecd0b5` 实际跟踪的 171 份 Markdown 文档全部纳入（Issue 创建时的记录为 170 份，本次按 Git 文件列表重新计数）；本清单为实施过程中新增的中文记录。

状态根据实际逐文件处理更新。“原含中文，待完整校对”只是内容盘点，不表示已经完成。文档之外的代码块、命令、路径、字段、枚举、哈希与原始证据保留准确标识；保留整段英文说明时须逐项说明理由。历史计划、版本和验证状态不因翻译改变。#135 签名安装验证仍未完成。

统一术语：工作流实例（Run）、节点（Node）、门禁（Gate）、产物（Artifact）、测试证据（Test Evidence）、执行器（Executor）、策略（Policy）、处理建议（Remediation）、团队知识底座（Team Knowledge Foundation）。新节点工作区的四个一级入口为“概览 / 内容与审查 / 产物与证据 / 执行记录”；这是 #174 与 #177 的最新设计，历史截图仍按原版本说明。

| 文件 | 处理状态 | 保留内容及说明 |
| --- | --- | --- |
| [CONTEXT.md](../../CONTEXT.md) | 已翻译并校对 | 保留技术标识、命令及来源；兼容原有标题锚点 |
| [CONTRIBUTING.md](../../CONTRIBUTING.md) | 已翻译并校对 | 保留技术标识、命令及来源；兼容原有标题锚点 |
| [README.md](../../README.md) | 已翻译并校对 | 保留技术标识、命令及来源；兼容原有标题锚点 |
| [design-qa.md](../../design-qa.md) | 已翻译并校对 | 保留技术标识、命令及来源；兼容原有标题锚点 |
| [docs/adr/0001-team-platform-electron-client.md](../../docs/adr/0001-team-platform-electron-client.md) | 已翻译并校对 | 保留 ADR 编号、决策状态、历史范围和兼容锚点 |
| [docs/adr/0002-git-markdown-knowledge-source.md](../../docs/adr/0002-git-markdown-knowledge-source.md) | 已翻译并校对 | 保留 ADR 编号、决策状态、历史范围和兼容锚点 |
| [docs/adr/0003-postgres-sqlite-data-boundary.md](../../docs/adr/0003-postgres-sqlite-data-boundary.md) | 已翻译并校对 | 保留 ADR 编号、决策状态、历史范围和兼容锚点 |
| [docs/adr/0004-theme-token-strategy.md](../../docs/adr/0004-theme-token-strategy.md) | 已翻译并校对 | 保留 ADR 编号、决策状态、历史范围和兼容锚点 |
| [docs/adr/0005-v0-2-local-execution-first.md](../../docs/adr/0005-v0-2-local-execution-first.md) | 已翻译并校对 | 保留 ADR 编号、决策状态、历史范围和兼容锚点 |
| [docs/adr/0006-cross-platform-electron-compatibility.md](../../docs/adr/0006-cross-platform-electron-compatibility.md) | 已翻译并校对 | 保留 ADR 编号、决策状态、历史范围和兼容锚点 |
| [docs/adr/0007-knowledge-retrieval-is-not-governance-evidence.md](../../docs/adr/0007-knowledge-retrieval-is-not-governance-evidence.md) | 已翻译并校对 | 保留 ADR 编号、决策状态、历史范围和兼容锚点 |
| [docs/adr/0008-knowledge-review-agent-runtime.md](../../docs/adr/0008-knowledge-review-agent-runtime.md) | 已翻译并校对 | 保留 ADR 编号、决策状态、历史范围和兼容锚点 |
| [docs/adr/0009-managed-opencode-coding-adapter.md](../../docs/adr/0009-managed-opencode-coding-adapter.md) | 已翻译并校对 | 保留 ADR 编号、决策状态、历史范围和兼容锚点 |
| [docs/adr/0010-configurable-gate-enforcement-policy.md](../../docs/adr/0010-configurable-gate-enforcement-policy.md) | 已翻译并校对 | 保留 ADR 编号、决策状态、历史范围和兼容锚点 |
| [docs/adr/0011-api-knowledge-provenance.md](../../docs/adr/0011-api-knowledge-provenance.md) | 已翻译并校对 | 保留 ADR 编号、决策状态、历史范围和兼容锚点 |
| [docs/adr/0012-web-desktop-work-authority.md](../../docs/adr/0012-web-desktop-work-authority.md) | 已翻译并校对 | 保留 ADR 编号、状态、并发/时限、隐私边界和兼容锚点 |
| [docs/adr/0013-github-app-delivery-authority.md](../../docs/adr/0013-github-app-delivery-authority.md) | 已翻译并校对 | 保留 ADR 编号、权限契约、限制、恢复语义和兼容锚点 |
| [docs/adr/0014-bounded-agent-runtime.md](../../docs/adr/0014-bounded-agent-runtime.md) | 已翻译并校对 | 保留 ADR 编号、权限契约、限制、恢复语义和兼容锚点 |
| [docs/adr/0015-governed-coding-executor.md](../../docs/adr/0015-governed-coding-executor.md) | 已翻译并校对 | 保留 ADR 编号、权限契约、限制、恢复语义和兼容锚点 |
| [docs/adr/0016-tool-mcp-execution-authority.md](../../docs/adr/0016-tool-mcp-execution-authority.md) | 已翻译并校对 | 保留 ADR 编号、权限契约、限制、恢复语义和兼容锚点 |
| [docs/adr/0017-evaluated-hybrid-retrieval-and-citation.md](../../docs/adr/0017-evaluated-hybrid-retrieval-and-citation.md) | 已翻译并校对 | 保留 ADR 编号、作用域、评估指标、生命周期及兼容锚点 |
| [docs/adr/0018-scoped-agent-memory-lifecycle.md](../../docs/adr/0018-scoped-agent-memory-lifecycle.md) | 已翻译并校对 | 保留 ADR 编号、作用域、评估指标、生命周期及兼容锚点 |
| [docs/adr/0019-bounded-multi-agent-coordination.md](../../docs/adr/0019-bounded-multi-agent-coordination.md) | 已翻译并校对 | 保留 ADR 编号、数量上限、隔离与取消契约及兼容锚点 |
| [docs/adr/0020-read-only-stage-agent-and-versioned-clarification.md](../../docs/adr/0020-read-only-stage-agent-and-versioned-clarification.md) | 已翻译并校对 | 保留 ADR 编号、契约标识、历史验收限制、来源链接及兼容锚点 |
| [docs/adr/0021-coding-memory-context-and-evidence-evaluation.md](../../docs/adr/0021-coding-memory-context-and-evidence-evaluation.md) | 已翻译并校对 | 保留 ADR 编号、契约标识、历史验收限制、来源链接及兼容锚点 |
| [docs/adr/0022-workbench-conversation-harness.md](../../docs/adr/0022-workbench-conversation-harness.md) | 已翻译并校对 | 保留 ADR 编号、契约标识、历史验收限制、来源链接及兼容锚点 |
| [docs/adr/0023-independent-organizations.md](../../docs/adr/0023-independent-organizations.md) | 已翻译并校对 | 保留 ADR 编号、契约标识、历史验收限制、来源链接及兼容锚点 |
| [docs/course/ai-devflow-studio/briefs/01-request-to-workflow.md](../../docs/course/ai-devflow-studio/briefs/01-request-to-workflow.md) | 已翻译并校对 | 保留原始代码摘录、教学范围、交互 ID 与兼容锚点；参考章节名称以中文说明 |
| [docs/course/ai-devflow-studio/briefs/02-desktop-actors.md](../../docs/course/ai-devflow-studio/briefs/02-desktop-actors.md) | 已翻译并校对 | 保留原始代码摘录、教学范围、交互 ID 与兼容锚点；参考章节名称以中文说明 |
| [docs/course/ai-devflow-studio/briefs/03-local-first-data.md](../../docs/course/ai-devflow-studio/briefs/03-local-first-data.md) | 已翻译并校对 | 保留原始代码摘录、教学范围、交互 ID 与兼容锚点；参考章节名称以中文说明 |
| [docs/course/ai-devflow-studio/briefs/04-bounded-agent-runtime.md](../../docs/course/ai-devflow-studio/briefs/04-bounded-agent-runtime.md) | 已翻译并校对 | 保留原始代码摘录、教学范围、交互 ID 与兼容锚点；参考章节名称以中文说明 |
| [docs/course/ai-devflow-studio/briefs/05-evidence-gates.md](../../docs/course/ai-devflow-studio/briefs/05-evidence-gates.md) | 已翻译并校对 | 保留原始代码摘录、教学范围、交互 ID 与兼容锚点；参考章节名称以中文说明 |
| [docs/course/ai-devflow-studio/briefs/06-draft-pr-delivery.md](../../docs/course/ai-devflow-studio/briefs/06-draft-pr-delivery.md) | 已翻译并校对 | 保留原始代码摘录、教学范围、交互 ID 与兼容锚点；参考章节名称以中文说明 |
| [docs/engineering/architecture-review-2026-09-06.zh-CN.md](../../docs/engineering/architecture-review-2026-09-06.zh-CN.md) | 原为中文，已校对并补齐术语 | 保留历史版本、测试/调用证据及原型标识；不把历史布局写成新版本已发布 |
| [docs/engineering/backend-data-source-matrix.md](../../docs/engineering/backend-data-source-matrix.md) | 已翻译并校对 | 保留状态枚举、接口/表/字段、版本与权限边界及兼容锚点 |
| [docs/engineering/blank-project-e2e-2026-09-11.zh-CN.md](../../docs/engineering/blank-project-e2e-2026-09-11.zh-CN.md) | 已翻译并校对 | 逐文件校对；保留原始命令/测试名称/技术标识与历史证据，并说明当时状态不代表当前候选版 |
| [docs/engineering/demo-and-smoke.md](../../docs/engineering/demo-and-smoke.md) | 已翻译并校对 | 保留原版本、迁移序列、命令、权限边界及兼容锚点 |
| [docs/engineering/desktop-data-profiles.md](../../docs/engineering/desktop-data-profiles.md) | 已翻译并校对 | 保留权限契约、字段/命令、历史定价数值与来源及兼容锚点 |
| [docs/engineering/desktop-pairing-security.md](../../docs/engineering/desktop-pairing-security.md) | 已翻译并校对 | 保留权限契约、字段/命令、历史定价数值与来源及兼容锚点 |
| [docs/engineering/final-live-e2e-2026-09-10.zh-CN.md](../../docs/engineering/final-live-e2e-2026-09-10.zh-CN.md) | 已翻译并校对 | 逐文件校对；保留原始命令/测试名称/技术标识与历史证据，并说明当时状态不代表当前候选版 |
| [docs/engineering/lessons-learned.md](../../docs/engineering/lessons-learned.md) | 已翻译并校对 | 保留原版本、迁移序列、命令、权限边界及兼容锚点 |
| [docs/engineering/live-provider-validation-2026-09-06.zh-CN.md](../../docs/engineering/live-provider-validation-2026-09-06.zh-CN.md) | 原为中文，已校对并补齐术语 | 原始证据/双语提示词/技术名称保留作对照；当前布局与历史验证范围分别说明 |
| [docs/engineering/memory-context-execution-validation.md](../../docs/engineering/memory-context-execution-validation.md) | 已翻译并校对 | 保留真实问候输出并补中文解释；原测试/费用/ID/版本/日期/限制保留，流程文字图已中文化 |
| [docs/engineering/one-sentence-validation-2026-09-07.zh-CN.md](../../docs/engineering/one-sentence-validation-2026-09-07.zh-CN.md) | 原为中文，已校对并补齐术语 | 原始证据/双语提示词/技术名称保留作对照；当前布局与历史验证范围分别说明 |
| [docs/engineering/open-issues-2026-09-10.zh-CN.md](../../docs/engineering/open-issues-2026-09-10.zh-CN.md) | 已翻译并校对 | 逐文件校对；保留原始命令/测试名称/技术标识与历史证据，并说明当时状态不代表当前候选版 |
| [docs/engineering/open-issues-interaction-proposal.zh-CN.md](../../docs/engineering/open-issues-interaction-proposal.zh-CN.md) | 原为中文，已校对并补齐术语 | 保留历史版本、测试/调用证据及原型标识；不把历史布局写成新版本已发布 |
| [docs/engineering/runtime-pricing-catalog.md](../../docs/engineering/runtime-pricing-catalog.md) | 已翻译并校对 | 保留权限契约、字段/命令、历史定价数值与来源及兼容锚点 |
| [docs/engineering/testing-strategy.md](../../docs/engineering/testing-strategy.md) | 已翻译并校对 | 保留历史测试数、迁移序列、命令、证据字段、权限边界和兼容锚点 |
| [docs/engineering/workbench-conversations-verification.md](../../docs/engineering/workbench-conversations-verification.md) | 原为中文，已校对并补齐术语 | 保留历史版本、测试/调用证据及原型标识；不把历史布局写成新版本已发布 |
| [docs/engineering/workbench-conversations.md](../../docs/engineering/workbench-conversations.md) | 原为中文，已校对并补齐术语 | 原始证据/双语提示词/技术名称保留作对照；当前布局与历史验证范围分别说明 |
| [docs/engineering/workflow-context-projection.md](../../docs/engineering/workflow-context-projection.md) | 已翻译并校对 | 保留权限契约、字段/命令、历史定价数值与来源及兼容锚点 |
| [docs/guides/devflow-studio-full-feature-walkthrough.md](../../docs/guides/devflow-studio-full-feature-walkthrough.md) | 原含中文，待完整校对 | 尚未验收 |
| [docs/guides/devflow-studio-self-hosted-pilot.md](../../docs/guides/devflow-studio-self-hosted-pilot.md) | 待翻译 | 尚未验收 |
| [docs/guides/devflow-studio-v0.8-user-guide.md](../../docs/guides/devflow-studio-v0.8-user-guide.md) | 原含中文，待完整校对 | 尚未验收 |
| [docs/guides/devflow-studio-v0.9-demo-script.md](../../docs/guides/devflow-studio-v0.9-demo-script.md) | 原含中文，待完整校对 | 尚未验收 |
| [docs/guides/devflow-studio-v1.0-user-guide.md](../../docs/guides/devflow-studio-v1.0-user-guide.md) | 原含中文，待完整校对 | 尚未验收 |
| [docs/guides/devflow-studio-v1.2-walkthrough-result-2026-06-21.md](../../docs/guides/devflow-studio-v1.2-walkthrough-result-2026-06-21.md) | 待翻译 | 尚未验收 |
| [docs/guides/devflow-studio-v1.2-walkthrough.md](../../docs/guides/devflow-studio-v1.2-walkthrough.md) | 待翻译 | 尚未验收 |
| [docs/guides/devflow-studio-v1.3-walkthrough-result-2026-06-26.md](../../docs/guides/devflow-studio-v1.3-walkthrough-result-2026-06-26.md) | 待翻译 | 尚未验收 |
| [docs/guides/devflow-studio-v1.3-walkthrough-result-2026-07-25.md](../../docs/guides/devflow-studio-v1.3-walkthrough-result-2026-07-25.md) | 原含中文，待完整校对 | 尚未验收 |
| [docs/guides/devflow-studio-v1.3-walkthrough-result-2026-07-31.md](../../docs/guides/devflow-studio-v1.3-walkthrough-result-2026-07-31.md) | 待翻译 | 尚未验收 |
| [docs/guides/devflow-studio-v1.3-walkthrough.md](../../docs/guides/devflow-studio-v1.3-walkthrough.md) | 原含中文，待完整校对 | 尚未验收 |
| [docs/guides/devflow-studio-v1.4-walkthrough-result-2026-08-01.md](../../docs/guides/devflow-studio-v1.4-walkthrough-result-2026-08-01.md) | 已翻译并校对 | 历史验证正文已翻译；保留开发验证与正式验收差异、失败路径、未签名状态和兼容锚点 |
| [docs/guides/devflow-studio-v1.4-walkthrough-result-2026-08-09.md](../../docs/guides/devflow-studio-v1.4-walkthrough-result-2026-08-09.md) | 已翻译并校对 | 历史候选验收正文已翻译；精确 SHA、一次真实调用、前置失败、时间/次数与发布限制保留，兼容旧锚点 |
| [docs/guides/devflow-studio-v1.4-walkthrough.md](../../docs/guides/devflow-studio-v1.4-walkthrough.md) | 已翻译并校对 | 正文与操作说明已翻译；保留版本、命令、权限边界及兼容锚点 |
| [docs/guides/devflow-studio-v1.5-walkthrough-result-2026-08-12.md](../../docs/guides/devflow-studio-v1.5-walkthrough-result-2026-08-12.md) | 已翻译并校对 | 发布程序解析的原始验收记录逐字保留；补齐中文结果、字段解释与历史范围，保留证据及兼容锚点 |
| [docs/guides/devflow-studio-v1.5-walkthrough.md](../../docs/guides/devflow-studio-v1.5-walkthrough.md) | 待翻译 | 尚未验收 |
| [docs/guides/devflow-studio-v2.2-beginner-operation-manual.md](../../docs/guides/devflow-studio-v2.2-beginner-operation-manual.md) | 原含中文，待完整校对 | 尚未验收 |
| [docs/guides/devflow-studio-v2.2-walkthrough-result-2026-08-27.md](../../docs/guides/devflow-studio-v2.2-walkthrough-result-2026-08-27.md) | 已翻译并校对 | 发布程序解析的原始验收记录逐字保留；补齐中文结果、字段解释与历史范围，保留证据及兼容锚点 |
| [docs/guides/devflow-studio-v2.2-walkthrough.md](../../docs/guides/devflow-studio-v2.2-walkthrough.md) | 已翻译并校对 | 正文与操作说明已翻译；保留版本、命令、权限边界及兼容锚点 |
| [docs/guides/devflow-studio-v2.3-walkthrough-result-2026-09-14.md](../../docs/guides/devflow-studio-v2.3-walkthrough-result-2026-09-14.md) | 待翻译 | 尚未验收 |
| [docs/guides/devflow-studio-v2.3-walkthrough.md](../../docs/guides/devflow-studio-v2.3-walkthrough.md) | 已翻译并校对 | 正文与操作说明已翻译；保留版本、命令、权限边界及兼容锚点 |
| [docs/guides/multi-organization-deployment.md](../../docs/guides/multi-organization-deployment.md) | 已翻译并校对 | 正文与操作说明已翻译；保留版本、命令、权限边界及兼容锚点 |
| [docs/guides/screenshots/readme-20260924/README.md](../../docs/guides/screenshots/readme-20260924/README.md) | 已翻译并校对 | 保留技术标识、命令及来源；兼容原有标题锚点 |
| [docs/guides/windows-zip-smoke.md](../../docs/guides/windows-zip-smoke.md) | 已翻译并校对 | 正文与操作说明已翻译；保留版本、命令、权限边界及兼容锚点 |
| [docs/knowledge/adr/gate-governance.md](../../docs/knowledge/adr/gate-governance.md) | 已翻译并校对 | 保留元数据键、标签、版本、命令与权限契约；代码知识样例同步，兼容旧锚点 |
| [docs/knowledge/checklists/electron-demo-readiness.md](../../docs/knowledge/checklists/electron-demo-readiness.md) | 已翻译并校对 | 保留元数据键、标签、版本、命令与权限契约；代码知识样例同步，兼容旧锚点 |
| [docs/knowledge/checklists/opencode-runtime-signoff.md](../../docs/knowledge/checklists/opencode-runtime-signoff.md) | 已翻译并校对 | 保留元数据键、标签、版本、命令与权限契约；代码知识样例同步，兼容旧锚点 |
| [docs/knowledge/checklists/postgres-smoke-readiness.md](../../docs/knowledge/checklists/postgres-smoke-readiness.md) | 已翻译并校对 | 保留元数据键、标签、版本、命令与权限契约；代码知识样例同步，兼容旧锚点 |
| [docs/knowledge/checklists/pr-review.md](../../docs/knowledge/checklists/pr-review.md) | 已翻译并校对 | 保留元数据键、标签、版本、命令与权限契约；代码知识样例同步，兼容旧锚点 |
| [docs/knowledge/checklists/v09-demo-readiness.md](../../docs/knowledge/checklists/v09-demo-readiness.md) | 已翻译并校对 | 保留元数据键、标签、版本、命令与权限契约；代码知识样例同步，兼容旧锚点 |
| [docs/knowledge/prompts/opendesign-design-prompts.md](../../docs/knowledge/prompts/opendesign-design-prompts.md) | 已翻译并校对 | 原始提示词为历史输入，逐字保留并说明旧布局范围；通用模板与说明已翻译，代码内置副本同步 |
| [docs/knowledge/rules/mcp-skill-usage.md](../../docs/knowledge/rules/mcp-skill-usage.md) | 已翻译并校对 | 保留元数据键、标签、版本、命令与权限契约；代码知识样例同步，兼容旧锚点 |
| [docs/knowledge/standards/api-health.md](../../docs/knowledge/standards/api-health.md) | 已翻译并校对 | 保留元数据键、标签、版本、命令与权限契约；代码知识样例同步，兼容旧锚点 |
| [docs/knowledge/standards/testing-evidence.md](../../docs/knowledge/standards/testing-evidence.md) | 已翻译并校对 | 保留元数据键、标签、版本、命令与权限契约；代码知识样例同步，兼容旧锚点 |
| [docs/plans/open-issues-resolution-20260919.md](../../docs/plans/open-issues-resolution-20260919.md) | 待翻译 | 尚未验收 |
| [docs/plans/release-only-real-opencode-smoke.md](../../docs/plans/release-only-real-opencode-smoke.md) | 待翻译 | 尚未验收 |
| [docs/plans/stabilization-v0.3-2026-08-17.md](../../docs/plans/stabilization-v0.3-2026-08-17.md) | 待翻译 | 尚未验收 |
| [docs/plans/unified-workbench-conversations.md](../../docs/plans/unified-workbench-conversations.md) | 待翻译 | 尚未验收 |
| [docs/plans/v0.2-final-validation.md](../../docs/plans/v0.2-final-validation.md) | 待翻译 | 尚未验收 |
| [docs/plans/v0.3-team-backend-synchronization.md](../../docs/plans/v0.3-team-backend-synchronization.md) | 待翻译 | 尚未验收 |
| [docs/plans/v0.4-knowledge-governance.md](../../docs/plans/v0.4-knowledge-governance.md) | 待翻译 | 尚未验收 |
| [docs/plans/v0.5-knowledge-review-agent-workbench.md](../../docs/plans/v0.5-knowledge-review-agent-workbench.md) | 待翻译 | 尚未验收 |
| [docs/plans/v0.6-opencode-coding-adapter.md](../../docs/plans/v0.6-opencode-coding-adapter.md) | 待翻译 | 尚未验收 |
| [docs/plans/v0.7-configurable-gate-enforcement-policy.md](../../docs/plans/v0.7-configurable-gate-enforcement-policy.md) | 待翻译 | 尚未验收 |
| [docs/plans/v0.7.5-engineering-hardening.md](../../docs/plans/v0.7.5-engineering-hardening.md) | 待翻译 | 尚未验收 |
| [docs/plans/v0.8-policy-aware-delivery.md](../../docs/plans/v0.8-policy-aware-delivery.md) | 待翻译 | 尚未验收 |
| [docs/plans/v0.8.1-release-signoff.md](../../docs/plans/v0.8.1-release-signoff.md) | 待翻译 | 尚未验收 |
| [docs/plans/v0.9-real-runtime-observability.md](../../docs/plans/v0.9-real-runtime-observability.md) | 待翻译 | 尚未验收 |
| [docs/plans/v1.0-release-signoff.md](../../docs/plans/v1.0-release-signoff.md) | 待翻译 | 尚未验收 |
| [docs/plans/v1.0-team-pilot-foundation.md](../../docs/plans/v1.0-team-pilot-foundation.md) | 待翻译 | 尚未验收 |
| [docs/plans/v1.0a-identity-foundation-signoff.md](../../docs/plans/v1.0a-identity-foundation-signoff.md) | 待翻译 | 尚未验收 |
| [docs/plans/v1.0b-oauth-project-signoff.md](../../docs/plans/v1.0b-oauth-project-signoff.md) | 待翻译 | 尚未验收 |
| [docs/plans/v1.0c-desktop-pairing-signoff.md](../../docs/plans/v1.0c-desktop-pairing-signoff.md) | 待翻译 | 尚未验收 |
| [docs/plans/v1.0d-self-hosted-deployment-signoff.md](../../docs/plans/v1.0d-self-hosted-deployment-signoff.md) | 待翻译 | 尚未验收 |
| [docs/plans/v1.1-release-signoff.md](../../docs/plans/v1.1-release-signoff.md) | 待翻译 | 尚未验收 |
| [docs/plans/v1.1-runtime-cost-budget-guard.md](../../docs/plans/v1.1-runtime-cost-budget-guard.md) | 待翻译 | 尚未验收 |
| [docs/plans/v1.2-runtime-cost-ux-budget-administration.md](../../docs/plans/v1.2-runtime-cost-ux-budget-administration.md) | 待翻译 | 尚未验收 |
| [docs/plans/v1.3-closeout-execution-2026-07-31.md](../../docs/plans/v1.3-closeout-execution-2026-07-31.md) | 待翻译 | 尚未验收 |
| [docs/plans/v1.3-delivery-flow-completion.md](../../docs/plans/v1.3-delivery-flow-completion.md) | 待翻译 | 尚未验收 |
| [docs/plans/v1.4-pilot-trust-boundary.md](../../docs/plans/v1.4-pilot-trust-boundary.md) | 待翻译 | 尚未验收 |
| [docs/plans/v1.4-release-signoff.md](../../docs/plans/v1.4-release-signoff.md) | 待翻译 | 尚未验收 |
| [docs/plans/v1.5-github-delivery.md](../../docs/plans/v1.5-github-delivery.md) | 待翻译 | 尚未验收 |
| [docs/plans/v2.0-native-agent-runtime.md](../../docs/plans/v2.0-native-agent-runtime.md) | 待翻译 | 尚未验收 |
| [docs/plans/v2.1-evaluated-retrieval-memory.md](../../docs/plans/v2.1-evaluated-retrieval-memory.md) | 待翻译 | 尚未验收 |
| [docs/plans/v2.2-multi-agent-execution-tenancy.md](../../docs/plans/v2.2-multi-agent-execution-tenancy.md) | 待翻译 | 尚未验收 |
| [docs/plans/v2.2-release-signoff.md](../../docs/plans/v2.2-release-signoff.md) | 待翻译 | 尚未验收 |
| [docs/plans/v2.3-release-signoff.md](../../docs/plans/v2.3-release-signoff.md) | 待翻译 | 尚未验收 |
| [docs/plans/v3.x-agent-runtime-capability-roadmap.md](../../docs/plans/v3.x-agent-runtime-capability-roadmap.md) | 待翻译 | 尚未验收 |
| [docs/product/README.md](../../docs/product/README.md) | 已翻译并校对 | 保留技术标识、命令及来源；兼容原有标题锚点 |
| [docs/product/design-references/README.md](../../docs/product/design-references/README.md) | 已翻译并校对 | 保留技术标识、命令及来源；兼容原有标题锚点 |
| [docs/product/design-references/ai-devflow-studio-keynote-decisions.md](../../docs/product/design-references/ai-devflow-studio-keynote-decisions.md) | 已翻译并校对 | 保留历史版本、未完成验收状态、截图路径与旧锚点；明确新布局与旧演示的适用范围 |
| [docs/product/design-references/airbnb-iii-visual-acceptance.md](../../docs/product/design-references/airbnb-iii-visual-acceptance.md) | 已翻译并校对 | 保留历史版本、未完成验收状态、截图路径与旧锚点；明确新布局与旧演示的适用范围 |
| [docs/product/design-references/apple-inspired-keynote-style.md](../../docs/product/design-references/apple-inspired-keynote-style.md) | 原为中文，已校对并补齐术语 | 原始证据/双语提示词/技术名称保留作对照；当前布局与历史验证范围分别说明 |
| [docs/product/details/README.md](../../docs/product/details/README.md) | 已翻译并校对 | 保留技术标识、命令及来源；兼容原有标题锚点 |
| [docs/product/details/coding-agent-execution-stack.md](../../docs/product/details/coding-agent-execution-stack.md) | 原为中文，已校对并补齐术语 | 原始证据/双语提示词/技术名称保留作对照；当前布局与历史验证范围分别说明 |
| [docs/product/details/evidence-and-trust.md](../../docs/product/details/evidence-and-trust.md) | 已翻译并校对 | 保留领域字段、交付/审批边界及兼容锚点；历史布局与候选实现分开说明 |
| [docs/product/details/object-model.md](../../docs/product/details/object-model.md) | 已翻译并校对 | 保留领域枚举、交付恢复语义、权限/非目标边界与兼容锚点 |
| [docs/product/details/states-and-refactor-anchors.md](../../docs/product/details/states-and-refactor-anchors.md) | 已翻译并校对 | 保留领域枚举、交付恢复语义、权限/非目标边界与兼容锚点 |
| [docs/product/details/surfaces.md](../../docs/product/details/surfaces.md) | 已翻译并校对 | 保留领域字段、交付/审批边界及兼容锚点；历史布局与候选实现分开说明 |
| [docs/product/details/ui-design-rationale.md](../../docs/product/details/ui-design-rationale.md) | 原为中文，已校对并补齐术语 | 保留历史版本、测试/调用证据及原型标识；不把历史布局写成新版本已发布 |
| [docs/product/details/user-jobs.md](../../docs/product/details/user-jobs.md) | 已翻译并校对 | 保留领域字段、交付/审批边界及兼容锚点；历史布局与候选实现分开说明 |
| [docs/product/details/workflow-node-semantics.md](../../docs/product/details/workflow-node-semantics.md) | 已翻译并校对 | 保留领域字段、交付/审批边界及兼容锚点；历史布局与候选实现分开说明 |
| [docs/product/details/workflow.md](../../docs/product/details/workflow.md) | 已翻译并校对 | 保留领域字段、交付/审批边界及兼容锚点；历史布局与候选实现分开说明 |
| [docs/product/prd/README.md](../../docs/product/prd/README.md) | 已翻译并校对 | 保留技术标识、命令及来源；兼容原有标题锚点 |
| [docs/product/prd/current-product-prd.md](../../docs/product/prd/current-product-prd.md) | 已翻译并校对 | 保留 37 条用户故事、权限/测试/验收契约、原版本快照、范围外事项和兼容锚点 |
| [docs/product/prd/v1.4-pilot-trust-boundary-prd.md](../../docs/product/prd/v1.4-pilot-trust-boundary-prd.md) | 待翻译 | 尚未验收 |
| [docs/product/prd/v1.5-github-delivery-prd.md](../../docs/product/prd/v1.5-github-delivery-prd.md) | 待翻译 | 尚未验收 |
| [docs/product/prd/v2.0-native-agent-runtime-prd.md](../../docs/product/prd/v2.0-native-agent-runtime-prd.md) | 待翻译 | 尚未验收 |
| [docs/product/prd/v2.1-evaluated-retrieval-memory-prd.md](../../docs/product/prd/v2.1-evaluated-retrieval-memory-prd.md) | 待翻译 | 尚未验收 |
| [docs/product/prd/v2.2-multi-agent-execution-tenancy-prd.md](../../docs/product/prd/v2.2-multi-agent-execution-tenancy-prd.md) | 待翻译 | 尚未验收 |
| [docs/product/product-definition.md](../../docs/product/product-definition.md) | 已翻译并校对 | 保留权限契约、版本快照、历史证据路径与兼容锚点；当前状态以路线图为准 |
| [docs/product/project-introduction.zh-CN.md](../../docs/product/project-introduction.zh-CN.md) | 已翻译并校对 | 原中文简介已校对；纠正与现有 Native 执行器冲突的旧说明，保留执行/审批边界及原锚点 |
| [docs/releases/stabilization-v0.3-2026-08-17/result.md](../../docs/releases/stabilization-v0.3-2026-08-17/result.md) | 待翻译 | 尚未验收 |
| [docs/releases/stabilization-v0.3-2026-08-17/security-report.md](../../docs/releases/stabilization-v0.3-2026-08-17/security-report.md) | 待翻译 | 尚未验收 |
| [docs/releases/v2.3.0/notes.md](../../docs/releases/v2.3.0/notes.md) | 待翻译 | 尚未验收 |
| [docs/research/2026-06-15-honeyai-vs-devflow.md](../../docs/research/2026-06-15-honeyai-vs-devflow.md) | 待翻译 | 尚未验收 |
| [docs/research/2026-06-17-opencode-coding-adapter-spike.md](../../docs/research/2026-06-17-opencode-coding-adapter-spike.md) | 待翻译 | 尚未验收 |
| [docs/research/2026-06-19-opencode-runtime-contract-refresh.md](../../docs/research/2026-06-19-opencode-runtime-contract-refresh.md) | 待翻译 | 尚未验收 |
| [docs/roadmap.md](../../docs/roadmap.md) | 待翻译 | 尚未验收 |
| [docs/superpowers/plans/2026-06-17-near-term-opencode-signoff.md](../../docs/superpowers/plans/2026-06-17-near-term-opencode-signoff.md) | 待翻译 | 尚未验收 |
| [docs/superpowers/plans/2026-06-17-v0.6.1-real-opencode-runtime.md](../../docs/superpowers/plans/2026-06-17-v0.6.1-real-opencode-runtime.md) | 待翻译 | 尚未验收 |
| [docs/validation/conversation-details-161-20260922.md](../../docs/validation/conversation-details-161-20260922.md) | 原含中文，待完整校对 | 尚未验收 |
| [docs/validation/conversation-help-160-20260922.md](../../docs/validation/conversation-help-160-20260922.md) | 待翻译 | 尚未验收 |
| [docs/validation/desktop-lifecycle-credentials-thinking-20260919.md](../../docs/validation/desktop-lifecycle-credentials-thinking-20260919.md) | 待翻译 | 尚未验收 |
| [docs/validation/execution-tools-design-20260922.md](../../docs/validation/execution-tools-design-20260922.md) | 待翻译 | 尚未验收 |
| [docs/validation/gate-review-grounding-20260920.md](../../docs/validation/gate-review-grounding-20260920.md) | 待翻译 | 尚未验收 |
| [docs/validation/gate-workbench-open-issues-20260923.md](../../docs/validation/gate-workbench-open-issues-20260923.md) | 待翻译 | 尚未验收 |
| [docs/validation/multi-organization-20260921.md](../../docs/validation/multi-organization-20260921.md) | 待翻译 | 尚未验收 |
| [docs/validation/native-coding-failed-expenses-20260919.md](../../docs/validation/native-coding-failed-expenses-20260919.md) | 待翻译 | 尚未验收 |
| [docs/validation/open-issues-batch1-20260919.md](../../docs/validation/open-issues-batch1-20260919.md) | 待翻译 | 尚未验收 |
| [docs/validation/opencode-permission-recovery-20260911.md](../../docs/validation/opencode-permission-recovery-20260911.md) | 原含中文，待完整校对 | 尚未验收 |
| [docs/validation/pairing-diagnostics-20260920.md](../../docs/validation/pairing-diagnostics-20260920.md) | 待翻译 | 尚未验收 |
| [docs/validation/real-deepseek-todo-e2e-20260917.md](../../docs/validation/real-deepseek-todo-e2e-20260917.md) | 原含中文，待完整校对 | 尚未验收 |
| [docs/validation/stage-opencode-live-20260921.md](../../docs/validation/stage-opencode-live-20260921.md) | 原含中文，待完整校对 | 尚未验收 |
| [docs/validation/team-policy-web-electron-20260921.md](../../docs/validation/team-policy-web-electron-20260921.md) | 待翻译 | 尚未验收 |
| [docs/validation/workbench-context-recovery-20260921.md](../../docs/validation/workbench-context-recovery-20260921.md) | 待翻译 | 尚未验收 |
| [docs/validation/workbench-deepseek-reasoning-20260917.md](../../docs/validation/workbench-deepseek-reasoning-20260917.md) | 原含中文，待完整校对 | 尚未验收 |
| [docs/validation/workbench-opencode-harness-20260920.md](../../docs/validation/workbench-opencode-harness-20260920.md) | 待翻译 | 尚未验收 |
| [docs/validation/workflow-navigation-20260924.md](../../docs/validation/workflow-navigation-20260924.md) | 待翻译 | 尚未验收 |
| [知识点总结.md](../../知识点总结.md) | 原含中文，待完整校对 | 尚未验收 |
