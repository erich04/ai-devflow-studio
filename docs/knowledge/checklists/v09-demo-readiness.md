---
title: v0.9 演示就绪检查清单
category: review_checklist
ownerId: u-erich
tags: demo, opencode, observability, policy-aware-delivery
summary: v0.9 演示应证明策略感知交付、运行时可观测性，并如实说明真实 OpenCode 的能力边界。
---

<a id="v09-demo-readiness-checklist"></a>

# v0.9 演示就绪检查清单

展示 v0.9 真实运行时与可观测性能力前，使用本清单。

- 从 v0.8 用户指南和 v0.9 演示脚本开始。
- 运行 `corepack pnpm release:status`，确认仅剩明确保留的待发布事项。
- 运行 `corepack pnpm opencode:status`，确认本地 OpenCode 版本、默认模拟模式、真实测试开关和模型配置状态。
- `corepack pnpm verify` 继续使用确定性模拟引擎。
- 若要声称支持真实 OpenCode 行为，先显式设置真实调用环境变量并运行 `corepack pnpm test:opencode-smoke`。
- 在连贯流程中演示 Gate 强制规则、处理建议、基于知识的门禁审查、编码重试、测试和团队概览。
- 说明哪些证据来自模拟引擎，哪些来自真实 OpenCode。
- 确认团队摘要不展示 Provider 密钥、cwd、原始提示词、原始轨迹、原始日志和补丁。
- 不得声称该版本具备自动修复、MCP 运行时强制执行、RAG、打包、Windows Electron 冒烟测试或默认真实 OpenCode 验证。
