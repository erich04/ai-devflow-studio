# Hindsight 全链路实施与验证记录

日期：2026-10-20。当前状态：全阶段知识接入、完整回归与构建已完成；真实 Todo 的需求、设计、校正编码、测试、浏览器检查和 PR 知识评审均已验证。PR 业务结论仍有证据缺口，未发布远端 PR、未完成真实交付验收。首轮 30 题检索对比未证明混合检索提升；原调查工具基线与生成回答质量尚未评测。

## 实施范围

依据[全阶段方案](../plans/hindsight-fullchain-2026-10-20.zh-CN.md)。Cursor 使用 Grok 4.7 Extra High 非 Fast 的只读建议；Codex 独立采纳、部分采纳或拒绝，见[处置记录](../research/hindsight-fullchain-review-2026-10-20/disposition.md)。首轮文字报告可用，结构化补问因该模型不可用失败，没有切换模型，也没有把 Cursor 结论作为实施许可。

| 路径 | 实际实现 |
| --- | --- |
| 工作台讨论 | 原有 Direct/OpenCode 的 `knowledge_search` / `knowledge_read` |
| 需求、设计和设计修订 | Main 准备知识上下文，Direct/OpenCode 收到有界当前原文 |
| 各阶段评审 | clarify/design/build/test/pr/accept 公共运行时统一注入；实际节点须满足现有准入规则 |
| 编码 | Native/OpenCode 的分析、初始实现、权限继续、修复使用对应运行的知识简报；恢复时检查旧引用 |
| 正式测试命令 | 运行已配置命令，记录知识来源并在执行前后检查；不新建测试模型调用 |
| PR 交付包 | 确定性组装已有受信任证据；知识模型入口为 PR 评审 |

配对项目需要当前配对用户明确启用本机私有知识投影，绑定组织、团队项目、本地项目、用户和认证账号。配对时不开放正式记忆投影。来源和模型配置变化使旧上下文失效；OpenCode 内部每轮调用也检查。团队同步剥离私有检索回执，原有业务产物同步规则保留。

每次阶段宿主动作准备一次检索；讨论仍按每回合最多两次远端查询计数。查询至多 2 KiB，最多五份来源、正文合计 6 KiB、实际渲染段 8 KiB。Stage/Review 预算不足时先裁去新增检索部分；Coding 在原总预算内尽力预留最多 4 KiB，先压缩可选叙述，完整已批准输入、Memory、当前请求和明确约束优先，不能容纳时如实省略检索。回执只列实际送入的来源。Hindsight 只返回候选，正文仍取自当前授权 Git 文件。

## 本次已完成的自动化验证

环境：macOS arm64、Node.js 24.18.0、pnpm 9.15.0。独立测试目录和数据库，没有复用用户数据。

| 检查 | 本次结果 |
| --- | --- |
| 最终 `corepack pnpm verify` | 370 个文件、4,915 项通过；15 项 PostgreSQL 专项按默认配置跳过；类型和跨平台检查通过 |
| `test:organization-postgres` | 随后使用独立 PostgreSQL 16 tmpfs 数据库执行，15/15 通过，容器已删除 |
| `test:postgres-smoke` | 独立空库的历史迁移、v31、策略、审批、GitHub 替身、同步脱敏均通过；容器与 API 已清理 |
| 六阶段评审矩阵 | 35 项通过，含六阶段 × 两类执行器及非法节点边界；已包含在上述最终完整 verify 的 4,915 项中 |
| 最终 `corepack pnpm build` | 完整构建通过，Web/API/Worker/Desktop 构建完成，退出码 0 |
| `test:e2e` | 42 项通过，1 项可选文档截图跳过 |
| `test:electron-smoke` | 通过 |
| `test:native-coding-electron-smoke` | 通过 |
| `test:workbench-conversation-electron-smoke` | 修正旧 fixture 的输出预算断言后通过；24 次本地合成调用、8 个节点 |
| `test:hindsight-electron` | 六项通过，真实 Electron、无真实 Hindsight/付费模型 |
| `test:stage-agent-design-electron` | 通过，真实 OpenCode、10 次合成模型请求 |
| 预算网关边界 | 七项通过，不调用付费模型 |
| 召回截止时间修复 | 先复现红测，再通过客户端/服务/上下文 25 项针对性检查；脚本类型与 Desktop 重建通过 |
| 编码预算修复 | 166 项针对性测试及类型检查通过；独立复核重跑其中 52 项通过，随后最终完整 verify 通过 |

首次同时执行 build 和 verify 时，两者竞争 Web `.next` 目录导致构建失败；串行构建通过。工作台旧 fixture 要求 `max_tokens=3500`，现有产品和单测均为 `32768`，本次将 fixture 对齐后原命令重跑通过，没有为测试降低产品配置。

原始日志位于 `/tmp/hindsight-fullchain-*.log`。初次完整 verify 为 4,890 项，最终完整 verify 日志为 `/tmp/hindsight-fullchain-verify-final.log`；早期串行构建为 `/tmp/hindsight-fullchain-build-serial.log`，最终完整构建为 `/tmp/hindsight-fullchain-build-final.log`。编码预算补充验证为 `/tmp/hindsight-coding-budget-runtime-final.log`。

## 真实服务实验

服务固定为 Hindsight 1.0.0，提交 `39c65ffe2f140d0c84cee58566cad8900c5b9908`，镜像和独立数据卷沿用[此前部署记录](hindsight-local-deployment-20261020.md)。本地 embedding/reranker，只有抽取与开发调用走已授权 DeepSeek。项目来自原 Todo 固定提交 `c2be68d6c4a03fc219c483acc79a90fdf6e11ab6`，知识为六份合成规范，原项目未改动。

首次真实 Electron 实验六份规范全部同步为 ready；需求生成成功，但首次召回超过客户端两秒截止时间，回执为 `degraded=true`。严格脚本将该轮标为失败，未据此宣称语义链路成功。随后直接只读召回同类中文查询约 0.6–0.7 秒，确认冷启动影响；超时降级机制按设计生效。

第二次实验需求生成已获得有效语义来源，但需求评审的 1,148 字节实际查询稳定需要 2.879 秒，仍超过统一两秒截止时间。根据该证据，将召回独立设置为五秒上限；配置、写入、状态和删除请求仍为两秒。取消继续立即生效，超时依然降级。不是全局扩大超时或放宽验收条件。

第三次需求、需求评审、设计、设计评审全部取得有效语义来源；编码阶段原简报占 23,864/24,000 字节，剩余空间不足以放入检索段，回执正确记录零来源，严格验收再次拦下。根据此证据，编码改为在总预算内尽力为检索预留最多 4 KiB，压缩可选说明而保留完整已批准输入等必保内容。独立复核还复现了预留会让 Gate 多行条款被旧逐行摘要丢失的问题，因此增加项目指令和 Gate 正文的预留保护；没有足够空间时如实省略检索，不伪造引用或扩大模型上限。

第四次（`electron-complete`）在设计生成时收到 HTTP 200，但返回内容触发 `invalid_json`。已发生的模型用量已结算，没有保存该次设计产物或推进对应流程，不能把 HTTP 成功当成设计生成成功。

第五次（`electron-verified`）在 Coding prepare 触发既有必保输入的 24,000 字节预算保护。已确认不含 Hindsight 补充的基线也会失败，因此不是新增检索预留造成的回归：未压缩简报为 27,500 字节，旧压缩策略实际保留 25,348 字节。其中必保内容及约束已达 24,700 字节，其余部分为 648 字节。

| 必保内容及约束 | 字节 |
| --- | ---: |
| 已批准需求 | 8,621 |
| 已批准设计 | 11,021 |
| 当前请求与固定指令（pinned） | 1,199 |
| Gate 决定 | 136 |
| 常驻知识压缩后的约束 | 3,723 |
| 合计 | 24,700 |

这一轮没有完成真实编码及后续流程验证；不会通过截断已批准产物、删除业务约束或提高预算让测试继续。

首次证据：`.tmp/hindsight-fullchain-validation/electron/report.json`；第二次为 `electron-warm/report.json`；第三次为 `electron-final/report.json`；第四、第五次分别为 `electron-complete/report.json` 和 `electron-verified/report.json`。第二、三次银行已分别清理并记录 `cleanup-report.json`，没有额外模型调用。第四、第五次的两个 bank 也已完成清理，文档、节点、关系、实体和待处理操作计数均为零。后续真实开发结果见第七轮记录，累计费用在最终收尾时单独汇总。

第六次真实服务实验（`electron-concise-live`）在合成测试请求中要求需求、设计各约 1,000 汉字，减少重复叙述，保留业务约束与预算。真实设计正文为 4,663 字节，编码简报为 23,998/24,000 字节，实际送入三条 `both` 来源、检索段 4,269 字节，验证了知识确实进入编码模型。初始改动生成随后因 `native_v2_too_many_files` 被拒绝：模型返回超过 Native v2 的六文件上限，没有产生待批准差异、测试证据或代码写入。两次编码模型调用均已结算，未把 HTTP 200 当成有效改动。后续第七轮明确把实现范围限定到六个必要文件，保留执行器原有限制。

第六次 bank 已通过永久脚本 `scripts/hindsight-fullchain-cleanup.mts` 清理，原文不变、五项计数均为零；六轮清理证据汇总在 `.tmp/hindsight-fullchain-validation/historical-six-bank-cleanup-index.json`。此前的 `electron-concise` 启动尝试因 sandbox 无法分配端口而停止，尚未启动 API、调用模型或创建 bank，不计为 Hindsight 服务实验失败。

### 第七轮的实际开发与独立复核

第七轮（`electron-six-files`）明确限制六个必要文件和最多十二处替换，保留产品执行器限制。需求生成首次返回无效 JSON，有限重试后成功；需求、需求评审、设计、设计评审及编码分析均保存实际 Hindsight 来源回执。初次生成的六文件差异通过结构校验，但独立审阅发现运行时存储失败被吞掉，界面仍显示成功提示。通过正式 `replyCodingPermission` 拒绝该精确差异，原编码运行进入 interrupted，没有把它批准写入。

随后在同一工作流中，通过正式编码入口提交上述评审反馈并创建新编码运行。修正后的差异经独立复核，批准摘要为 `ad3b00972c2099c2a5fdabcabc5d1ab584bd79eec766ce5f77e9dac29f890d14`，实际只更改 `index.html`、`README.md`、`src/app.js`、`src/dom.js`、`src/store.js` 和 `test/store.test.js`。运行时存储失败通过返回值传递至现有警告区；保留未完成任务的全部字段和顺序，沿用原存储键、格式及零依赖约束。源 Todo 快照不变，修改仅在托管编码工作树。

编码执行和正式 `runProjectTests` 均完成，真实 `node --test` 为 **23/23 通过**。正式测试证据为 `evidence-49ae02c2-3a07-46cc-bf53-ebc86c6cc077`，带 test 阶段来源回执。证据保存在 `.tmp/hindsight-fullchain-validation/electron-six-files-correction-direct/`。

首次独立浏览器检查在勾选后因 DOM 重绘、复选框可访问名称变化而等待旧名称超时；这是测试脚本定位错误。将操作改为 click，再按新名称断言状态，没有提高超时或修改应用。旧失败报告保留，单独重跑的真实 Chromium **16/16 项通过**：混合清理、幸存字段与顺序、禁用状态、刷新持久化、中文输入、切换/删除、清空、Enter/Space、emoji 200/201 边界，以及运行时 `QuotaExceededError` 的提示与内存行为。存储失败后旧持久数据保持，刷新恢复旧内容，未宣称写入成功。没有页面错误或外部请求，18 个源文件前后摘要一致。

浏览器报告为 `electron-six-files-correction-direct/browser-rerun/browser-check-report.json`，SHA-256 为 `94aa906326ebd0531ed689aef52f4b867e4cb7310e80b46f5e0997febe7c2539`，同目录保留四张截图。首次校正连接曾因本机代理返回 CDP 502，发生在 IPC 和模型调用之前；只对 CDP 辅助进程清除代理后连接成功。

最后通过 `hindsight-fullchain-pr-finish.mts` 核对同一编码运行、已批准差异、正式测试和浏览器报告、当前十八个托管源码摘要及六份导出源码，没有重复执行编码或测试。随后正式 IPC 生成确定性交付草稿并执行一次真实 PR Review；五条来源均为 `both`，`degraded=false`，实际检索段 7,536 字节。提前调用 Acceptance Review 被现有节点规则拒绝。最终流程仍停在 PR，`deliveryPublished=false`、`workflowCompleted=false`。

**PR 调用及知识注入验证成功，不代表 PR 业务评审通过。** 模型返回 `warn` 和三项证据缺口：没有 GitHub Delivery 记录；现有交付包缺少实际测试命令、覆盖明细和未验证清单；独立浏览器报告没有作为产品评审材料传入。第一项符合本轮不发布远端的边界；后两项说明现有交付证据包装还有改进空间。浏览器实测通过与评审模型没有收到该报告可以同时成立，不能抹去该警告或把它解释为应用测试失败。

最终报告为 `electron-six-files-correction-direct/final-report.json`，SHA-256 为 `669e3c27048775822e4778a6ccb193224c32b14da1c9a9ff08992a8ab53d1b76`，附 `pr-review.json`、`pr-package.md`、`final-interpretation.json` 和 Electron 截图。其 `passed=true` 指已到达阶段的接入、来源及边界检查，不表示业务批准、远端发布或一次无失败跑通；原校正报告的浏览器失败保留。

本轮付费开发路径为 Direct 阶段/评审和 Native 编码。OpenCode 入口由受控模型与真实执行器集成测试覆盖，没有把它称为第二条真实 Hindsight/付费模型全流程。

## 30 题检索结果

复用首次关闭的 Electron 隔离 profile 和同一真实 Hindsight bank；24 道基线、3 道规则修订、3 道权限边界，两种模式各 30 次检索。短查询在原两秒截止时间下全部正常完成，正常 27 题没有 Hindsight 降级。另有 3 道故意关闭/排除/跨项目的边界返回空集，分别计分。

| 指标 | 本地词法 | Hindsight 混合 |
| --- | ---: | ---: |
| 可回答题 Top1 | 18/23（78.26%） | 15/23（65.22%） |
| Top5 至少命中一个必需来源 | 22/23 | 22/23 |
| Top5 覆盖全部必需来源 | 22/23 | 21/23 |
| 必需来源召回 | 28/29 | 27/29 |
| 4 道普通无答案题误召回 | 3/4 | 4/4 |
| 3 道权限边界正确返回空集 | 3/3 | 3/3 |
| p50 / p95 | 169 / 230 ms | 756 / 1,085 ms |

239 个引用全部重新回读当前原文并核对摘要，无陈旧或跨范围来源。修改规则后旧句柄被拒绝，原文最终恢复；首次 bank 的文档、节点、关系、实体、待处理操作均为零，配置停用。

**结论：接入和生命周期检查通过，但这份六文档小语料没有证明混合检索优于词法，不能宣称价值验收通过。** 混合模式在直接问题排序上退步，跨文档题 `cross-04` 漏工程规范；两模式均漏英文修订题 `revision-03`。普通无答案误召回不能被权限边界的正确空集稀释。此处的误召回是“返回无关来源”，没有测生成回答是否会编造答案。

证据为 `.tmp/hindsight-fullchain-validation/electron/retrieval-evaluation/report.json` 和 `analysis-summary.json`。完整报告 SHA-256：`3c286387804ea14699772874dc0ede831bb4e5033a0540be20eda532af024b9c`。没有运行原调查工具基线或回答质量评测。保留显式启用和本地回退；后续需用更大独立语料评估多语言模型、融合排序及无答案处理，不能只围绕这 30 题调参。

## 费用与环境收尾

此前合成验证 7 次调用，保守结算 ¥0.050602；本轮抽取、失败尝试、开发和评审共 76 次调用，保守结算 ¥1.552694。两者累计 **83 次、¥1.603296**，低于用户授权的累计 ¥5。全部调用已结算，没有 unknown 或未结算预留。金额按网关的不计缓存折扣费率保守计算，未读取提供方正式账单，不能当成最终扣款。

旧账本保持关闭且 SHA-256 不变：`be1fe80f44376df3f0a8342c8221074181f6648005d9bf323379e443cb8ecf54`。新账本已关闭，SHA-256 为 `2a44c4b5ec69f741ab239df567aadce527e333bb29704909edc8a02546bbb1f7`。预算网关已停止并移除，8891 端口关闭；Hindsight 恢复 `devflow-unconfigured`、无凭据及不可达模型地址的待机配置，8890 健康检查正常，数据卷保留。证据为 `.tmp/hindsight-fullchain-validation/final-cost-report.json` 和 `final-standby-report.json`。

七轮合成 bank 均已核验文档、节点、关系、实体和待处理操作为零，相应本地配置停用；最后一轮见 `electron-six-files/cleanup-report.json`。空 bank、配置、审计和历史 operation 仍保留，未宣称擦除备份或所有历史痕迹。

隔离 Electron 通过 `app.quit` 退出，测试 Team API 已停止。原测试驱动一直等待已被正式拒绝的初次差异，因此单独结束并保留原报告备份，标记 `aborted / corrected-in-separate-continuation`；未伪写旧批准摘要。其 TERM 未退出后仅强制结束已核对的驱动和 esbuild 两个进程，最终剩余进程为空，见 `electron-six-files/driver-shutdown.json`。这不改变同一工作流后续校正及独立最终报告的实际结果。

## 验证边界

本次没有默认授权发布远端 PR、合并代码或绕过业务验收。未发生远端交付的 Electron 流程应拒绝尚未到达的 Acceptance 节点；验收知识注入另由公共运行时集成测试覆盖，不能把它写成真实远端交付验收通过。

本次扩展的是知识在开发流程内的使用。Reflect、自动确认业务关系、完整本体平台、团队共享知识、博客发布及生产金额硬预算均未因此实现。检索排名和最终回答质量应分别评估。

后续优先级是补全交付包的实际测试明细及外部浏览器证据接入，再用独立多语言语料验证排序和无答案处理。默认继续显式启用，不把当前结果作为扩大自动上传范围或默认开启混合检索的依据。
