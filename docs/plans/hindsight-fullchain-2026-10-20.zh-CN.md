# Hindsight 全阶段知识接入与 Todo 验证

日期：2026-10-20。状态：已完成 Cursor 文字顾问评审、全阶段接入、完整回归与构建，以及真实 Todo 到 PR 知识评审的开发验证。PR 业务评审仍提示证据缺口，没有远端发布或真实交付验收；验收接入另有公共运行时测试。首轮 30 题检索对比未证明混合检索提升。意见采纳/拒绝依据见[处置记录](../research/hindsight-fullchain-review-2026-10-20/disposition.md)；以下是设计范围，实际测试结论以[验证记录](../validation/hindsight-fullchain-validation-20261020.md)为准。

## 用户范围与已有基础

用户已明确选择全链路接入，要求与 Cursor 讨论后由 Codex 独立判断、开发和完整测试，不再征询实施取舍。Cursor 仅提供参考，不控制实施或批准。范围从 V2 的讨论知识搜索扩展到需求澄清、需求评审、设计与修订、设计评审、编码、测试分析/修复、交付和验收相关 Agent。原有手动审批与真实测试命令的权威保持不变；执行 shell 测试本身不需要调用知识模型。

方案制定时已有：真实 Hindsight 1.0.0 独立服务、选定 Git Markdown、声明式 model.json、当前原文核验、持久 outbox、版本撤销与清理、讨论 Direct/OpenCode knowledge_search、本地回退、正式记忆影子召回。彼时真实合成抽取/更新/清理已验证，英文查询中文排序有问题，尚未运行真实 Electron + Hindsight + 开发模型全流程。此后已进行多轮真实尝试；各轮失败、修复和验证边界单独留证，不把尝试等同于完整流程通过。

测试沿用原 Todo 工程的固定 Git 快照，增加隔离测试知识，避免更改用户原工程。其当前模型为 id/text/done/createdAt，不存在完成日期和多列表。首个任务为清除已完成任务，保持未完成任务全部字段和顺序、既有存储键与零依赖约束。验收答案和脚本不进入知识目录。

## 已实施架构

1. 新增宿主统一知识上下文服务：按真实项目、用户、Run、节点和阶段，取有限查询，调用 HindsightService.search；独立于 renderer 输入与 executor 权限。最终实现每动作一次召回，query 2 KiB、最多五份来源、原文片段合计 6 KiB、实际渲染段最多 8 KiB，复用来源身份校验。
2. shared 层增加 typed retrievedKnowledge 包与纯渲染器，保留既有 resident L0/L1。Direct、OpenCode、Native 共用同一来源检索与核验契约；各执行器的提示包装和总预算可能造成不同裁剪，实际保留来源以各自 receipt 为准。不会给 executor Hindsight 凭据或可写 MCP。补充知识不能批准 Gate、授权命令或声称测试通过。
3. manifest/receipt 记录 stage、查询摘要、来源句柄、完整文件 digest、model/config generation、匹配方式、降级情况和实际注入字节。正文只来自宿主读取的当前文档，不采用远端事实正文。模型输出不能伪造 receipt。
4. 模型调用前核验所用来源；模型完成到保存之间再核验。来源修订、撤销、用户/项目或配置变化使本次旧上下文失效，不能吞掉为普通 provider 降级。编码重试与恢复重读文件核验既有引用，不在旧运行中重新召回并替换简报；引用失效时需启动新运行准备上下文。
5. 服务超时/不可用时保留当前本地规范及可用词法结果，记录 degraded。取消传播，不能因 optional 知识服务不可用使整条工作流不可用。知识本地范围/完整性错误不能当成网络故障。
6. 提示预算包括检索文本；优先保留现有 Gate 规范和用户请求。编码为知识补充尽力预留最多 4 KiB，压缩可选叙述而保留完整已批准工件、Memory、当前请求与明确约束；必保内容可占用预留。知识补充可以有界裁减，但 receipt 必须仅列真正送入模型的内容，不能掩盖 compaction 丢弃。
7. Main 的 executeStageAgent、coding prepare/analyze/start/resume/repair、knowledge review（包括 PR/accept/test）统一接线；现有 Agent 只支持 clarify/design，其他阶段走现有评审/编码路径，不新增假装存在的阶段执行器。测试命令继续由现有受控执行器产生证据。

## 必须解决的当前运行约束

V2 Hindsight 只支持未配对本地项目，但正式阶段/编码通常通过配对 Team 的 policy/budget 执行。实现已核对并保留这些治理路径。

最终采用最小扩展：允许配对项目由当前配对用户重新显式启用“本机私有知识投影”，绑定 organization/project/localProject/user/authAccount 身份，仍非团队共享。旧本地配置在配对/身份变化后撤销；新配置须明确授权；token 轮换不误伤相同身份。配对项目不开放正式记忆投影。宿主仍执行现有提供方与金额策略；仓库没有独立的组织级知识外发政策字段，本次不虚构或绕过该能力。

PR 交付包继续由确定性代码组装受信任的差异、测试和评审证据，不增加不必要的模型调用；PR/验收的知识入口是相应评审。未进行远端交付的测试不能声称通过真实验收节点。

## 验证接口与顺序

测试用户可见的公共接口，不测试私有实现细节：

- 共享提示构造：六阶段的补充原文、有效引用、预算/降级清单。
- 宿主服务：真实 Git/SQLite + 受控外部 HTTP，来源变化/撤销/身份变化、网络降级、取消、同一轮查询预算。
- 正式运行接口：stage generation、review runtime、coding prepare/start/resume/repair；provider/执行器收到正确上下文；执行过程中变更来源不保存成功产物，费用记录仍结算。
- Electron：通过真实 preload/IPC 操作上述接口，隔离数据目录、独立 Todo Git 项目；全链路不靠测试专用 bypass。
- Todo 行为：真实 node --test 与浏览器，断言清除已完成、不误删、刷新持久化与无存储时降级。
- 固定约 30 题：现有调查流程、本地词法、Hindsight 混合的相同授权语料，分别记录 top1/top5、无答案误召回、原文引用、时延和成本。回答质量与纯检索分开。
- 真实服务/真实模型验证单独留证；沿用用户指定 DeepSeek 和原人民币 5 元总上限，旧账本保持关闭，新的隔离测试账本额度计入累计上限，不重置旧账本。若能力受环境阻断，记录实际失败并完成其余验证，不能伪造全通过。
- 适用全量 verify/build/E2E/Electron smoke；不修改其他设计修订工作。提交/发布不是本次默认结果。

第五轮真实实验在 Coding prepare 遇到既有必保输入的 24,000 字节上限；不含 Hindsight 补充的基线同样失败，已确认必保内容及约束合计 24,700 字节。第六轮只在合成测试请求中要求需求与设计各约 1,000 汉字、减少重复说明，同时保留全部业务约束、审批与预算；不截断已批准产物，不提高模型上下文上限。第六轮实际知识注入成功，但模型提案超过六文件上限而被拒绝；第七轮明确六文件约束，初次差异经独立审阅拒绝后，由正式编码入口生成修正提案并批准，23 项真实项目测试和 16 项浏览器检查通过。完整过程与后续交付评审结果另见验证记录。

## Cursor 只读评审边界

允许本文件、V2 方案、ADR 0024/0025/0027、CONTEXT.md，以及下面源码/测试：

- apps/desktop/electron/{main,hindsight-service,hindsight-store,hindsight-client,repository-knowledge*,coding-context,coding-runtime,knowledge-review-runtime,runtime-budget-guard,stage-agent-executor,governed-stage-agent,local-store,model-call*,workflow-runtime}.ts
- packages/shared/src/{domain,knowledge-context,workflow-agent,agent-review,coding-brief,execution-context,governed-provider,budget*,policy*}.ts
- 上述对应测试、scripts/stage-agent-design-electron.mts、scripts/hindsight-*.m*

不得读取 .env、密钥、用户数据库、用户会话或无关目录；不得修改任何文件、运行模型或写入性命令。仅检查所需源码。反馈采用中文，指出具体入口缺口、身份/政策绑定、实际注入与恢复策略、测试覆盖是否足够。给出最小可实施建议，不因计划以前限定讨论而拒绝用户现在明确扩大范围。建议由 Codex 独立采纳、拒绝或延期。
