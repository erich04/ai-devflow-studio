---
title: API 健康端点规范
category: api_contract
ownerId: u-ling
tags: api, health, degraded
summary: 健康端点必须提供 ok、degraded、down 三种状态，并明确状态映射。
---

<a id="api-health-endpoint-standard"></a>

# API 健康端点规范

健康端点必须提供 `ok`、`degraded`、`down` 三种状态，并明确状态映射。

- 路由处理器组合服务结果；依赖检查由服务负责。
- 依赖降级必须在测试证据中可见。
- 运行时、数据库和缓存检查必须能够在部署冒烟测试期间安全调用。
