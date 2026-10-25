# DevFlow 直接接入 Hindsight：V2 复审方案

后续范围：用户已选择全链路接入；“仅未配对项目／讨论工具”的首期限制由[全阶段方案](hindsight-fullchain-2026-10-20.zh-CN.md)扩展。本文保留首期方案与验证历史。

日期：2026-10-20。状态：已完成第二轮 Cursor/Grok 4.7 Extra High 只读复审；顾问结论 `pass_with_risks`，无新增设计阻塞项。用户随后授权实施，现已落地本地宿主基础、知识搜索和正式记忆影子接线，并通过本轮确定性开发验证。独立服务部署、三种抽取模式基础协议、中文真实抽取与宿主生命周期检查已通过；跨语言排序存在问题，完整启用与价值验收仍待执行。具体结果见 [ADR 0027](../adr/0027-selected-hindsight-projections.md)、[开发记录](../validation/hindsight-integration-20261020.md)、[部署验证](../validation/hindsight-local-deployment-20261020.md)、[DeepSeek 真实验证](../validation/hindsight-deepseek-validation-20261020.md)。复审原始证据仍见[复审处置](../research/hindsight-review-2026-10-20/round2-disposition.zh-CN.md)，不把后续实现当作 Cursor 已审阅代码。

代码基线：`a55d1f7ea56bb1ea77d84184a9828bc4c05ee74b` 加当前工作树。已有设计修订等未提交修改属于其他工作；本方案不修改它们。行号仅辅助定位，以函数名和当前实现为准。

## 1. 这次要解决的问题

直接给 DevFlow 加入 Hindsight，不引入 OpenViking。用户希望同时获得知识库检索和长期记忆能力，并让业务概念、抽取规则与应用逻辑使用一致的模型。

V1 主要把正式记忆投影到 Hindsight。V2 增加“选择的仓库知识文档”和原生 `entity_labels` 建模；明确知识、记忆和执行证据的不同权威来源。首期用现有知识支持调查和问答，不建设完整 Palantir 平台，不自动发布博客，不把抽取关系升级为审批依据。

目标体验：在项目讨论中问“退款规则变更需要检查哪些规范”，得到当前项目知识文件的可读引用；既有正式记忆继续可用；服务不可用时保留本地能力。

## 2. 当前代码事实与保持的业务逻辑

| 位置 | 当前事实 | 接入处理 |
|---|---|---|
| `apps/desktop/electron/coding-context.ts`：`recallScopedMemory`、`assertCodingContextCurrent` | 编码、阶段生成和讨论共用范围内记忆召回；按词法相关度、预算选原文；恢复时核对回执。 | 增加可选召回候选，保留本地权威、预算和回执。 |
| `apps/desktop/electron/local-store.ts`：`retrieveAgentMemoryRevisions` | 检查配对、范围、可见性与 tombstone；到期会 CAS 更新 head、写审计并持久化；范围扫描硬上限与返回窗口不同。 | 过期和同步任务须共同落盘；新增精确 ID 集合的 scoped hydration，不能直接用 getHead 绕过范围。 |
| `apps/desktop/electron/repository-knowledge.ts` | Git tracked Markdown 索引、安全路径读取、有大小/数量上限；`remapStableKnowledgeIds` 按完整 sourcePath 的摘要重映射 ID；读取当前工作树字节并计算摘要。 | 复用安全读取和路径身份。不能根据 shared helper 的 basename ID 推断桌面有同名冲突；也不能把工作树摘要等同 Git commit。 |
| `repository-knowledge-cache.ts`、`repository-knowledge-resolver.ts`、`main.ts:2296` | `load` 可返回缓存，`refresh` 重新扫描；讨论入口实际强制 `refresh: true`，不能说它始终读旧缓存；resolver 校验 project/run/node 归属。 | 重扫仍有截断和扫描后的变化，远端命中需要精确来源读取。 |
| `workbench-knowledge-tools.ts`、`workbench-conversation-service.ts`、`workbench-mcp-bridge.ts` | 讨论有 `knowledge_list/read`，只读工具带范围边界；知识用于调查。 | 新增 `knowledge_search` 并接到实际工具定义与分发；保持 list/read。 |
| `packages/shared/src/domain.ts`、`knowledge.ts` | 有轻量 `KnowledgeEntity/Relation`；当前自动图主要由文档、标签及 `defines` 构成。 | 不将 Hindsight 的共现边直接转换为 `tests/approves/owned_by` 等业务关系。 |
| ADR 0018、0024、0025，`CONTEXT.md` | 正式记忆晋升、知识目录/阶段适用、Gate 与证据各有独立职责。 | 保留当前晋升与审批流程，新增能力不能批准 Gate 或授权动作。 |

ADR 0011/0025 当前保留 Markdown 不离开桌面及不引入向量索引的决定。实现时需写明确的新 ADR：只对用户启用的本地项目和选中文档允许 Hindsight 投影，说明提取/embedding/reranker 的实际提供方和查询数据流；默认关闭及未选择内容仍遵守原边界。本次讨论和源码评审授权不等于未来上传业务文档的授权；本轮不上传业务资料。

当前 `main.ts` 创建默认 `createRepositoryKnowledgeService()`；实际知识根取服务与快照的 `knowledgeRoot`，默认 `docs/knowledge`。不能假设 `Project.knowledgeBasePath` 已连接到每个本地项目实例。首期沿用实际知识根；将来配置根变更时必须重建对应服务/缓存并增加 root generation。空字符串表示整仓，不意味着整个仓库自动获准同步。

## 3. 首期存什么，什么是权威

| 内容 | 首期 | 权威来源与消费方式 |
|---|---|---|
| 已晋升正式记忆 | 保留 V1 范围：local + user_project + private + active | 本地记忆版本、head、可见性和期限是权威；召回后回读本地语句。 |
| 用户选中的知识文档 | 新增，限定当前项目知识目录的 tracked Markdown | 当前可安全读取的文件字节、路径及 digest 是内容权威；Git 提供审查与版本管理。知识检索不自动确认内容。 |
| Hindsight 提取的事实、标签实体 | 随上述内容生成 | 可重建的检索数据、模型候选；不作为新的正式记忆或业务关系权威。 |
| 精确业务对象与关系 | 首期只定义小范围模型、提供样例，不自动写正式关系库 | 执行时仍查询 DevFlow 已有业务记录。未来新增确认关系须有稳定 ID、来源与确认流程。 |
| 运行经历、观察归纳、Reflect、Mental Models | 第二阶段 | 新建可追溯 ExperienceRecord / DerivedInsight，不能伪装成既有 coding_run provenance。 |

不默认上传根 `AGENTS.md/CLAUDE.md`、源码、聊天、日志或全部仓库文档。首期仅本地未配对范围；项目改为团队配对时停用此提供方并进入旧投影清理流程，团队共享另行设计。

配对保存涉及的旧、新 localProjectId 都要核对启用资格：在 `saveDesktopPairingCredential` 的 durable 状态更新中持久化提供方停用、授权 generation 变更及必要的清理任务。解除或改绑后恢复本地资格，不自动恢复 opt-in；需要重新显式启用。同一来源的撤销类清理未核实结束，不提交新的 retain。无关项目和仅凭据刷新不应被误停用；未来若增加解除配对入口，必须共用此规则。模型升级的有权限重建与撤销清理用不同 reason 表达，不允许以升级绕过撤销。

bank 由 Electron Main 映射。每个本地用户项目采用独立的知识 bank 与正式记忆 bank，保留 sourceKind；首期无跨 bank 搜索。bank 不是认证授权替代。执行器不能选择 bank、写 retain 或修改模型配置。

## 4. 用 Hindsight 原生能力承载模型

官方当前配置支持 `value`、`multi-values`、`text`、`multi-text`、嵌套 `map`，源码将它们转换为动态 Pydantic 抽取结构。`entities_allow_free_form=false` 可限制为配置标签。`map` 会展开为字段路径标签；不能由标签共现恢复多对象之间的可靠字段绑定或任意业务边。[配置](https://hindsight.vectorize.io/developer/api/memory-banks#entity_labels)、[源码](https://github.com/vectorize-io/hindsight/blob/main/hindsight-api-slim/hindsight_api/engine/retain/entity_labels.py)、[map 说明](https://hindsight.vectorize.io/blog/2026/06/02/entity-labels-automatic-memory-tagging)。

官方 FAQ 将实体关联描述为共享记忆，显式因果边连接记忆；实体图接口中的共现边不能解释为业务关系。[FAQ](https://hindsight.vectorize.io/faq)、[API](https://hindsight.vectorize.io/api-reference)。

拟新增版本化 `KnowledgeModelDefinition`，以项目 Git 中一份声明式 JSON 为定义入口，首期范围限制为业务类型、字段、描述和枚举，以及未来关系的起止类型声明。它不包含脚本、命令、endpoint、凭据或权限规则。宿主做结构/大小/保留字段校验，再生成：

1. Hindsight 的 `entity_labels` 与受控抽取说明；
2. 本地候选对象的结构校验规则；
3. 模型参考文档的数据。博客/网站发布不属于此次接入。

现有 TypeScript 运行时领域类型继续是现有业务的契约。新增模型仅描述知识领域，使用显式映射表引用现有术语，不自动重写 `KnowledgeEntity/Relation`，不同时手工维护两套相同权威定义。LinkML/OWL/SHACL 不是首期依赖，待跨系统生成或复杂约束需求成立后再评估。

最小建模样例采用 system、module、business_rule、decision、term、owner 六类知识概念，先选 2–4 个抽取维度。以下为拟议配置示意，不是已经执行的 API 请求：

```json
{
  "entities_allow_free_form": false,
  "entity_labels": [
    {"key":"sem_kind","type":"multi-values","tag":true,"values":[
      {"value":"system"},{"value":"module"},{"value":"business_rule"},
      {"value":"decision"},{"value":"term"},{"value":"owner"}
    ]},
    {"key":"sem_module","type":"multi-text","description":"原文明确提到的模块名称"},
    {"key":"sem_rule","type":"map","fields":{
      "name":{"type":"text","description":"规则名称，保留原文用词"},
      "statement":{"type":"text","description":"原文中的规则陈述，不推断审批或执行成功"}
    }}
  ]
}
```

`sem_*` 只用于语义检索或展示。来源身份、已确认状态、权限范围、模型版本、过期时间由宿主写入保留的 `df_*` metadata/映射，不允许模型标签覆盖。模型提取的名称不是稳定业务 ID；文本相似和标签相同不等于实体身份已核实。

`sem_rule.name` 和 `sem_rule.statement` 作为独立字段路径评估，禁止按照返回顺序、同一文档或共现把它们拼接为完整规则对象；同样适用于离线候选。若以后需要准确对象绑定，应保留经验证的完整结构及来源，再建立稳定身份。

首期模型自动生成的是分类抽取契约，不提供任意关系写入接口。例如 `TestEvidence --verifies--> BusinessRule` 的正式确认仍须查真实证据和版本。Hindsight 可召回描述该关系的原文，不能单凭模型抽取宣称关系已成立。

## 5. 来源、版本和投影生命周期

拟新增宿主存储契约（命名待实现，不代表已有类型）：

- `ProjectionSourceRef`：sourceKind、localProjectId、ownerUserId、sourceId、sourceRevision、contentDigest、knowledgeRootGeneration（知识）、ontologyVersion、redactionVersion。
- `ProjectionRecord`：sourceRef、providerConfigGeneration、bankId、documentId、payloadDigest、operationId、状态及清理原因。
- `KnowledgeSourceManifest`：选中文档路径、当前字节 digest、扫描状态、最后成功核对时间、模型配置摘要；不能依赖模型回传的路径发现本地文件。

知识 sourceId 使用宿主保存的项目身份、知识根 generation 与当前桌面稳定路径 ID 的组合。路径重命名首期视为删除旧来源、新增来源；不做名称相似度迁移。文档修订绑定完整源字节摘要，远端脱敏载荷另有摘要。模型、脱敏规则或提取配置变化也产生新投影 generation。

源摘要统一为 `sha256:<原始文件字节摘要>`，与 `repository-knowledge.ts` 的 `sha256Digest` 一致；不能混用 snapshot.contentHash、chunk.contentHash 或缺失 contentDigest 时的 `kh-` 回退。载荷来自安全读取的文件，经显式脱敏后同步；不使用 `boundSourceMetadata` 为索引改写过的 front matter。只比较所选来源及模型的摘要，不因 L0 或整份 snapshot.contentHash 变化而重传全部知识。

不可变 documentId 绑定来源及投影版本；operationId 是一次逻辑提交的持久 UUID，重试不换 payload。每个逻辑来源串行处理旧写入、清理和新写入。不得把 documentId 或长期复用 operationId 解释为永不重复计费。

正式记忆的晋升/修订/删除/到期，与独立第三方 outbox 同次 durable mutation 落盘；不能复用会脱敏和合并元数据的 Team outbox。知识文件变化不可能与 SQL.js 原子提交：先安全读取并记录字节快照及来源 manifest，再持久化任务；发送前及结算时检查当前字节、启用范围、配置 generation。期间变化则旧投影不可用并清理，重新生成任务。

worker 用短 durable 操作领取已落盘任务，锁外 HTTP，再短 durable 结算。状态至少覆盖 queued、submitted、ready、retryable_failed、unknown、cancelled、cleanup_pending。响应丢失先对账，不盲目换 UUID。旧任务迟到完成仍要清理。

知识刷新在用户刷新、应用启动及后台有界对账时进行。首次试点上限 20 份选择文档，不改现有全局索引上限。扫描被截断、文件过大、读取失败、服务不可用时，不能用“本次列表里没有”判定源已删除；显式取消选择/切换根或安全精确检查确认缺失，才创建相应撤销记录。来源当前性无法证明时停止该来源远端结果的使用，并显示未核实状态。

精确核验使用宿主 manifest 中的相对路径：先确认项目根仍可访问且 generation 一致，再以独立 argv 执行 `git --literal-pathspecs ls-files -z --cached -- <path>`，要求结果精确包含该路径，并调用复用的安全普通文件读取。仅 Git 命令成功且路径不再 tracked，或根有效时确认目标文件缺失，才按确定的撤销原因处理；命令失败、权限错误、路径不安全等归为不可核实，不假称已删除。当前索引会无 warning 地略过部分排除目录与 ENOENT，因此 `truncated=false` 也不能证明完整，禁止用 snapshot.documents 差集推断删除。

所有来源删除、记忆到期、文档取消选择、配对/配置变化都先阻断本地使用和旧任务发送，远端清理另记状态。关闭搜索不等于删除远端数据；应用离线不保证远端即时清理。清理只能报告已核实的文档、fact 与派生范围，不承诺日志、历史载荷、备份全部抹除。

模型升级首期按新 generation 使用新 bank，完成有界重建和评估后切换宿主指针；旧 bank 不参与新查询并跟踪清理。首期不支持模型热更新后混用不同含义的标签。

## 6. 两条读取路径

### 6.1 知识：新增 knowledge_search，保持 L0/L1

首个真实消费入口限定项目讨论中的只读 `knowledge_search({query, stage?, limit?})`。调用方不传 bank、任意 sourcePath、用户身份或启用范围。宿主从当前项目/Run 得到范围，验证 stage 和输入上限。

保留 `knowledge_list/read` 的用途和既有调用兼容性，L0 项目说明、L1 阶段整篇规范注入、Gate 检查不改。`knowledge_search` 是新增 L2 调查工具；第一批不把它接入阶段 Agent 或 Coding Brief，不修改已保存上下文。实际接线同时覆盖讨论系统提示、`tool()` 分发、MCP bridge 的 fields/schema、Direct/OpenCode 两条执行路径、工具轨迹与名单测试。隐藏但可调用的旧 `knowledge` 工具继续本地词法行为，不改成远端请求。未开启时说明可用的 list/read/repo_search 本地能力。

搜索在同一批当前获准来源上做本地词法候选与 Hindsight 候选。按来源而非 fact 数量去重，以 RRF（初始 k=60、两路等权）合并；与记忆结果分开返回。语义候选不需要再命中原词法门槛。

知识路径也要在提供方适配层隔离超时、服务失败和额度不足：保留核验后的本地结果并标记降级；本地范围或完整性错误不能吞掉。`stage` 沿用现有阶段判断；新的 query 字节上限、limit≤5 与回读参数必须在 Direct 分发和 MCP 参数校验中一致，不能照搬 bridge 当前通用 500 字符/18,000 limit 规则。

远端结果必须经 documentId + 宿主投影记录 + metadata 一致性核验，再从已选来源映射定位文件。通过当前 root、安全路径、tracked 状态和摘要核验后，返回本地原文片段/标题、路径、digest、模型版本、匹配原因及 `readWith=knowledge_read`，并给出宿主来源句柄 sourceRef 与 expectedDigest 作为 readArgs。未知、过时、权限不符来源丢弃，不让远端文本决定本地读取路径。

本地精确来源核验拟抽成小接口，复用 `repository-knowledge.ts` 的安全读取。来源核验与响应组装使用同一次读取的字节，并记录摘要。`knowledge_read` 为此新增兼容的可选 sourceRef/expectedDigest 分支：先核对句柄所属当前项目、用户、root generation 及选中状态，再精确读取；如果同时提供 path，必须与宿主映射相等。即使全局扫描未列出该文件，也可在该已选来源的有界契约内回读。摘要改变返回 source_changed 与当前摘要，要求重查，不返回匹配旧引用的正文；无法核实就返回明确错误。未传新参数的原 list/read 用法保持兼容，不扩大到任意仓库路径。根说明文件不走该新分支。

抽取 fact 文本、map 字段和共现边可以用于内部检索调试，首期工具给 Agent 的知识正文来自核验过的原文。结构化候选的检验在离线评估中记录，不能因候选通过结构校验就晋升为已确认知识。

### 6.2 正式记忆：保留 V1 修订后的契约

继续在 `recallScopedMemory` 内接可选候选。新增精确 memoryId 集合的 scoped hydration，并让召回、`assertCodingContextCurrent` 共用权限和生命周期谓词。`user_project` 比较用户和项目范围，不要求源 sessionId/runtimeId 等于当前运行；`runtime` 才要求运行与会话。执行回执 scope 的精确比较继续保留，两者不是同一种校验。

保留 head/revision/digest/TTL 检查及当前消费方预算。先算出有效本地结果；仅提供方故障、超时或额度不足触发本地兜底，本地权限/完整性错误仍报错。对返回窗口外的合法记忆使用相同安全路径核验，不直接 getHead。

融合发生在预算选择之前；同来源多条 fact 只取最好名次。省略计数按本次有效唯一候选并集计算，另外记录无关、过期、无来源等原因；不把计数当语义收益。自动进入三个原有消费方前先进行影子评估。

## 7. 运行配置与成本

Electron Main 持有 HTTP 客户端、密钥安全存储、bank 映射、模型配置和任务；不在 Native/OpenCode 安装可写 Hindsight MCP。先接单独服务，按项目 opt-in；本机服务若调用远程模型，数据仍会发给模型提供方。

首期两个专用 bank 明确配置 `enable_observations=false` 与 `enable_auto_consolidation=false`，不调用 Reflect、Mental Models 或 Knowledge Pages。前者按当前文档阻止自动及手动 consolidation，不能只用后者声称所有归纳都已停用。[配置说明](https://hindsight.vectorize.io/developer/api/memory-banks#enable_observations)

知识抽取候选模式优先评估 concise + labels；若原文保真更重要，可对照 verbatim + labels。chunks 作为免 LLM 抽取的基线，不期待它自动执行 labels 抽取。最后使用的模式由同语料实验决定，未测前保持影子模式。

试点初始工程限额（提案值，不是产品指标）：query 最多 2 KiB；knowledge_search 最多返回 5 个来源、正文合计 6 KiB；提供方 recall deadline 2 秒；每个讨论回合最多 2 次远端知识搜索，重复查询复用候选缓存但每次重核来源；后台 retain 并发 1、总提交尝试最多 3 次，未知结果先对账。这些上限纳入工具契约，实测不足时改配置再评估，不能悄悄放宽。

正式记忆沿用当前编码/阶段/讨论正文预算；远端召回设置独立次数、输入量和累计调用上限。retain、embedding、reranker、生成和维护任务分别计量；软估算不充当硬金额上限。真实调用前指定模型、测试项目和预算，硬金额约束由可核验的服务网关/提供方执行；本轮只使用 Cursor 咨询，不启动 Hindsight 付费试点。

查询是独立出境数据，不默认携带完整编码简报或批准产物；先裁剪、脱敏、限长。worker 任务的持久载荷也经过同一版脱敏，源摘要与投影摘要分开记录。

## 8. 实施切片与停止条件

1. **协议与宿主基础**：固定 Hindsight 服务/SDK 版本或镜像 digest；实现最小 client、配置、投影存储/outbox 和假服务协议测试。先不开放真实上传。
2. **知识试点**：选中 20 份以内文档，接 model → labels 配置和讨论 knowledge_search；保留 current list/read 流程。验收当前性、撤销、范围隔离及查询预算。
3. **正式记忆增强**：完成 scoped hydration 与旧问题回归，再接现有三入口影子评估，通过后按项目开启。
4. **经历与归纳**：独立后续方案。完整关系库、团队共享、本体推理和博客发布不混入前三步。

同一个模型只生成语义范围内的抽取配置；执行权限由宿主领域模型管理。完整“模型 → 知识 → 应用 → 发布”是演进方向，第一批不宣称已经全部实现。

验收分三类：

- **本地确定性正确性**：outbox 持久化失败/重启恢复；到期/可见性收紧；跨会话 user_project；知识 rename/删除/取消选择/root 切换；缓存过期、读取失败及截断扫描；旧任务迟到；提供方失败；标签不能伪造来源与批准；多对象 map 不被误拼成正式关系。对构造用例要求零越权、零过期正文注入。
- **锁版本协议实测**：metadata/documentId 回传、异步状态、重试幂等、同 ID 不同 payload、取消时机、删除关联 fact、标签/抽取模式兼容、禁止 observations 的实际效果。保留请求/响应的必要脱敏片段，不能用文档或假服务结果代替。
- **价值评估**：固定约 30 个问题，覆盖中文同义表达、概念、跨文档证据、无答案和版本变化。比较“现有 list/read + repo_search 调查流程”“同授权语料的本地词法检索”“同语料融合 Hindsight”；分别计检索 top-5 命中、原文引用正确性、候选抽取正确性、任务回答、p50/p95 延迟与总成本。记忆额外区分修复原 256 条返回窗口的收益和语义增益。

进入真实小试点前记录样本、预期来源和费用上限；试点只接受能回查来源、无过期/越权泄漏且在预设延迟/费用内的结果。若融合没有增量相关命中，先停扩大同步并分析，不用论文分数代替本地收益，也不由短记忆无收益推断所有知识或经历都无价值。

## 9. 给 Cursor 的增量复审范围

请复核 V1 三个已修改的缺口是否在真实调用点上闭合；再检查本版新知识路径、模型边界、工作树字节/缓存当前性、范围变化、数据出境 ADR 例外、两类来源生命周期和最小交付范围。

重点区分：设计缺口、可以开始实现但真实启用前必须验证的协议条件、非阻塞建议。明确哪些地方利用了 Hindsight 原生能力，哪些是 DevFlow 适配，哪些尚未核验。不要因计划尚未实现或缺少真实部署而一律判设计失败；不要把此前未重抓的官方能力当已实测。

只读阅读范围：本方案、首轮方案/评审、上述相关源码与测试、ADR/CONTEXT、官方 Hindsight 公共页面。不得读取 `.env`、凭据、用户数据库、用户会话或无关个人文件；不得安装/运行服务/修改代码/扩大权限。权限拒绝就记录；不要尝试绕过。

输出中文：结论、按重要性排列的具体问题及代码依据、各问题需要的修改或协议验收条件、最小实施顺序。附技能规定的 Machine Verdict。

## 10. 外部证据与限制

复审时，以上 Hindsight 能力按 2026-10-20 公开文档与主分支源码核验，尚未固定部署版本；实施阶段已在 ADR 0027 固定 `v1.0.0` 的契约提交，真实部署验证仍待完成。重新读取发现 [Operations](https://hindsight.vectorize.io/developer/api/operations#cancel-an-operation) 同页正文与示例注释不一致：正文允许 pending/processing 的协作式取消，示例注释却称 processing 返回 409。不能用其中一段替代锁版本证据；首轮的迟到写入防护继续保留，cancelled 不充当 worker 已停止或清理完成的证明。上一版 V2 只引用示例注释的表述在此纠正。

其他协议参考：[Retain](https://hindsight.vectorize.io/developer/api/retain)、[Recall](https://hindsight.vectorize.io/developer/api/recall)、[Documents](https://hindsight.vectorize.io/developer/api/documents)。文档说明 metadata 为字符串值且参与抽取提示，documentId 关联文档；范围过滤和来源确认仍由宿主执行。此处不提供未经执行的成功回执。
