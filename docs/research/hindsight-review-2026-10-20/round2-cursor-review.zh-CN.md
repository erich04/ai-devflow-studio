上一轮的三个阻塞点要对照 V2 原文再核一遍。我先读修订稿和首轮材料，再只核对方案点名的源码与文档。V2 已把过期出箱、hydration 谓词和召回兜底写进方案。接下来对照知识读取、工具接线和配对范围，看这些新路径是否真能落地。上一轮三处设计缺口已经写进 V2，而且和当前调用点对得上。知识路径的权威边界也清楚。剩下的是配对恢复、快照差集和真实启用前的协议验收，不阻止先做本地假服务实现。

# Hindsight 接入 V2 增量复审

评审对象是 `docs/plans/hindsight-integration-v2-2026-10-20.zh-CN.md`。对照了首轮方案、首轮评审和方案点名的源码。本轮两次读取官方页面都被拒绝，没有改权限重试。下面把 Hindsight 的取消、删除闭包、`entity_labels` 展开和 `enable_observations` 都标为启用前验收，不把“尚未实测”写成不能做本地实现。

#

# 结论

可以按方案第 8 节的顺序做本地实现：先固定版本并接假服务，知识搜索作为第一个真实消费入口，正式记忆先影子评估，经历与归纳继续后置。

首轮三个设计缺口在方案里已经闭合，并和当前代码的真实分支一致。

| 首轮缺口 | V2 写法 | 代码位置 |
| --- | --- | --- |
| 过期不入清理队列 | 晋升、修订、删除、到期与独立 outbox 同一次 durable mutation 落盘；验收包含可见性收紧 | 过期仍发生在 `retrieveAgentMemoryRevisions` 内部，约 5433–5488 行：CAS 把 head 标为 `expired`、写 `memory_expired` 审计并 `persist()`。出箱必须挂在这个分支，以及 `commitAgentMemoryRevision`，不能只挂 `commitAgentMemoryDeletion` |
| hydration 把 `sessionId` 当成范围 | `user_project` 比用户和项目；`runtime` 才比运行与会话；回执 scope 的精确比较保留为另一种校验 | `retrieveAgentMemoryRevisions` 5397–5400 行就是这个谓词。`executionScope` 仍会为每次运行生成新的 `coding-session-…` |
| 召回失败或费用拖垮主任务 | 先得到有效本地结果；只有提供方故障、超时、额度不足才回退；权限和完整性错误继续抛出。三入口先影子评估。知识搜索另有次数和字节上限 | 讨论栏和阶段 Agent 的外层 `catch` 仍会吞掉整个 `recallScopedMemory`。编码召回仍在 `reserveCodingAgentRun` 之前且没有 catch。隔离必须留在该函数内部 |

知识文档、`entity_labels` 和 `knowledge_search` 的权威划分是对的：远端事实是可重建候选，当前工作树字节和正式记忆 head 才是内容权威。模型标签不能覆盖宿主写入的 `df_*` 来源身份。

## 知识来源：哪些判断已经有代码依据

`createRepositoryKnowledgeService.index` 用 `git ls-files -z --cached` 枚举已跟踪路径，再用 `readSafeRegularFile` 读工作树字节，并以 `sha256:` 加原始缓冲的十六进制写入 `contentDigest`。因此摘要不是 commit blob，也不是 Git 树。方案写明“工作树摘要不等于 Git commit”，这和实现一致。选中文件上未提交的修改会进入日后的 retain 载荷。

稳定文档 ID 由 `remapStableKnowledgeIds` 对完整 `sourcePath` 做 SHA-256 再截取，不使用 `indexKnowledgeSources` 里的 basename slug。重命名会得到新 ID。方案把重命名当成删除旧来源、增加新来源，这是正确适配。

缓存方面，`RepositoryKnowledgeCache.load` 有快照就直接返回；`refresh` 才重新扫描。讨论栏在 `main.ts` 里把 `loadKnowledge` 接成 `refresh: true`，所以 `knowledge_list` / `knowledge_read` 每次都会重扫。阶段 Agent 和 `loadRun` 走的是 `load()`，可以命中旧快照。一次 refresh 结束后文件仍可能变化。搜索命中必须用同一次 `readSafeRegularFile` 的字节做核验和片段组装，不能只看 `cache.load` 或快照里的 `markdown`。

截断不能当成删除。`index()` 在这些情况下会从结果里丢掉路径：

- 工作树已删除但 Git 索引仍列出该文件：`ENOENT` 时直接 `continue`，不写 warning。注释写“manifest 可以报告缺失”，当前返回值里没有缺失清单。
- 排除目录和部分点缓存目录：无 warning。
- 单文件超过 256 KiB、文件数、总字节、字符数或 chunk 上限：设置 `truncated` 和对应 warning，后面的文件不再出现。

因此 `truncated === false` 也不是“知识目录完整清单”。方案规定只有显式取消选择、切换知识根，或对该路径做安全精确检查确认缺失，才生成撤销记录；当前性无法证明时停止使用该来源的远端结果。这条规则应保持。精确检查应是该相对路径上的 `readSafeRegularFile` 加上 `git ls-files -z --cached -- <path>`，不要用 `snapshot.documents` 的差集。

`knowledge_read` 今天只在快照文档列表里找路径。搜索若返回一份被截断扫描漏掉、但直接读取仍成功的已选文件，后续 `readWith=knowledge_read` 会报“知识目录中没有这个文件”。讨论入口应让这个回读走同一套安全单文件读取，并比较同一种 `sha256:` 原始字节摘要。不要和快照的 `contentHash`，或缺少 `contentDigest` 时的 FNV 回退 `kh-` 比较。

默认隐私方面，L0 的 `AGENTS.md` / `CLAUDE.md` 会进入快照和 `contentHash`，也会出现在 `knowledge_list`。方案不默认上传它们，这个过滤必须做在选择清单上，不能因为整份快照哈希变化就重传全部文档。知识根空字符串表示整仓；选择仍应限制在当前知识根内的已跟踪 Markdown，并且不超过 20 份。

## knowledge_search 要接上的真实工具链

讨论栏的 Direct Provider 和 OpenCode 共用 `WorkbenchConversationService.tool()`。OpenCode 再经 `createWorkbenchMcpBridge` 的 `fields` 做 `tools/list` 和参数校验。要让新工具真实可用，需要同时改这些位置：

- `workbench-conversation-service.ts` 约第 40 行的系统提示。这里现在写明：知识目录按关键词查找要用 `repo_search`。
- 同文件 `tool()` 约 434–437 行，目前只分发 `knowledge_list` 和 `knowledge_read`。
- `workbench-mcp-bridge.ts` 的 `fields`，以及锁死工具名单的 bridge 测试。
- `workbench-knowledge-tools.ts` 的新搜索函数和工具轨迹。

未在列表中广告、但仍可调用的旧 `knowledge` 工具会返回快照片段。它应保持本地词法行为，不要改成 Hindsight 搜索，也不要重新写进提示词。调用方继续不能传入 bank、任意路径或用户身份。`stage` 沿用 `isKnowledgeStage` 和 `knowledgeDocumentAppliesToStage`。

现有 `KnowledgeEntity` / `KnowledgeRelation` 只由文档、标签和 `defines` 生成。不要把 Hindsight 共现边写成 `tests`、`approves` 或 `owned_by`。

## 模型映射

宿主生成三类产物：Hindsight `entity_labels`、本地候选的结构校验、给人读的模型说明。现有 TypeScript 领域类型仍是执行契约。`sem_*` 只用于检索和展示；来源、确认状态、范围、模型版本和过期时间放在宿主的 `df_*` metadata。这个分工利用的是 Hindsight 的 bank、retain/recall、`document_id` 和标签配置；范围过滤、字节核验、出箱和回读是 DevFlow 适配。

方案已经写明 `map` 会展开成字段路径，不能靠共现恢复多对象的字段绑定。样例里的 `sem_rule.name` 与 `sem_rule.statement` 因此不能按返回顺序配成一条规则，离线候选也不要这样配对。用户可见正文保持为核验过的原文片段。此项不阻止本地实现；标签是否真的按路径展开，留在锁版本测试。

模型定义放在仓库 JSON 里时，用与知识文件相同的安全相对路径读取，限制大小和保留字段，拒绝脚本、endpoint 和凭据。描述文本会进入抽取提示，不能把它当成权限来源。

## 设计上建议先写清、但不阻止开工的一点

配对写入点是 `saveDesktopPairingCredential`。`executionScope` 在 `pairing.localProjectId === projectId` 时把该项目变成 `team`。方案要求此时停用提供方并进入清理。解除配对或改绑到其他项目后，如果 opt-in 仍为真，而“仅未配对”又重新成立，新的 retain 可能和未完成清理并行。

建议写成：离开“该本地项目且未配对”就停用并入队清理；恢复未配对不自动打开，需要用户再次 opt-in；同一逻辑来源在清理核实前不提交新 retain。搜索侧继续丢弃投影记录对不上的命中。这是范围规则的补强，现有“迟到完成仍要清理”和“核验失败即丢弃”已经盖住用户可见泄漏。

## 真实启用前的协议验收

这些条件不阻止第 8 节第 1 步的假服务和本地确定性测试。真实上传或打开线上 recall 之前要有锁版本证据：

- metadata 与 `document_id` 是否原样返回；metadata 是否进入抽取提示。
- 同一 `operation_id` 在相同载荷、不同载荷和取消之后分别返回什么。
- 当前 Operations 文档中的 409 是否覆盖处理中与已完成；宿主仍把未结算操作保持为 `cleanup_pending`，不用旧的“子批次晚到”描述代替实测。
- 删除文档是否覆盖 fact、observation、mental model 和未完成操作。
- `enable_observations=false` 是否同时停掉自动和手动 consolidation；只关 `enable_auto_consolidation` 不够。
- `map` 多对象是否变成独立字段路径；`chunks` 模式是否不跑 labels。
- 选中工作树字节离开桌面的新 ADR 已接受，其中写明默认关闭、未选文档和 L0 不上传、提取模型可能在机外。ADR 0011 与 0025 目前仍禁止 Markdown 离开桌面、也不引入向量索引。

## 最小顺序

1. 协议夹具、客户端、独立投影表和假服务。不上传真实文档。
2. 最多 20 份显式选择的知识文档，加上讨论栏 `knowledge_search`。验收当前性、撤销、范围和查询预算。
3. 记忆的 scoped hydration 与三入口影子评估，通过后再按项目打开。
4. ExperienceRecord、Reflect、团队共享和关系库保持在后续方案。

融合没有增量相关命中时，停止扩大同步。这个停止条件可以保留。

## 本次没有做成的检查

`WebFetch` 读取 `entity_labels.py` 和 memory-banks 文档时返回 User Rejected。没有扩大权限，也没有再次请求。请 Codex 只读抓取这两处以及方案第 10 节的 Retain、Recall、Documents、Operations 页面，回传版本或 commit、以及 map 展开、`enable_observations`、取消状态码、删除级联的原文片段。不要据此把待验收项改成已保证。本地不需要为这次复审再跑会写缓存的测试。

## Machine Verdict

```json
{"verdict":"pass_with_risks","blocking_issues":[],"risks":[{"summary":"真实试点会把选中 Markdown 的当前工作树字节发给 Hindsight 及其提取模型，而 ADR 0011 与 0025 仍要求 Markdown 留在桌面且不引入向量索引。新 ADR 落地前打开上传会越过现行决定。","likelihood":"medium","impact":"high"},{"summary":"index() 对工作树缺失路径无警告地 continue，排除目录也不产生 warning。用 snapshot.documents 差集或 truncated=false 判断删除，会漏撤或误撤远端投影。","likelihood":"medium","impact":"high"},{"summary":"解除配对或再次 opt-in 时，若未配对资格立即恢复且清理尚未核实，同一 bank 中可能同时出现新旧 retain。","likelihood":"medium","impact":"high"},{"summary":"若把 map 展开后的 sem_rule.name 与 statement 按顺序配成对象，离线候选会把同一文档里的多条规则绑错；该展开行为尚未用锁定版本实测。","likelihood":"medium","impact":"medium"},{"summary":"取消、删除级联、observations 开关和 metadata 是否进入抽取提示都还没有锁版本证据。提前打开真实召回会把这些文档假设当成清理完成条件。","likelihood":"medium","impact":"high"}],"recommended_revisions":["在 saveDesktopPairingCredential 成功且 localProjectId 进入或离开该项目时停用提供方并入队清理；恢复未配对不自动重新 opt-in，同一逻辑来源在清理核实前不提交新 retain。","把知识缺失检查写成单路径 readSafeRegularFile 加 git ls-files -z --cached -- <path>，并写明 ENOENT 与排除目录不会出现在 warnings 里。","投影、搜索引用和 knowledge_read 使用与 sha256Digest 相同的 sha256: 原始字节摘要；不上传 projectInstructions，也不上传 boundSourceMetadata 改写后的 front matter。","entity_labels 的 map 字段按独立路径评估，禁止按序配对 name 与 statement；用户可见正文只来自核验后的原文。","knowledge_search 同时改系统提示、tool() 分发、MCP fields、工具轨迹和名单测试；保留 list/read，旧的未列出 knowledge 工具继续只做本地快照词法检索。","真实上传前接受新 ADR，写明默认关闭、仅选中的知识根 Markdown、工作树字节可能出机，以及提取与 rerank 提供方。"],"next_iteration_prompt":""}
```