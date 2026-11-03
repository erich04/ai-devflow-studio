<a id="runtime-pricing-catalog"></a>

# 运行费用目录

本目录是编码运行时费用结算采用的权威版本化来源。每次运行保存实际使用的定价快照；历史运行不会根据新版目录重新计价。

<a id="deepseek-v4-pro-snapshot-verified-on-2026-11-01"></a>

## 2026-11-01 核验的 DeepSeek V4 Pro 快照

- 来源版本：`deepseek-pricing-snapshot-2026-11-01`。
- 核验时间：`2026-11-01T09:49:20.000Z`。这是本项目读取下列官方页面的时间，不是官方生效时刻。
- 来源（均于 2026-11-01 读取）：[模型与定价](https://api-docs.deepseek.com/quick_start/pricing/)、[更新日志](https://api-docs.deepseek.com/updates/)（[中文版](https://api-docs.deepseek.com/zh-cn/updates/)）、[2026-09-10 V4.1 Flash 公告](https://api-docs.deepseek.com/news/news260910/)。
- 2026-09-10 公告写明：自 `2026-09-14T04:00:00Z` 起，`deepseek-v4-pro` 的请求转到 V4.1 Flash 并按 Flash 价格计费。更新日志的同日条目后来改为：9 月 14 日之后继续提供 V4 Pro API，计费方式不变。定价页仍单列 `deepseek-v4-pro`（模型版本 `DeepSeek-V4-Pro-0813`）及下表费率。核验时公告页仍保留这段路由说明，本目录以更新日志和定价页为准。
- 本解析器对 `deepseek-v4-pro` 的处理：
  - `2026-09-14T04:00:00Z` 之前：沿用历史 V4 快照的 Pro 费率，没有变化。
  - `2026-09-14T04:00:00Z` 至核验时间：仍按 Flash 快照计价，低于 DeepSeek 的实际计费。上传阶段 Agent 用量时，API 会用本解析器重新核对每条记录保存的价格快照；改动这段价格会让已有记录无法同步，因此保留。已保存的结算也不重新计算。
  - 核验时间起：按下表 Pro 费率计价，快照的生效时间记为核验时间。
- `deepseek-flash` 的费率本次核验没有变化，继续使用 2026-09-10 快照。`deepseek-v4-flash` 和 `deepseek-v4-flash-vision-exp` 仍可调用，请求由 `DeepSeek-V4.1-Flash-1017` 处理，按 Flash 价格计费。
- `deepseek-flash` 和 `deepseek-v4-pro` 的上下文长度均为 1M，最大输出均为 384K。调用前的核验上限（`verifiedModelCallBound`）覆盖 `deepseek-flash`、`deepseek-v4-flash` 和 `deepseek-v4-pro`，按本目录的高峰未命中输入价和输出价计算。名单中保留的 `deepseek-pro` 不是官方模型名，只为兼容已保存的数据；本目录没有它的价格，所以它得不到上限。

| 模型 / 别名 | 时段 | 缓存命中输入 | 缓存未命中输入 | 输出 |
| --- | --- | ---: | ---: | ---: |
| `deepseek-v4-pro` | 非高峰 | $0.022 | $0.66 | $1.98 |
| `deepseek-v4-pro` | 高峰 | $0.044 | $1.32 | $3.96 |
| `deepseek-flash` 及其别名 | 非高峰 | $0.003 | $0.15 | $0.60 |
| `deepseek-flash` 及其别名 | 高峰 | $0.006 | $0.30 | $1.20 |

价格单位均为美元 / 百万 Token。核验时，官方高峰时段说明还把中国法定节假日全天列为非高峰；本解析器没有节假日日历，节假日按普通工作日的时段计价。

<a id="deepseek-flash-snapshot-verified-on-2026-09-10"></a>

## 2026-09-10 核验的 DeepSeek Flash 快照

- 来源版本：`deepseek-pricing-snapshot-2026-09-10`。
- 核验时间：`2026-09-10T15:17:38.000Z`。这是本项目的核验时间，**并非声称该时刻就是官方上线时间**。
- 来源：[模型与定价](https://api-docs.deepseek.com/quick_start/pricing/)、[官方更新](https://api-docs.deepseek.com/updates/)。
- `deepseek-flash` 是新的公开名称。已有别名 `deepseek-v4-flash` 和 `deepseek-v4-flash-vision-exp` 路由到 V4.1 Flash，已保存的用户配置保持不变。
- 公告给出 Flash 发布日期，但未给出精确切换时刻。在该北京时间日期开始时刻（`2026-09-09T16:00:00Z`）至本项目核验时刻之间的调用，本解析器不计算价格。已经保存的历史结算继续保留，不重新计算。
- `deepseek-v4-pro` 在公告明确的路由切换时刻 `2026-09-14T04:00:00Z`（北京时间 12:00）之前沿用旧费率，之后采用 Flash 快照。DeepSeek 后来撤回了这次路由；2026-11-01 起的处理见上文 V4 Pro 快照。

| 模型 / 别名 | 时段 | 缓存命中输入 | 缓存未命中输入 | 输出 |
| --- | --- | ---: | ---: | ---: |
| Flash | 非高峰 | $0.003 | $0.15 | $0.60 |
| Flash | 高峰 | $0.006 | $0.30 | $1.20 |

价格单位均为美元 / 百万 Token。高峰时段采用下文相同的时间表。

<a id="historical-deepseek-v4-snapshot"></a>

## 历史 DeepSeek V4 快照

- 来源核验日期：2026-08-30。
- 来源版本：`deepseek-pricing-snapshot-2026-08-30`。
- 官方生效时间：`2026-08-16T16:00:00.000Z`。
- 币种与单位：美元 / 百万 Token。
- 官方来源：[模型与定价](https://api-docs.deepseek.com/quick_start/pricing/)、[Chat Completions 用量结构](https://api-docs.deepseek.com/api/create-chat-completion/)、[上下文缓存](https://api-docs.deepseek.com/guides/kv_cache/)。
- 生效版本来源：[DeepSeek V4 定价公告](https://api-docs.deepseek.com/news/news260813/)。

| 模型 | 时段 | 缓存命中输入 | 缓存未命中输入 | 输出 |
| --- | --- | ---: | ---: | ---: |
| `deepseek-v4-flash` | 非高峰 | $0.007 | $0.22 | $0.66 |
| `deepseek-v4-flash` | 高峰 | $0.014 | $0.44 | $1.32 |
| `deepseek-v4-pro` | 非高峰 | $0.022 | $0.66 | $1.98 |
| `deepseek-v4-pro` | 高峰 | $0.044 | $1.32 | $3.96 |
| `deepseek-v4-flash-vision-exp` | 非高峰 | $0.007 | $0.22 | $0.66 |
| `deepseek-v4-flash-vision-exp` | 高峰 | $0.014 | $0.44 | $1.32 |

高峰时段为周一至周五 UTC `01:00–04:00` 和 `06:00–10:00`（北京时间 `09:00–12:00` 和 `14:00–18:00`），包含开始时刻，不包含结束时刻。周末及其余时段均为非高峰。

<a id="settlement-contract"></a>

## 结算契约

DeepSeek 返回 `prompt_cache_hit_tokens` 和 `prompt_cache_miss_tokens`。两者必须为非负整数，之和必须等于 `prompt_tokens`；`total_tokens` 必须等于输入与输出之和。缓存 Token 是输入 Token 的分类，不能再额外累加一次。

持久化结算包含服务商、模型、时段、生效时间、来源与版本、三项单价、命中/未命中/输出 Token 数、缓存命中率、三项费用和总额。缺少缓存字段时，记录为数据不完整，缓存值和费用均为 null。拆分数据冲突时记为 `invalid_usage` 并拒绝结算。未知模型及缺少可靠拆分数据的旧记录保持未知，不会默认为缓存命中数零，也不进入精确结算费用汇总。

只有配置中的服务商上下文与响应解析器都确认计费服务商为 DeepSeek，结算才选择本目录。其他兼容网关仅返回相同模型名，不足以采用 DeepSeek 价格。

调用前预算检查独立进行：按所有输入均未命中缓存的高峰估价，为有上限的服务商调用预留预算。服务商返回的结算不会替换已保存的调用前决策，也不改变其审计含义。

<a id="stage-agent-accounting"></a>

## 阶段 Agent 费用记录

Direct Provider 与 OpenCode 阶段调用独立保存 `AgentTokenUsage`，不依赖产物是否成功生成。即使输出 JSON、引用或仓库只读校验失败，执行器已返回的用量仍然保留。重试单独记录；阶段失败不推进工作流。缺失或部分用量会明确标注。模型自行编写的用量和 OpenCode 的价格表均不能作为计费权威来源。

对于已核验的 DeepSeek 官方绑定，缓存用量完整时，阶段费用记录保存**高峰费率估算**及对应精确快照。一次包含多次调用的 Agent 会话可能跨越价格时段，因此这项汇总不能显示为服务商精确账单。无法识别的网关/模型或不完整的用量数据保留已返回的 Token 数，金额为 null，显示为“金额待确认”。没有费用记录的历史轨迹保持可见的不完整状态，不回填估算。

费用投影按白名单随现有 Run 摘要同步。API 幂等追加记录，拒绝同一 ID 的冲突复用，项目与成员汇总包含未知金额状态。桌面端在下一次远端预算评估前上传待同步阶段用量；金额未知或同步失败时，现有预算检查保持不可用并阻止调用。

新的本地门禁审查记录使用同一费用投影。保存用量时，在同一 SQLite 事务中将 Run 摘要加入同步队列，避免成功审查的消耗只留在本地界面。已有历史审查记录不重新标记，也不重新计价。
