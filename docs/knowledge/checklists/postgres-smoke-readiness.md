---
title: Postgres 冒烟测试就绪检查清单
category: review_checklist
ownerId: u-erich
tags: postgres, api, smoke, policy, github-delivery
summary: Postgres 冒烟测试应证明 Team schema v21、数据保留迁移、有界本地开发身份与原生编码摘要引擎、受控 GitHub 交付、运行时/记忆/协作投影、策略、同步与脱敏。
---

<a id="postgres-smoke-readiness-checklist"></a>

# Postgres 冒烟测试就绪检查清单

当 API、仓储层、迁移、策略、例外审批、同步、GitHub 交付或管理摘要代码变化时，使用本清单。

- 运行 Postgres 冒烟测试前，显式设置 `DEVFLOW_DATABASE_URL`。
- 证明可丢弃的新数据库达到 Team schema v21。
- 证明包含数据的 v11-to-v12 迁移完整保留仓库绑定、交付请求、审批、发布、恢复和审计数据。
- 证明失败的 v11-to-v12 迁移事务性回滚，显式重试后成功一次且不产生重复行。
- 证明包含数据的 v12-to-v13 迁移将每个旧版已签发凭据的契约版本保留为 `0`，`provider_credential_expires_at` 与 `provider_expiry_observed_at` 均为 NULL；因此在无法确认时拒绝放行，不伪造由提供方确认的过期时间。
- 证明 v13-to-v14 仅增加可空且有界的草稿 PR 提供方最早重试时间。
- 证明 v14-to-v15 增加可空的 `source_publication_id`，精确保留所有旧版凭据授权发布记录，并拒绝既无发布权限来源或同时有两个来源的行。
- 证明 v15-to-v16 创建空的 `agent_runtime_summaries` 和 `agent_runtime_projection_audits` 表，保留全部已有行，并拒绝未脱敏、版本不一致或终态无效的运行时摘要。
- 证明 v16-to-v17 创建空的 `agent_memory_summaries` 和 `agent_memory_projection_audits` 表，不包含本地内容或伪造的生命周期行。
- 证明 v17-to-v18 增加精确且独立的 `quality_version` 列与 `(memory_id, head_version, quality_version)` 复合审计标识；保留行使用预留版本 0 以便首次同步收敛，本地内容规则不变。
- 证明 v18-to-v19 创建空的 `agent_coordination_summaries` 和 `agent_coordination_projection_audits` 表，不伪造协作生命周期行。
- 证明 v19-to-v20 保留已有 GitHub 认证账号、接受 `local-development` 并拒绝所有未知认证提供方。
- 证明 v20-to-v21 保留已有编码摘要、接受 `native` 并继续拒绝所有未知编码引擎。
- 运行 `DEVFLOW_DATABASE_URL=postgres://... corepack pnpm test:local-auth-postgres-smoke`，在隔离的数据库结构中证明固定本地 Owner 登录、空团队概览、团队项目和预算写入、仅可复制一次的配对码，以及已配对桌面 Bearer 读取。
- 验证预置团队数据可经 API 仓储边界读取。
- 验证策略保存/读取和执行评估行为。
- 验证 Owner、Member 和存在利益冲突的 Lead 的例外审批请求被拒绝。
- 验证 Lead 例外审批接受后的审计行为。
- 验证过期策略版本被拒绝。
- 验证类似审批的同步摘要不能绕过 Gate 强制规则。
- 验证 Owner 可配置和撤销已核实的 GitHub App 仓库绑定，Member 或项目不匹配时不能操作。
- 验证脱敏交付请求保留系列/尝试/修订标识，且拒绝本地路径、原始输出、补丁、源码内容和凭据。
- 验证 Lead 或 Owner 的签名 Web 审批绑定精确的请求修订版；已配对桌面 Bearer 不能批准自身请求。
- 验证凭据授权的前置条件、过期时间、范围、领取者和绑定版本。GitHub App 私钥与签发令牌绝不能成为 Postgres 持久化证据。
- 验证 API 独立确认预期提交为远端分支提交后，才创建或对账一个草稿 PR。
- 验证已批准的后续尝试只能从同一系列紧邻的、草稿 PR 失败终态的前次尝试采用已核实发布证据，不增加凭据签发或推送。
- 验证撤销会阻断新的凭据授权，且重放/重启路径不会重复请求、发布、草稿 PR 或审计结果。
- 验证概览与交付请求响应保持脱敏，不暴露本地路径、原始日志、提示词、补丁、源码内容、私钥或令牌。
- 运行 `DEVFLOW_DATABASE_URL=postgres://... corepack pnpm test:postgres-smoke`，保留与精确候选版本绑定的结果。
- `corepack pnpm verify` 有意排除 Postgres 冒烟测试。
- 本清单不授权付费模型冒烟测试；Postgres 与 GitHub 交付持久化验证不需要模型提供方请求。
