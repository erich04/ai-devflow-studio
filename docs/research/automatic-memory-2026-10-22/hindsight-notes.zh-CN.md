# Hindsight 自动记忆机制核查

日期：2026-10-22。只读研究；没有调用用户的 Hindsight 服务、写入记忆、安装插件或修改配置。本文件给自动记忆方案提供技术依据，不代表新流程已经实现。

## 结论

用户关于“通常应该自动保存”的理解有依据。Hindsight 的 coding-agent 集成会通过宿主生命周期 hook 自动提交会话，服务端负责抽取事实、组织实体和关系，并可进行观察结论归纳。用户不需要逐条手动保存。

但需要区分三个责任：**宿主何时把什么内容提交给 Hindsight；Hindsight 怎样抽取和归纳；DevFlow 怎样决定这些结果是否可以成为有效经验或业务规则。** Hook 属于集成层，服务端不会自行监听任意 Agent。归纳更新也不等于自动删除所有不重要或冲突的原始记录。

DevFlow 当前实现显式关闭 observations 和自动 consolidation，只投影选定文档及受限正式记忆。它尚未接入聊天结束自动提交，因此不能把第三方插件能力当成现有 DevFlow 行为。

## 证据与边界

本次在线访问 web 搜索工具、Hindsight 文档站及 GitHub 均失败，包含连接失败和 TLS 握手错误；没有获得可确认最新内容的在线快照。以下依据为：

1. 本机 [hindsight-coding-agent 技能说明](/Users/erich/.agents/skills/hindsight-coding-agent/SKILL.md)，由官方集成 README 生成。该文件没有可核验的插件版本；它可以说明这份说明文档描述的行为，不能证明插件当前已经安装或运行。`/Users/erich/.hindsight/coding-agents` 当前不存在；未读取配置、密钥或会话。
2. 前次官方 OpenAPI 下载缓存 `/private/tmp/devflow-hindsight-openapi-v1.json`，SHA-256 为 `8ac3fbc2eb2796c32109fd1ad016cb8f8de43c0934d87a89910bd8478e42c55d`，与[已归档的契约核验记录](../../validation/hindsight-integration-20261020.md)一致。版本为 1.0.0，固定提交 `39c65ffe2f140d0c84cee58566cad8900c5b9908`。官方来源是[固定版本 OpenAPI](https://github.com/vectorize-io/hindsight/blob/39c65ffe2f140d0c84cee58566cad8900c5b9908/hindsight-docs/static/openapi.json)。缓存仍是契约证据，不等于本轮服务实测。
3. DevFlow 当前源码，以及[此前部署记录](../../validation/hindsight-local-deployment-20261020.md)。此前部署时保存的 `config.py` 可辅助区分原始文档保留、历史快照裁剪、日志清理，但本轮未重新核验运行容器。

官方后续复核入口：[coding-agent README](https://github.com/vectorize-io/hindsight/blob/39c65ffe2f140d0c84cee58566cad8900c5b9908/hindsight-integrations/coding-agents/README.md)、[Retain 文档](https://hindsight.vectorize.io/developer/api/retain)、[Observations 文档](https://hindsight.vectorize.io/developer/observations)。本轮未成功打开这些在线页面，不能据此声称最新版插件与所部署服务已经兼容。

## 自动流程的实际职责

| 能力 | 可确认的行为 | 不应推导出的保证 |
| --- | --- | --- |
| 会话 hook | 本机技能 `retainSessions` 说明：默认开启；hook 型宿主在 Stop 写入；OpenCode、OpenCode 2、Kilo 等插件型宿主每轮 upsert，并用 idle flush 补齐最终答复 | 不能把 Stop 一律翻译成整个会话关闭；不同宿主事件粒度不同；不能说所有 harness 都有同一个“每轮结束 hook” |
| 自动上下文注入 | 技能说明在会话首个 prompt 默认调用 reflect；可改为 pages、recall、none；检索失败降级 | 不等于每轮都执行 reflect，也不保证每次都命中 |
| `retain_memories` | 固定契约写明：事实抽取、embedding、相似事实去重、实体识别和链接、时间与语义链接；支持异步处理 | 抽取结果不自动具有“已通过测试”“业务已批准”的地位 |
| 文档更新 | `document_id` 定位来源；默认 replace 删除该文档旧内容和派生 memory units 后重新处理；append 是另一种更新模式 | 不保证重新处理后 fact ID 不变，不等于跨所有文档的业务冲突裁决 |
| `trigger_consolidation` | 契约描述为从近期 memories 创建或更新 observations；可按 tag scope 处理 | 本轮没有完整源码证据证明每种冲突、删除动作的准确语义；不应承诺自动判断所有无用原始消息并清除 |
| `recall_memories` | 召回 `world`、`experience`、`observation`；不传 types 会查询全部 | 引用全部 fact types 不等于全部来源都可信或都获得发布批准 |
| `reflect` | 检索事实、经验、观察结论和 mental models，再由 LLM 形成回答 | 不等于删除、归档或生命周期管理 API |
| 删除与失效 | 有显式 `delete_document` 和 memory state；文档删除契约覆盖该文档、派生 units 和相关 links | 不可把“新结论覆盖旧结论”直接称为“旧原文已删除”；异步任务、观察结论、知识页等删除闭包仍需专项验证 |
| TTL | `MemoryItem` 没有逐条 TTL/expiry 字段；缓存、操作记录和日志有保留设置的证据 | 不能用日志清理、缓存 TTL 或历史快照条数上限证明业务记忆会按期删除 |

本机技能还指出：`retainContext` 应区分说话者，Agent 自称“修好了”“测试通过”只能作为它的陈述，而非自动当作事实。这一点直接支持 DevFlow 对验证结果、业务规则与一般经验采用不同生效条件。

技能的 observationScopes 默认 `shared`，允许同一 repo 多 harness 形成一套观察结论；但 scope 配置与租户/用户权限不是同一件事。DevFlow 仍必须按既有项目和身份边界隔离，不能因示例叫 shared 就开放团队共享。

## 固定契约能否支持“自动抽取后由 DevFlow 生效”

可以设计，但有新增协议验收项。无需用语义 recall 猜测刚才抽取了什么：

1. Electron 主进程把一个已完成、持久化的事件提交到独立的提取 bank，分配确定性的 `operation_id` 和不可变 `document_id`。
2. `retain_memories(async=true)` 返回操作身份，使用 `get_operation_status` 跟踪。相同异步 operation ID 的重放复用原操作；这不应被扩大解释为所有模型调用或重处理都严格 exactly-once。
3. 操作完成后，调用 `GET /v1/default/banks/{bank_id}/memories/list`，使用 `document_id`、`type`、`state`、`limit`、`offset` 精确列举基础事实。
4. 返回 `ListMemoryUnitsResponse` 包含 `items`、`total`、`limit`、`offset`。`MemoryUnitListItem` 提供 `id`、`text`、`document_id`、`chunk_id`、`metadata`、`state`、`updated_at`。`source_memory_ids` 主要用于 observation 的来源，基础 fact 通常为空。
5. `get_document` 返回 `original_text`、`content_hash`、`memory_unit_count`；可辅助核对本地事件摘要和导出完整性。
6. DevFlow 校验来源后写入本地候选/正式记忆：普通且有证据的经验按政策自动生效；业务规则及明确冲突进入待确认；低价值或证据不足的一般经验忽略，不为其反复打扰用户。Agent 的生产召回不查询提取 bank。

必须明确以下边界：

- 列表是 offset 分页，不是有快照标识的分页。导出期间不能对该事件文档 upsert/reprocess；事实 ID 去重后需与可核对的数量一致，结果不稳定则重试或隔离，不能只取第一页。
- schema 里只有 `id` 必填，其余字段可能缺失或为空；宿主要按实际需要强校验，不能给缺失来源补猜测值。
- ID 是服务端 memory unit 身份，不承诺跨重新抽取稳定。持久化回执必须包含 event ID、document ID、operation ID、提取配置版本和 source digest，不能只依赖 fact ID。
- 源 `chunk_id` 是文档分块，并不是逐条消息引用或“该语句已获得批准”的证明。上传事件需保留说话者、消息 ID、工具证据 ID；本地校验必须能回到这些来源。
- 固定契约宣称相似事实去重，但未证明跨文档去重后 `document_id` 过滤一定能穷举所有当前事件贡献的事实；这必须在自动晋升启用前实测。若出处丢失，不能把语义 recall 当作补救凭据。
- 分页列表、文档校验、去重与重处理后的事实身份尚未包含在既有适配器验收中。仅因 OpenAPI 声明支持，不能直接标记为已通过。

## `dry-run-extract` 的替代方案

固定契约还有 `dry_run_extract_memories`：返回候选 facts、输入 chunks 和 token usage，不执行实体解析、embedding、关系写入或持久化。这适合比较提取规则、离线质量集和配置预览。

它没有异步 `operation_id` 与可恢复的结果身份。响应丢失后的重试可能再次产生抽取费用；若随后再 retain 同一内容，也可能重复抽取。因此首期主流程可优先复用已有异步 retain 和出箱机制；dry-run 留给评测。这个选择仍需比较成本，不应因其名为 dry-run 就当作不计费调用。

## 对 DevFlow 方案的建议

- 从“每条经验由用户保存”改为“项目一次配置自动记忆，事件结束后后台处理；手动保存作为显式强调入口”。
- 复用 Hindsight 的事实抽取和去重，不再在 DevFlow 另做一套相同的泛化抽取器。DevFlow 负责事件边界、来源、授权、业务分类、冲突确认、有效期和可撤销性。
- 首期使用独立提取 bank，关闭 observations/consolidation，避免多来源归纳把尚未确认的规则或冲突带入现有知识检索。现有文档 bank 的配置保持不变。
- Hindsight 自动生成观察结论可以作为后续可评测能力。先证明多来源映射、冲突处理、撤回传播、质量和费用，再讨论开启；不要把已有框架能力全部重写，也不要直接把服务端所有归纳当作正式规则。
- “无需逐条确认”不代表没有状态：用户能查看自动保存、待确认、已忽略、失败待重试，并能手动保存、纠正、忘记或暂停。后台处理不阻塞聊天和编码完成。

当前源码入口：[Hindsight 客户端](../../../apps/desktop/electron/hindsight-client.ts) 的 `configureBank`、`retain`、`operation`、`deleteDocument`、`recall`；其中 `configureBank` 明确设置 `enable_observations: false` 和 `enable_auto_consolidation: false`。这些现有方法尚不包含提取结果完整导出。
