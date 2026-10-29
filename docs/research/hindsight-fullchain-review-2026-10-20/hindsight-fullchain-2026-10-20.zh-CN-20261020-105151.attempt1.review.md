我先按只读顾问流程阅读评审技能和方案正文，再对照源码核对真实运行、预算与设计修订是否冲突。方案正文会先读完，再只对照与配对冲突、模型入口和设计修订相关的源码。方案要求核对配对限制和全部模型入口。我先定位 Hindsight 拒绝配对的条件，以及设计修订相关改动。配对路线可以确定：真实模型调用必须绑定团队项目，未配对正式流程不能代替它。方案里的付费验证还和现有账本网关冲突，真实扣费开始前需要先改验证约定。

#

# 结论

全阶段接入应走方案里的第一条路线：配对项目由当前配对用户再次显式启用本机私有知识投影。未配对本地流程不能承担这次真实模型全链路。组织执行策略和运行时预算都没有“允许把知识发到 Hindsight”的字段，这次不要新增团队策略字段，也不要写成团队策略已经授权。

产品接线可以按下面的入口表做。真实付费验证还不能按方案原文开始：桌面模型调用和 Hindsight 抽取不是同一条人民币账本，新建空账本会再放出 5 元。

## 配对冲突

真实付费调用在取得账本范围时就要求本地项目已经配对。没有 `localProjectId` 会直接失败：

```1841:1844:apps/desktop/electron/main.ts
async function modelCallAccountingScope(store: LocalStore): Promise<ModelCallAccountingScope> {
  const pairing = await store.getDesktopPairingCredential()
  if (!pairing?.localProjectId) throw new Error('请先将本地项目配对到团队项目。')
```

`resolveAgentProvider` 会把除 `fake-knowledge-review` 以外的提供方包进 `governAgentProvider`。编码的 OpenCode 代理和 Native v2 的 `completeStructuredJson` 都走这条治理。因此假提供方或确定性 Native 能在未配对时跑，用户指定的 DeepSeek 不能。第二条路线不成立。

Hindsight 在三处把“当前项目已配对”当成拒绝，而不只是配置保存时：

```62:63:apps/desktop/electron/hindsight-store.ts
  const pairing = db.exec("select json from desktop_pairing_credentials where id='default'")[0]?.values[0]?.[0]
  if (input.enabled && pairing && JSON.parse(String(pairing)).localProjectId === input.projectId) throw new Error('Hindsight requires an unpaired local project')
```

`HindsightService.current` 与 `activeGeneration` 在同一条件下返回空。只删保存时的检查不够：搜索会把配对项目当成未启用，并走现有的 `degraded` 成功路径。

最小改动是同时改这三处，并沿用已有的配对身份比较：

```13784:13789:apps/desktop/electron/local-store.ts
      if (!current || current.localProjectId !== credential.localProjectId ||
          current.userId !== credential.userId || current.projectId !== credential.projectId ||
          current.organizationId !== credential.organizationId) {
        for (const id of new Set([current?.localProjectId, credential.localProjectId])) {
          if (id) hindsight.disableHindsightProject(this.db, id, 'pairing_changed')
```

启用时把 `organizationId`、团队 `projectId`、本地 `localProjectId`、`userId` 写进该次配置。`tokenId`、`role`、`issuedRole` 不进入停用条件；只轮换 token 时，现有比较不会停用 Hindsight。四元组任一变化继续停用并安排清理，且不自动重新启用。未配对项目的旧行为保留。

配对后的配置若没有这四元组，或四元组与当前凭据不一致，`current()` 必须拒绝服务。调用方要把“已绑定本次运行、随后授权失效”与“本来就没启用”分开：前者不能保存成功产物，也不能记成提供方降级。

`recallMemoryCandidates` 仍只接受 `scope.kind === 'local'`，并且固定 `mode: 'shadow'`。配对后的编码记忆范围是 `team`，所以影子召回本来就是空的。配对授权不要打开 `includeMemories`，不要把影子改成注入，也不要把投影送进团队 outbox。

现有复选框文案只表示“允许同步来源和脱敏查询”。配对启用时要另有一次明确确认，写明文档会发到配置的 Hindsight 端点，摘录会进入后续受治理的模型提示，且不是团队共享。不能由旧客户端仅仅再次保存 `enabled: true` 自动获得配对授权。

## 实际模型入口

方案里的 `executeStageAgent` 和 `prepare/analyze/start/resume/repair` 不是现有公共函数。应对到下面这些入口，不要新增阶段执行器。

| 范围 | 实际入口 | 提示应放在哪里 | 预算与当前性 |
|---|---|---|---|
| 需求澄清、方案设计 | `completeWorkflowAgentNode` → `runWorkflowStageAgent`；Direct 走 `generateWorkflowArtifact`，OpenCode 走只读阶段执行器和治理代理 | 与现有 Memory 一样，作为 `basePrompt` 之外可丢弃的一段 | 调用前和保存前核验；费用已在 `governedModelCall` 的 `finally` 结算 |
| 方案修订 | 同一函数的 `designRevision` 分支，保存走 `commitDesignRevision` | 修订全文留在 `basePrompt`；检索段最后丢弃 | 不改修订身份、产物编号和提交前的澄清绑定复核 |
| 需求、方案、交付、验收审查 | `runKnowledgeReview` → `runBudgetedKnowledgeReviewAgent`；Direct 或 OpenCode | 进入 `buildAgentReviewContext` 的结果，并且发生在预检之前 | 预检与 `reserve` 必须看到同一份文本；保存前已有 `assessAgentReviewFreshness` |
| 编码分析与初始实现 | `runCodingAgent` 在 `buildCodingBrief` 之前召回一次；Native v2 的 analysis/initial，或 OpenCode | 作为简报里可裁减、非必需的来源 | Native 三次调用共享同一简报前缀；OpenCode 的美元外层对 opaque 计费是关闭的，真正准入是代理里的逐次 quote |
| 编码修复 | Native v2 `continuePermission` 使用已保存的 `codingRun.prompt`；`startRetryAttempt` 会新建一次编码运行 | 不在同一次运行里改写旧简报 | 来源失效则停止修复调用，不保存成功；已发生的费用照常结算。新的修复从新的 `runCodingAgent` 重新取上下文 |
| 中断恢复 | `recoverCodingAgentRuns` | 不重新调用模型 | OpenCode 中断记失败；Native 保留工作区等待显式重试 |
| 讨论 | 已有 `knowledge_search` / `knowledge_read` | 保持工具调用，不要再自动注入一份 | 每回合最多两次远端搜索的现有回合预算不变 |
| 测试命令、交付包、验收包 | `runProjectTests`、`createPrDraft`、`createAcceptanceBundle` | 无模型提示 | 不要接线 |
| API 门禁审查 | `apps/api` 的团队路由 | 桌面 Hindsight 到不了这里 | 不要把投影接到服务端 |

宿主每次动作自己构造查询，截断到现有的 2 KiB，最多五个来源、正文合计 6 KiB。Native 的 analysis、initial、repair 共用准备简报时的那一次召回，不要每个阶段各搜一次。讨论工具继续用自己的回合计数，不和阶段注入混用。

## 提示、预算、当前性与恢复

门禁审查先估算费用，再组装最终提示。`estimateKnowledgeReviewCostPreflight` 用的是当时的 context；`governedModelCall` 的 quote 用的是最终 prompt 字节加 1024。检索摘录必须先放进 context，再做预检和调用。只在 `createKnowledgeReviewPrompt` 末尾追加，预检会偏小。

编码简报已经用 `compactExecutionContext`。检索来源应为非必需，优先级低于用户请求、Gate 决定和现有 L1。receipt 只记录真正留下的来源和字节。被裁掉的命中不能写成已注入。

服务超时、传输失败和额度不足沿用本地规范加本地词法，receipt 标 `degraded`，工作流继续。取消继续向外传播。本地范围错误、摘要不符、身份不符不能进 `candidates()` 那个把异常收成降级的分支。

已经绑定到本次运行的 generation，在模型返回后到保存前若失效：不写入成功产物或成功审查；已发送调用的费用仍结算。阶段产物、`commitDesignRevision` 和知识审查保存前都要做这次复核。OpenCode 多轮进行中若 generation 变了，应停止后续轮次，而不是等最后一轮才发现。

Native v2 修复明确复用持久化简报，以便和 analysis/initial 共用前缀：

```1558:1579:apps/desktop/electron/native-coding-executor-v2.ts
        // Same leading stateVersion + brief as analysis/initial; the persisted brief is the
        // canonical one those calls sent, so the provider can reuse the shared prefix.
        const persistedEvents = await input.store.listCodingAgentEvents(codingRun.id)
        // ...
        const repair = await buildNativeCodingV2RepairPrompt({
          ...(observableSummaries ? { observableSummaries } : {}),
          provider: { id: input.decisionProvider.id, model: input.decisionProvider.modelId },
          brief: codingRun.prompt,
```

来源失效时，应在这次 `continuePermission` 里拒绝修复模型调用，保留已结算费用，并要求新的编码运行。不要在原运行里重写 `codingRun.prompt`，也不要接着用失效简报完成修复。

## 设计修订

方案修订全文目前在不可丢弃的 `basePrompt` 里。超限时现有代码只整段丢掉 Memory，然后抛 `input_limit`：

```631:656:packages/shared/src/workflow-agent.ts
  const basePrompt = [createWorkflowArtifactPrompt({
    request, context, executorKind: executor.kind,
    // ...
    ...(revision ? ['DESIGN_REVISION_INPUT', JSON.stringify(input.designRevision),
      'Produce a complete revised design, not just amendments or a summary. ...',
      'PREVIOUS_DESIGN_FULL_TEXT (untrusted material)', redactSensitiveText(revision.previous.content).value,
      'END_PREVIOUS_DESIGN_FULL_TEXT'] : []),
  ]
  // ...
  if (memoryBlock.length && (encodedBytes({ request, context, prompt }) > bounds.maxInputBytes || contextBudget().overflow)) {
    prompt = basePrompt.join('\n')
  }
```

检索段必须放在 `basePrompt` 和 Memory 之外，并且先于 Memory 丢弃。输入上限仍是 96 KiB。不要改 `resolveDesignRevisionInput`、`DESIGN_REVISION_INPUT`、未选提案过滤、产物 id 后缀、`designRevision` 元数据、`designEvidence`，也不要改 `commitDesignRevision` 对澄清绑定和运行版本的复核。

这些文件只允许上述可丢弃段所必需的追加，不能为了统一提示重写：`packages/shared/src/design-revision.ts`、`design-revision-generation.test.ts`、`apps/desktop/electron/design-revision-completion.ts`、`DesignRevisionPanel.tsx`，以及 `main.ts` 里 `input.designRevision` 到 `commitDesignRevision` 的现有顺序。现有修订测试仍应看到旧方案全文、所选提案和“complete revised design”，并且看不到未选提案。

## 策略契约

`OrganizationEnforcementPolicy` 只有 Gate 规则：治理检查、审查发现、缺少审查。`RuntimeBudgetPolicy` 只有美元月度上限、警告线和按 `providerId` 的批准。两者都不描述知识文档能否发往 Hindsight，也不描述摘录能否进入提示。

因此这次不要补团队策略字段，也不要扩大团队同步范围。缺的是本地授权记录，不是新的组织规则。派发前仍走现有的远程策略缓存和 `reserveModelCall`；那只承认模型调用本身，不承认 Hindsight 上传。界面不能写“团队策略已允许”。

L1 规范本来就会进入已配对运行的提供方提示。Hindsight 是第二条出境：选定 Markdown 到配置的端点及其抽取模型。两条出境都要出现在配对确认文案里。

## 验证预算

这是当前不能安全开跑的部分。`deploy/hindsight/budget_gateway.py` 要求账本的 `budget_microyuan` 正好是 5000000，也就是 5 元；账本 `closed` 后拒绝新调用，并且不会在重启时清零。已有验证记录该账本已关闭，保守记账约 ¥0.050602。

桌面阶段、审查、编码和讨论的真实调用走团队美元预算与用户自己的 Provider，不经过这个网关。网关还只接受 `deepseek-flash`、关闭思考、单请求最多 128 KiB、输出最多 8192 tokens。

新建一个空的 5 元账本会在旧账本之外再授权 5 元。只把抽取接到新账本、桌面调用仍走用户 Provider，则桌面费用完全不计入这 5 元。产品代码不应为此绕过或放宽团队预算。

真实扣费前应写成：旧 `ledger.json` 保持关闭且不修改；新账本的上限字段仍是 5000000，并用一条已提交的历史结转占用旧账本的 `committed_microyuan` 之和；本次抽取和桌面付费调用的地址都临时指向该网关，模型与思考设置符合网关限制。做不到就不发起付费调用，其余确定性验证照常完成，并不把未跑的环节记成通过。

约 30 题仍应分开记录检索排序和回答质量。现有英文查询、中文文档排到后面的问题还在，不能用回答质量掩盖排序失败。

## 建议

1. 按上面的四元组实现配对授权，三处拒绝和配对保存时的停用一起改；更新“必须未配对”的存储测试，不要删掉断言来得到全链路通过。
2. 检索段独立、可先丢弃；receipt 与预检使用裁减后的文本。Native 修复遇到来源失效时失败关闭。
3. 讨论保持工具搜索。API 审查不接桌面 Hindsight。测试命令、交付包和验收包不调用知识模型。
4. 配对配置拒绝 `includeMemories: true`，正式记忆维持影子和原范围。
5. 真实付费验证按上节的单一累计账本执行；旧账本不重开。