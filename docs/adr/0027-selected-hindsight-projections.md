# ADR 0027：由桌面宿主管理选定来源的 Hindsight 投影

日期：2026-10-20。状态：已实现首期投影及同日全链路接线修订；网络试点默认关闭。固定版本协议、合成数据宿主链路，以及真实 Electron 到 PR 知识评审的开发验证已完成。未发布远端 PR、未完成真实交付验收；检索价值验收未达标，不能据此宣称全功能验收完成。

## 决定与范围

Electron Main 通过 HTTP 直接接入独立 Hindsight。版本基线为 [v1.0.0 对应的 OpenAPI](https://github.com/vectorize-io/hindsight/blob/39c65ffe2f140d0c84cee58566cad8900c5b9908/hindsight-docs/static/openapi.json)，不增加 SDK、OpenViking 或执行器可写 MCP。API 密钥使用现有系统凭据加密，渲染端只能保存输入、读取不含密钥的状态。

这是 ADR 0011 / 0025 的**显式选择例外**：知识来源限于当前宿主用户选择的、实际知识目录内 Git tracked Markdown。未配对本地项目还可明确启用 `local + user_project + private + active` 正式记忆投影；已配对项目须另行同意本机私有知识投影，并强制 `includeMemories=false`。默认不选择任何来源，不自动上传根说明、源码、会话或日志。原 Markdown、记忆修订与业务证据仍是权威。Team outbox 与第三方 outbox 独立。

项目设置中明确告知文档和脱敏查询的流向，以及核验后的摘录会进入阶段模型上下文。本机服务也可能使用远程抽取、Embedding 和 reranker；网络试点前必须落实这些提供方、模型、测试范围和费用上限。`DEVFLOW_HINDSIGHT_PROTOCOL_VERIFIED=<固定提交 SHA>` 是部署者在完成协议验证后设置的显式闸门，不是程序自动签发的验证证明。此前的[DeepSeek 合成验证](../validation/hindsight-deepseek-validation-20261020.md)在单独授权和费用上限内完成，不构成其他项目、业务资料或后续计费调用的授权。

## 组成

- `hindsight-client.ts`：有界 HTTP、版本检查、bank 配置、异步 retain、operation 对账、recall 来源、文档删除。响应不直接变成 Agent 正文、文件路径或批准。
- `hindsight-store.ts` 与 LocalStore schema 39：按项目/用户/配置 generation 保存独立 bank、加密凭据、所选来源及不可变投影任务。旧配置保留清理所需的信息；新版本不复用逻辑提交 UUID。
- `hindsight-service.ts`：精确读取、同步调度、RRF 来源融合、回读摘要验证；所有 HTTP 在 SQL.js durable mutation 之外。
- `knowledge_search`：讨论中的 Direct / OpenCode 两入口共用宿主回合预算；`knowledge_read` 可使用宿主来源句柄与摘要。L0 / L1 / Gate 逻辑、旧隐藏 `knowledge` 词法工具保持原契约。
- `hindsight-context.ts` 与共享 `knowledge-retrieval-context.ts`：每次宿主动作准备一次检索上下文，统一裁剪、渲染和记录实际使用的来源；由宿主核验后交给 Stage、Review 和 Coding 入口，执行器不获得 Hindsight 凭据或额外访问权限。
- `hydrateAgentMemoryRevisions`：与普通召回共享 SQL 范围及过期谓词，按 ID 回读不受普通 256 条返回窗口影响。`user_project` 不比较历史会话，`runtime` 仍比较会话与运行。Coding 回执验证使用该接口。

正式记忆语义召回仍以影子模式接入三个既有入口；正式记忆的自动语义注入暂不开放。这与本次开启的知识文档摘录注入是两条路径。宿主返回记忆诊断候选数供测试/后续评估，提供方故障保留本地检索结果，本地完整性错误不在提供方降级中吞掉。

## 2026-10-20 全链路修订

首期只支持未配对项目，并通过讨论工具使用知识；当时未向所有执行入口注入摘录。本次保留投影队列、原文权威和正式记忆影子模式，扩展为覆盖 `clarify / design / build / test / pr / accept` 六阶段的宿主知识上下文。覆盖按现有执行能力接入，不新增六套 Stage Agent，也不改变节点准入条件：

| 执行入口 | 当前接入方式 |
|---|---|
| 需求澄清、设计生成和设计修订 | `runWorkflowStageAgent` 在 Direct / OpenCode 的实际请求中加入核验后的摘录。Stage 生成器仍只支持 `clarify / design`，设计修订保留完整旧设计和原有输入。 |
| 六阶段 Review | `createKnowledgeReviewRuntime` 按节点阶段检索并注入 Review 上下文。继续只接受合法 Gate、PR 或 acceptance 节点；build/test 的 Gate 可评审，默认 build task 和 test 命令节点不会因此变成 Review。 |
| 开发与修复 | Coding Run 在准备 Brief 时检索，摘录和实际来源回执进入持久 Brief；Native / OpenCode、分析和修复复用同一份上下文，并在执行边界检查当前性。 |
| 正式测试命令 | 执行前准备 test 阶段来源并核验，执行后再次核验；`TestEvidence.knowledgeContext.retrievedKnowledge` 只记录本次来源，不新增模型调用，不据此改写命令或宣称用例覆盖了知识规则。测试结论仍来自实际命令、退出码和输出。 |
| PR 与验收 | 对应的 Review 使用阶段知识；现有发布、审批和验收前置条件保持不变，知识不能代替这些条件。 |

配对项目的 opt-in 仅授权当前用户在本机使用所选知识。宿主保存 `organizationId / projectId / localProjectId / userId / authAccountId` 五项身份绑定，校验凭据有效期，并要求 `includeMemories=false`；旧配置不能自动继承此次授权。绑定变化后停用并清理，需要重新明确启用。这不是团队共享知识库或组织级访问策略。

Stage 产物 provenance、Review context manifest 和 Coding context receipt 统一使用 `knowledgeContext.retrievedKnowledge`，记录阶段、项目/用户范围、查询摘要、配置 generation、模型版本，以及实际保留来源的路径、摘要、匹配原因和字节数；不把未发送的来源记为已使用。正式测试的同名字段表示来源记录，不表示存在模型提示。恢复已有 Coding Run 时沿用其持久上下文；失效时要求重新运行，不静默替换原上下文。

私有来源引用不随团队摘要同步：Review 同步显式剥离 `knowledgeContext.retrievedKnowledge`；Stage provenance、Coding Brief/receipt 和测试来源回执不进入现有团队摘要字段白名单。本地回执仍保留用于核验。该边界针对新增上下文与来源元数据，不保证模型生成的业务产物不会引用知识内容。

## 建模

项目知识目录下 `model.json` 是唯一声明入口，需 Git 跟踪。模型大小、维度、枚举、嵌套与字段均有界，只接收语义抽取定义。`sem_*` 标签与宿主生成的 `df_*` 元数据分开；模型文件不能配置 endpoint、凭据、脚本或权限。

支持 value、multi-values、text、multi-text、map。map 字段和共现不被拼成已确认关系。这些声明用于抽取和检索，不构成拥有稳定对象 ID、关系约束、推理、审批和动作权限的完整本体平台；执行权限及领域对象仍由现有 TypeScript 业务记录控制。模型变化停止旧 generation，需重新保存配置后重建；保留安全停用后重建的选择，切换期间提供本地调查工具，不实现双 bank 无缝切换。

## 当前性与撤销

来源核验独立于有界索引：literal Git pathspec 精确检查 tracked 状态，再用既有防符号链接、普通文件和读取大小检查读取原始字节，使用完整 SHA-256。源摘要与脱敏载荷摘要分开。无法核实不等于已删除。

Hindsight 返回的候选只用于定位来源。真正进入模型的正文来自重新读取的当前本地文件，标为不可信调查材料，不能覆盖请求、已批准输入、必需 Gate 规范或执行权限。宿主在准备上下文后、实际模型发送前和结果保存前核验配置、绑定、模型及实际保留来源的摘要和阶段适用性；OpenCode 代理对每轮模型请求也执行前后核验。Coding 在相关模型、写入、测试及结果接纳边界复核。源变化、撤销或身份失效会拒绝后续执行或保存；已发生的模型用量仍结算，不因结果被拒绝而抹去费用。

晋升、修订、删除、到期和相应投影任务共同 durable 落盘；配对/改绑影响的旧新项目停用并安排清理，无关项目或仅 token 刷新不误停用。重新成为本地项目不自动恢复启用。

HTTP 前持久领取任务，使用同一 operation UUID 对账；最多三次提交，未知结果不生成新 UUID。已撤销任务的迟到成功只能进入清理状态。同一来源有未完成撤销清理时不提交新 retain；其他来源仍可处理。未发出过请求的旧快照可以安全取消。

清理等待 operation 确认结束后删除对应文档；`cancelled`、未知结果或 `not_found` 不被当成旧 worker 已停止的证明，因此可能保留 `cleanup_pending`，需要锁版本实测/运维核对。关闭网络或应用离线不会即时清理远端。删除文档不等于擦除日志、备份或历史载荷。

## 限额与后续验收

选择不超过 20 篇；搜索 query 最多 2 KiB、5 个来源、6 KiB 正文。阶段注入每篇摘录最多 2 KiB，渲染后的整个检索段最多 8 KiB，包含提示边界、引用字段和 JSON 转义开销；正文达到 6 KiB 不代表一定能全部装入。每讨论回合最多两次远端搜索，每次阶段宿主动作准备一次检索，缓存候选每次仍重新读源。召回截止 5 秒、其他 HTTP 请求 2 秒，响应最多 512 KiB；真实评审查询在本地 CPU 上测得约 2.9 秒，因此召回单独设定截止时间。后台串行，每 15 秒有界处理。正式记忆另有每进程每运行两次影子查询额度（最多保留 256 个运行计数，满后停止新增），现有正文预算保持。

检索段有独立上限，同时计入执行器总预算。Stage 检查组装后的 prompt 和序列化执行输入，Review 检查实际提示（包括 OpenCode 的本地代理包装），以 96 KiB 和 48,000 估算 token 等上限决定是否保留检索段；超限先移除新检索段，保留原有必需输入及原 Memory 处理策略。Coding 保持既有 Brief 总上限，尽力为检索预留最多 4 KiB，优先压缩可选叙述；完整已批准工件、Memory、当前请求和明确约束可占用该预留，不能为了检索而删掉。各入口的 manifest 随最终保留内容更新，不能通过只限制原文、漏算包装或记录裁掉的来源来绕过预算。

以上是调用/字节限额，不是硬金额预算；服务端模型费用仍需提供方或网关控制。两个 bank 配置关闭 observations 和自动 consolidation；不调用 Reflect、Mental Models 或 Knowledge Pages。

固定版本协议、真实抽取、宿主持久投影、原文变化和清理已有[合成数据实测](../validation/hindsight-deepseek-validation-20261020.md)，其中也发现了跨语言排序问题。当前接线另有受控提供方的六阶段 Review 入口测试，检查实际模型上下文和来源回执。真实 Todo 已验证 Direct 阶段/评审、Native 校正编码、23 项项目测试、16 项浏览器检查和 PR 知识评审；PR 业务结论仍提示交付证据缺口，提前访问 Acceptance 被正确阻断，未做真实远端交付验收。[首轮 30 题检索对比](../validation/hindsight-fullchain-validation-20261020.md#30-题检索结果)未证明混合检索优于词法；原调查工具基线与生成回答质量尚未评测，检索价值验收未达标。不能把受控提供方、单元测试或上游基准当作真实服务成功和产品收益。用法及分阶段验证记录见 [接入说明](../engineering/hindsight-integration.md)。
