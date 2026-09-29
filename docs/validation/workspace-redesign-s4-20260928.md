# 工作区改造 S4：材料与版本

日期：2026-09-28。对应[工作区改造方案](../plans/task-centered-workspace-redesign-2026-09-28.zh-CN.md) 7.4 节的改动清单与契约变更（Z1–Z7）和 8.2 节的 S4 验收。分支 `feat/workspace-redesign-s4`，基于 S3 合入后的 `main`（`aaae1b1`）。

## 结论

- Z1–Z7 已实现。方案评审的审批现在绑定用户看到的方案：渲染层发送方案的标识、记录时间与内容摘要，主进程重新读取后逐项比对，缺少或不一致时在写入前拒绝，Run 不变。
- 需求澄清步骤与需求确认 Gate 共用一个版本阅读器（Issue #181）。v1、v2 同名时，选项和正文都写明版本、状态与记录时间；默认打开 Gate 待确认或已确认的版本，不再默认打开原始需求。
- 「材料与版本」按当前待处理、已确认依据、原始输入与参考、讨论提案、历史记录分组。没有版本信息的旧数据写“状态未记录”，不写成已确认。
- 阅读历史版本或原始需求时，确认按钮仍写明目标版本，首次点击只提示“你正在阅读……，本次确认针对……”，再次点击才提交。
- 首屏指标与 S3 相同：三档主基线状态行底部 226px，首个正文区块 272px，视口内控件 28 个。
- 没有改数据库结构、同步队列、交付撤销和会话契约。审批记录写入事件已有的 JSON 字段。所有模型调用来自 Deterministic Fake Provider 或本机受控服务，没有真实模型调用、远端发布或推送交付。

## 契约变更

桌面端 IPC `approveGate` 的输入增加 `expectedDesignRevision: { artifactId, updatedAt, contentDigest }`。

| 情况 | 结果 |
| --- | --- |
| 方案评审 Gate，三项与 Gate 关联的唯一方案一致 | 写入；审批事件带 `designAudit` |
| 方案评审 Gate，缺少标识，或任一项不一致（换了产物、时间不同、内容被改） | 拒绝：`design material is missing, changed, or no longer current`，Run 不变 |
| Gate 未关联方案、关联了多份、方案来自不相关的步骤 | 拒绝，同上；界面显示“状态待核实”，不提供确认按钮 |
| 非方案 Gate 收到方案标识 | 拒绝 |
| 需求确认 Gate | 规则不变（S1 的 V3） |

`contentDigest` 是方案标题、摘要与正文 JSON 的 SHA-256，由 `packages/shared` 的 `createDesignRevisionDigest` 计算，渲染层和主进程共用。冒烟脚本和基线样例在渲染层外复现同一公式，`design-revision.test.ts` 锁定这个公式。

所有直接调用 `approveGate` 通过方案评审的脚本都已改为传入标识：`electron-smoke`、`native-coding-electron-smoke`、`desktop-pilot-smoke`、`v15-github-delivery-packaged-smoke`，以及基线样例。

## 首屏指标

测量方法与 S3 相同，只测三档内容区尺寸与浅色、深色主题（第 11 版起不测 200% 缩放）。

```sh
corepack pnpm exec tsx scripts/workspace-baseline.mts --out docs/validation/evidence/workspace-redesign-s4-20260928
corepack pnpm exec tsx scripts/workspace-baseline.mts --samples clarify-gate-warn --sizes 1440x742 --theme dark --out docs/validation/evidence/workspace-redesign-s4-20260928/variants/dark
corepack pnpm exec tsx scripts/workspace-baseline.mts --self-check
```

- 主基线 `clarify-gate-warn` 三档：状态行底部 226px，首个正文区块 272px，顶栏 56px、4 个控件，视口内控件 28 个，字号 4 种、最小 12px，无横向溢出。深色主题相同。
- 32 个样例中 28 个与 S3 完全相同。
- 4 个 `upload-*` 样例多 1 个控件、多 1 种字号（16px 标题）：它们停在需要重新生成的需求澄清步骤，S3 用通用阅读器（选择材料、查看原文），S4 改用统一的需求阅读器（分节页签）。这 4 个样例都打开着团队连接弹层，不是常规场景。

## 8.2 节 S4 验收

| 场景 | 结果 | 依据 |
| --- | --- | --- |
| 需求同时存在原文、提案、v1、v2 时，默认打开正确的材料 | 通过 | App 测试用 Issue #181 的组合：v1 已被替代、v2 已确认，在需求澄清步骤默认打开 v2；原始需求、v1、讨论提案都能找到，并分别标为原始输入、历史、讨论提案。单元测试覆盖已确认旧版加新待审版（打开待审）、只有提案（不默认打开）、没有正式材料、缺少版本元信息 |
| 阅读 v1 时 v2 待审，不会误批 v1，也不会悄悄批准 v2 | 通过 | 按钮始终写“确认需求 v2”；阅读 v1 时首次点击只提示并不调用写入，再次点击提交的是 v2 的标识（App 测试） |
| 审批瞬间版本变化时，写入被拒绝并保留意见 | 通过 | 需求：主进程拒绝后已填写的修订意见仍在（S1 V3 的测试）。方案：主进程单元测试覆盖标识缺失、换了产物、时间不同、摘要不同、内容在显示后被改；界面给出中文说明，不显示“已通过” |
| 方案评审 Gate 的过期版本同样被写入路径拒绝 | 通过 | Electron 冒烟在真实主进程上先后提交“缺少标识”和“摘要不符”两次方案审批，都被拒绝且 Run 仍停在方案评审 Gate；再用正确标识通过，审批事件记录的 `designAudit` 决定人是配对用户 |

## 与方案的差异

- 需求阅读器的版本选择只在有多个版本时出现，原始需求不进入默认选项。原始需求仍可从「阅读工具」预览，或在「材料与版本」中点「在当前工作中阅读」打开；打开后选择器出现，并提供返回按钮。这样主基线不因多一个选择器超过 28 个控件。
- 通用阅读器的正文标题仍用材料自己的标题，类型、版本或记录时间与状态写在标题下一行，与选项一致。

## 发现、留给后续批次

- Web 发起的审批（Gate Command）在桌面端按审查对象快照核对版本；快照缺失时不核对，需求 Gate 的远程审批也不会把澄清版本标为已确认。归 S5。
- 「材料与版本」的知识引用区仍有 Review Criteria、Knowledge / Policy 等英文，任务页首层文案，归 S6 前的收尾。

## 验证

- `corepack pnpm verify`：通过。类型检查通过；325 个测试文件、4276 项测试通过（1 个文件、15 项按既有配置跳过）；跨平台检查通过。
- 新增测试：
  - `packages/shared/src/design-revision.test.ts`：摘要公式、三项比对、审批记录筛选。
  - `apps/desktop/electron/gate-approval-design.test.ts`：主进程方案版本检查的一致与 8 种拒绝情况、审批事件记录。
  - `apps/desktop/electron/ipc-contract.test.ts`：`expectedDesignRevision` 的字段校验。
  - `apps/desktop/src/app/material-catalog.test.ts`：标签、分组与默认阅读。
  - `App.test.tsx`：Issue #181 组合、方案审批被拒后的中文说明、Gate 未关联方案时不提供确认；原有的方案审批测试改为核对发送的标识，V1 测试改为先提醒再提交。167 项通过。
- `corepack pnpm test:e2e`：41 项通过（版本历史改为中文状态，改了 1 处断言）。
- `corepack pnpm test:electron-smoke`：通过，新增真实主进程拒绝过期方案的核对。
- `corepack pnpm test:native-coding-electron-smoke`：通过。
- `corepack pnpm test:workbench-conversation-electron-smoke`：通过，24 次受控模型调用，没有调用外部模型服务。
- `desktop-pilot-smoke` 与 `v15-github-delivery-packaged-smoke` 需要打包，本批次只改了传参并通过语法与契约测试，没有运行。
- 基线 32 个样例与深色主题、`--self-check`：通过。`pr-approval`、`test-read-failure` 仍只能在渲染层验证，依据同 S0。
