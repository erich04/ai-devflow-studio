---
title: OpenCode 运行时验收检查清单
category: review_checklist
ownerId: u-erich
tags: opencode, coding-agent, smoke, provider
summary: 真实 OpenCode 运行时验收必须显式启动、由环境开关控制、记录权限审计并保护密钥。
---

<a id="opencode-runtime-signoff-checklist"></a>

# OpenCode 运行时验收检查清单

仅在发布契约明确要求验证真实 OpenCode 编码适配器，且已取得与候选版本绑定的单独授权后，才使用本清单。本清单本身不授予模型调用费用授权。

- 日常验证默认使用确定性模拟引擎。
- 确认本地已安装 OpenCode，且与待测适配器兼容。
- 在真实冒烟测试前运行 `corepack pnpm --silent opencode:status`，确认本地二进制/版本、默认模拟引擎状态、真实测试开关和模型配置状态，同时避免 pnpm 打印工作目录横幅。
- 明确设置 `DEVFLOW_RUN_OPENCODE_SMOKE=1`。
- 设置 `DEVFLOW_CODING_ENGINE=opencode-http`。
- 显式指定目标 Provider ID 和模型 ID。
- 对于 V1.4，设置 `DEVFLOW_OPENCODE_RELEASE_PROFILE=v1.4`；即使提供了正确的 Provider/模型/密钥三元组，缺少该选择器也必须在 OpenCode 启动前失败。
- 通过配置的环境变量设置 Provider API 密钥，绝不直接写入日志或文档。
- 对于 V1.4，运行 `corepack pnpm --silent opencode:release-preflight`；付费测试前必须取得其固定、无网络访问的解析配置成功摘要。
- 运行 `corepack pnpm --silent test:opencode-smoke`，避免 pnpm 打印本地候选路径。
- 确认测试启动 `opencode serve`、创建托管工作树、传递权限请求、记录脱敏差异、运行工作树测试，并清理临时测试状态。
- 确认权限请求对人可见，未回答的请求默认拒绝。
- 确认测试输出不打印 Provider 密钥。
- 将真实 OpenCode 冒烟测试排除在 `corepack pnpm verify` 和默认 CI 之外。
- 后续产品版本只有在自身发布契约明确要求，且已记录与候选版本绑定的单独授权时，才运行真实模型冒烟测试。
- V1.5 不要求也不授权再次进行付费模型冒烟测试。V1.4 付费测试记录继续作为不可变的 V1.4 证据保留。
