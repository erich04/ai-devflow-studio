# Hindsight V2 第二轮复审与处置

日期：2026-10-20。

结论：可以开始客户端、投影存储和假服务的本地实现。首个用户入口是项目讨论中的知识搜索，随后增强正式记忆召回；经历归纳、团队共享、完整关系库和博客发布继续后置。真实业务文档同步与线上召回，需要先满足方案中的数据范围、版本和协议验收条件。

Cursor/Grok 4.7 Extra High 的原始结论是 `pass_with_risks`：0 个设计阻塞项、5 个风险。Codex 独立核对并接受了有依据的补强，已写入[当前 V2 方案](../../plans/hindsight-integration-v2-2026-10-20.zh-CN.md)。这不是实施完成、服务实测通过或上线批准。

## 本轮实际完成了什么

- 使用 [cursor-collab-review 技能](/Users/erich/.codex/skills/cursor-collab-review/SKILL.md)，模型为 `grok-4.7-xhigh`，模式为 `ask`，续用首轮会话 `dac3b3e9-b35e-4e27-ab2d-d94cfd3af9d2`。
- 将知识文档、原生结构化标签、来源版本和两个读取入口整合成 V2；发送的是方案及相关源码，不含凭据或用户数据库。
- Cursor 完成一次增量复审，耗时约 507 秒。原始报告、机器结论、脱敏审计和送审快照均已归档。
- Codex 独立回读关键源码和官方公开资料，修订方案并逐项记录处置。没有只为取得 `pass` 再请求一轮。
- 没有修改业务代码、运行应用测试、安装或启动 Hindsight，也没有执行真实 retain/recall 或上传业务知识库。本轮外部模型调用仅为用户授权的 Cursor 咨询。

## 首轮三个缺口

| 问题 | 本轮判断 |
|---|---|
| 过期与可见性收紧未进入远端清理 | 已在设计中补齐。当前过期分支确实在 `retrieveAgentMemoryRevisions` 内 CAS、审计并持久化，新增 outbox 必须接此分支和修订分支。 |
| 跨运行 user_project 被 sessionId 误过滤 | 已写明按当前 SQL 的可见性谓词解析精确来源；运行回执 scope 检查保持独立，不能以直接 getHead 替代授权。 |
| 提供方失败和费用影响编码启动等主路径 | 已明确隔离在 `recallScopedMemory` 内，先保留有效本地结果，再做受独立限额约束的远端补充。 |

“设计中补齐”不表示代码已经修复。本轮没有新增实现；这些条款及其确定性测试必须在实施时一起落实。

## 五项风险的独立处置

| Cursor 风险 | Codex 处置 | 已修改内容或保留条件 |
|---|---|---|
| 当前 ADR 与外传选中 Markdown 的新能力不一致 | 采纳，保留为真实启用条件 | V2 第 2、3、7、8 节明确默认关闭、仅选中文档、提取/embedding/reranker 提供方、查询出境和新的 ADR 决策。此次只读评审不充当上传业务资料的授权。 |
| 快照差集或 `truncated=false` 不能证明文件删除 | 采纳并具体化 | V2 第 5 节要求核对实际项目根，用 literal pathspec 精确验证 Git tracked 状态，再安全读取单文件；ENOENT 与部分排除路径没有 warning，不能用快照列表差集清理。错误与确认缺失分别记录。 |
| 配对/解除/改绑及重新 opt-in 可能和旧清理交错 | 采纳为状态转换契约 | 配对 durable 更新同时记录受影响项目停用、授权 generation 和清理任务；重新取得本地资格不自动启用；撤销清理未核实前不再写同一来源。仅凭据刷新和无关项目不误停用。 |
| map 字段被错误拼接成完整规则 | 采纳 | V2 第 4 节禁止按序、同文档或共现配对 `name/statement`，离线评估也按独立路径处理；未来精确对象须另保存完整结构、身份和来源。 |
| 取消、删除、观察归纳与来源回传缺少锁版本证据 | 采纳为协议验收条件 | 不阻塞本地假服务实现；真实启用前记录固定版本、请求/响应和行为。文档与源码核验不能代替运行结果。对当前取消文档的内部冲突另作修正，见下文。 |

## 六条建议及额外核对

Cursor 的六条建议均有可操作部分，已采纳或保留为明确的实施条件：

1. 配对变更、重新启用和清理互斥：纳入第 3、5 节，区分撤销清理和有授权的模型升级重建。
2. 单路径 tracked + 普通文件读取：纳入第 5 节；实际执行用参数数组和 literal pathspec，避免文件名被解释成 Git 通配规则。
3. 摘要和载荷一致：使用完整原始字节的 `sha256:`，脱敏载荷另算摘要；不使用 `kh-` 回退、整份快照 hash 或索引阶段改写的 front matter，不上传 L0。
4. map 字段禁止按顺序恢复对象：已写明，实际展开仍在固定版本协议测试中核对。
5. 工具完整接线：系统提示、分发、MCP fields/schema、Direct/OpenCode 路径、轨迹和名单测试都纳入；旧隐藏 `knowledge` 工具继续本地词法行为。
6. 新 ADR：纳入真实启用条件；当前没有将它伪标为已接受。

另外独立补齐了以下具体契约：

- **讨论入口已强制刷新。** `main.ts:2296` 将 `loadKnowledge` 绑定为 `loadTrustedRepositoryKnowledge(projectId, { refresh: true })`。不能根据 cache.load 的实现断言讨论工具每次都读旧缓存。实际需要处理的是有界扫描漏项、扫描后变化，以及搜索与回读使用同一来源摘要。
- **搜索结果必须能回读。** 当前 `readWorkbenchKnowledge` 只在快照列表找路径。V2 为搜索回读增加宿主 sourceRef / expectedDigest 的兼容分支：即使全局扫描漏掉已选文件，也能在该来源范围内精确核验；版本改变返回 source_changed，不能把新正文贴在旧引用上。
- **工具参数不能只改名单。** 当前 MCP 通用字符串 500 字符、limit 18,000 的校验不等于 V2 的 query 2 KiB、5 个来源契约；Direct 和 MCP 应执行一致的专用约束。
- **知识根以实际接线为准。** `main.ts` 当前创建默认知识服务；`Project.knowledgeBasePath` 不能被假定已驱动本地服务。V2 首期沿用快照实际根，未来改根时重建服务/缓存及 generation。
- **知识搜索单独保留本地降级。** 对提供方失败回退当前有效本地候选；不吞掉本地权限和数据完整性错误。

## 官方材料的补充核验

Cursor 的两次 WebFetch 被其工具权限拒绝；它没有扩大权限或重试。Codex 使用自身已有的只读浏览能力独立核对了以下公开来源，没有要求用户放宽 Cursor 权限。

| 来源 | 文档或源码支持的范围 | 尚不能宣称 |
|---|---|---|
| [entity_labels 源码](https://github.com/vectorize-io/hindsight/blob/main/hindsight-api-slim/hindsight_api/engine/retain/entity_labels.py)、[bank 配置](https://hindsight.vectorize.io/developer/api/memory-banks#entity_labels) | 存在受控词表、动态结构化抽取模型和嵌套 map；map 字段编码为路径标签。 | 已锁定部署版本；多对象字段已保持完整对象身份。 |
| [observations 配置](https://hindsight.vectorize.io/developer/api/memory-banks#enable_observations) | 文档分别定义总开关与自动 consolidation 开关。 | 真实部署已停止所有相关模型调用或已证明零费用。 |
| [Retain](https://hindsight.vectorize.io/developer/api/retain)、[Recall](https://hindsight.vectorize.io/developer/api/recall) | metadata 被描述为字符串上下文并参与抽取；召回结果包含来源字段；异步 retain 支持调用方提供 operation_id。 | 在部署版本中已验证全部重放、异常和来源完整性分支。 |
| [Documents](https://hindsight.vectorize.io/developer/api/documents#delete-document) | 文档删除接口描述关联记忆的删除。 | 未完成任务、所有派生物、日志和备份已全部被清除。 |
| [Operations](https://hindsight.vectorize.io/developer/api/operations#cancel-an-operation) | 同一页正文允许 processing 的协作式取消，示例注释却写 processing 返回 409。 | 任一段都可作为所有版本的保证。必须固定版本查实现并实测；取消状态不等于执行已静止。 |

本次没有取得固定的 Hindsight 镜像 digest、SDK 锁定版本或真实响应。外部源码证据来自可变主分支，不能伪称不可变部署证据。送审 V2 第 10 节原先只依据取消示例作描述，现已在最终方案中修正为正文与示例冲突；首轮迟到写入防护继续保留。

## 文件与验证范围

- [第二轮送审原文](round2-submitted-proposal.zh-CN.md)：保留 Cursor 读到的版本，不随方案修改。
- [Cursor 原始报告](round2-cursor-review.zh-CN.md)与[结构化结论](round2-cursor-review.json)：保持顾问输出。
- [审计元数据](round2-metadata.json)记录模型、会话、输入/报告摘要及是否执行服务测试；本机审计归档中的 `round2-cursor-audit.json` 保留工具活动和完成状态，不随源码发布。
- [首轮方案](round1-proposal.zh-CN.md)与[首轮评审](round1-cursor-review.zh-CN.md)保留历史上下文，不作为当前产品事实。

本轮仅验证文档内 JSON 示例可解析、引用的实现文件存在、归档摘要匹配及文档变更范围。没有运行业务测试，文档验证不能用于宣称接入功能可用。实施时应按 V2 列出的本地确定性用例和固定版本协议用例完成验证。
