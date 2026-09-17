# 真实 DeepSeek To Do List 全流程验收 — 2026-09-17

## 结果与边界

已在独立的干净测试环境，从新建项目、配置 Provider、提交需求、Desktop 配对开始，完成需求澄清、方案设计、真实改码、测试、GitHub Draft PR 发布和业务验收。

最终 Run 为 v13 / completed，6 个阶段共 8 个节点全部 success。团队 Web 刷新后也显示“已完成”，GitHub Delivery 显示 COMPLETED。不是预置成功状态，也没有用测试 fixture 替代这次真实模型执行。

- 真实项目：`erich04/devflow-blank-mini-agent-20260911`；干净基线 `c2be68d6c4a03fc219c483acc79a90fdf6e11ab6`。
- 实际交付：[Draft PR #3](https://github.com/erich04/devflow-blank-mini-agent-20260911/pull/3)，状态 OPEN / draft=true，未合并。
- 交付 commit：`67f4079441ed06d81ecc018b65895591b53c3bf0`。
- 项目：`p-todo-deepseek-e2e-20260917`。
- Run：`run-work-request-70976529d57bcdd51aca567a5bf79100`。
- Run 创建时间：2026-09-17 06:09:08 UTC；完成时间：08:47:26 UTC。
- PR 创建时间：08:42:19 UTC；会话最终查询复验：09:27:36 UTC。
- DevFlow 实现基线：`b30b4f5`，本轮继续修复 4 个真实暴露的问题，提交见下表。

这是本地隔离部署的团队后端与 Electron，连接真实 DeepSeek 和 GitHub；不代表已经验收生产云部署。核心流程跑通，但尚有下文所列非阻塞问题。

## 环境与操作方式

新建 PostgreSQL 数据库、API、Web、Electron 用户目录和 SQLite。未使用 demo 数据或 fake runtime。API / Web / To Do 页面端口分别为 4340 / 4341 / 5342。

团队端使用 Local Developer 测试身份，Desktop 绑定团队项目并同步真实策略 v1。复用已有 GitHub App 安装并通过真实 GitHub 校验；用户完成系统钥匙串授权后，使用本地加密保存的 DeepSeek 凭据，没有导出明文。

界面操作通过 CUA 完成：创建项目与工作请求、配对、配置、提问、保存提案、生成阶段产物、审查与批准、审批精确 Change Set、运行测试、固定交付版本、Web 批准发布、最终验收。代码与只读数据库检查用于定位问题、验证证据；没有直接改数据库推进流程。

DevFlow Native v2 调用 `https://api.deepseek.com` 的 `deepseek-flash`。月预算配置为 $1.00，预警 $0.50。失败用量存在 #139 的记账缺口，因此界面费用不可当作本次完整账单。

## 需求与实际实现

需求是在中文任务清单下方增加“清除已完成”按钮：

- 一次删除所有已完成任务；保留未完成任务的内容、ID、创建时间和相对顺序。
- 刷新后清理结果仍保留；没有已完成项时禁用。
- 新增任务、中文输入、勾选/取消、单条删除保持正常。
- 明确不增加确认弹窗或撤销；显示“已清除 N 项”，沿用原来的空列表状态和存储键。
- 使用原生 JavaScript / localStorage，不增加依赖；补充测试和 README。

真实模型在受管工作树中修改了 6 个文件，共 144 行新增、2 行删除：
`README.md`、`index.html`、`src/app.js`、`src/dom.js`、`src/store.js`、`test/store.test.js`。

成功 Coding Run 为 `coding-run-2c03abb8-e665-4fd0-9436-9969c5829e32`。模型提出 6 个文件、9 处精确替换，UI 审批对应 Change Set 后才应用。成功调用 2 次，Provider 返回 19,560 tokens。没有由外部助手手写 To Do 实现来替代这一步。

## 逐节点与详情验收

| 阶段 / 卡片 | 实际操作和结果 | 已打开的详情标签 |
|---|---|---|
| 需求澄清 Task | 对话真实读取仓库、追问、接收回答、保存提案；正式澄清 v1 暴露 #136，修复后经正常修订流程生成 v2 | 状态、产物、测试证据、轨迹、Gate 影响 |
| 需求确认 Gate | 核对 v2、运行真实 DeepSeek 审查、查看警告并批准；关联准确版本 | 状态、产物、测试证据、轨迹、Gate 条件、引用来源、Remediation |
| 方案设计 Task | 真实 DeepSeek 生成实施方案与测试策略 | 状态、产物、测试证据、轨迹、Gate 影响 |
| 方案评审 Gate | 查看方案、真实模型审查和上游证据后批准 | 状态、产物、测试证据、轨迹、Gate 条件、引用来源、Remediation |
| Implement locally | 真实 Native 分析代码、提出 Change Set、获批后改码、生成 diff 并运行测试 | 状态、产物、测试证据、轨迹、Gate 影响 |
| Run tests | 单独运行实际项目测试，归档退出码、日志和耗时 | 状态、产物、测试证据、轨迹 |
| Prepare PR draft | 从真实 diff / 测试生成交付包；固定 commit 并重测；Web 批准后 Desktop 推送分支并创建 Draft PR | 状态、产物、测试证据、轨迹、Handoff |
| Acceptance signoff | 生成验收包、真实 DeepSeek 审查、浏览器业务验证、明确批准最终 Gate | 状态、产物、测试证据、轨迹、引用来源、Final Gate |

8 张卡片、44 个详情标签均已实际打开。节点本身没有测试证据时如实显示空；交付关联的上游证据不冒充本节点的证据数量。曾出现一次 AX 读取滞后，刷新观察后已确认对应 Remediation 标签正常，没有把自动化观察问题当作产品缺陷。

## 自动化与浏览器业务结果

基线 17/17；变更后 23/23。三个真实执行点均通过：

| 执行点 | 证据 | 结果 |
|---|---|---|
| Native 完成后 | `coding-test-c932a81b-41ab-48ed-861a-8122f60d0154` | 23/23，397 ms，exit 0 |
| 独立 Test 节点 | `evidence-d46dea13-95cf-43e9-be14-bcbabd1f3366` | 23/23，384 ms，exit 0 |
| 固定交付 commit 后 | `github-delivery-test-8904789d-fc7f-4156-99ec-79decd989beb` | 23/23，363 ms，exit 0；绑定上述 commit |

浏览器沿用修改前同一 origin 的 localStorage，验证旧数据兼容：

1. 原甲 / 乙 / 丙三项，其中乙已完成；清除后只删除乙，甲丙内容和顺序不变。
2. 提示“已清除 1 项”；按钮禁用；刷新后结果保持。
3. 新增中文任务丁，勾选和取消分别使按钮启用和禁用。
4. 单条删除丁，甲丙仍保留。
5. 将甲丙全部标为完成，一次清除两项，显示原有空状态。
6. 空状态刷新后保持，按钮禁用；没有确认弹窗或撤销。
7. 模型新增的 store 测试同时覆盖 ID / 顺序 / 创建时间、序列化恢复、零完成项与存储异常回退。

## 统一会话与节点详情

- 同一会话查询任意节点。原需求会话在最终验收后重新查询全部 8 个节点，得到最新 completed / v13，未被最初需求节点限制。
- 新会话查询共享事实。独立会话无需复制旧聊天，能查询已完成流程、测试和正式交付信息。
- 实际聊天操作按钮可定位测试节点及交付节点，并打开对应详情。
- 私有记忆隔离。会话 A 保存专用测试代号，真实 DeepSeek 在 A 中正确读取；会话 B 明确无法读取其他会话的代号，没有猜测。
- 草稿和聊天隔离。只有明确保存的节点提案才进入共享产物；私有对话内容不自动升级为项目事实。
- 关闭 Tab 与历史恢复。A 的未发送草稿保存后关闭 Tab，重启 Electron，再从会话历史打开；名称、聊天、私有记忆、草稿均恢复，未自动发送。
- 重启后阶段状态与真实 Provider 配置仍可用。
- PR 查询补漏。最初模型因工具漏投影发布回执而查不到 URL；#144 修复后，同一真实 DeepSeek 会话正确返回 PR #3、完整链接、draft=true、固定 commit，没有额外发布。

## 本轮修复与验证

| 跟踪 | 问题与修复 | 本地提交 |
|---|---|---|
| [#136](https://github.com/erich04/ai-devflow-studio/issues/136) | 正式阶段 Prompt 丢失已保存会话提案正文；加入当前节点的待确认提案，并保留权限和证据边界 | `72d4fa0` |
| [#138](https://github.com/erich04/ai-devflow-studio/issues/138) | 历史产物挤占上下文，完整批准需求无法装入；保留批准版本正文和 Gate 决定，历史只留引用，超限明确失败 | `000d4b3` |
| [#140](https://github.com/erich04/ai-devflow-studio/issues/140) | 模型不知道 Native 文件数等硬限制，失败诊断过粗；明确约束并记录不含原始模型正文的分类原因 | `8c4387e` |
| [#144](https://github.com/erich04/ai-devflow-studio/issues/144) | 对话节点查询缺真实 PR 发布回执；增加当前项目 / Run 范围内的最小交付事实 | `e62c79a` |

针对修复先添加失败复现，再验证：
- Workflow Agent 24 项及相关回归通过；包括真实兼容 Provider 请求体，不只检查内部 context。
- Coding context / runtime 相关 141 项通过；批准正文完整保留与超限拒绝均覆盖。
- Native provider trace / v2 runtime 17 项通过。
- 会话服务 23 项通过；覆盖所有节点、跨节点、共享事实、私有历史与记忆、待回答恢复、取消、项目隔离、真实 PR 字段投影。
- Shared / Desktop 类型检查、Electron 构建和 git diff 检查通过。
- 四项修复均回到当前真实 UI 流程复验；没有仅靠模拟测试宣称恢复。

## 尚未解决、已经跟踪的事项

| Issue | 本次观察 |
|---|---|
| [#125](https://github.com/erich04/ai-devflow-studio/issues/125) | QA Electron 的退出过程仍可能残留进程；重启时只处理专用测试实例 |
| [#135](https://github.com/erich04/ai-devflow-studio/issues/135) | 独立 QA bundle 的钥匙串授权；用户授权后恢复，后续重启成功，不能据此推断正式安装行为 |
| [#137](https://github.com/erich04/ai-devflow-studio/issues/137) | 模型 Gate 审查误将已有的确认 / 撤销决定视为缺失；不能把模型意见直接当成流程事实 |
| [#139](https://github.com/erich04/ai-devflow-studio/issues/139) | 失败 Native 调用用量未计入 Run 汇总和预算。4 次失败执行共 7 次已返回用量的调用、66,529 tokens，不能视为免费 |
| [#141](https://github.com/erich04/ai-devflow-studio/issues/141) | 阶段不可执行 / 正在运行被误写成“需要配置” |
| [#142](https://github.com/erich04/ai-devflow-studio/issues/142) | 发布准备前，状态矩阵误报上游 diff 缺失 |
| [#143](https://github.com/erich04/ai-devflow-studio/issues/143) | 提案已保存，但相关“是否保存”追问仍显示待回答 |

正式澄清和设计本次仍使用 Direct Provider：它们没有自行执行仓库取证，产物也如实保留未验证说明。仓库读取实际发生在统一对话调查及 Native 实现阶段；对话读过代码不等于正式 Gate 已拥有合格取证记录。把只读调查整合进正式澄清执行器，仍是后续能力完善项。

最终验收模型返回 warning：验收包中的 diff 内容截断、部分业务决定与浏览器验证没有完整进入包。我们另行查看实际代码、三次测试和浏览器结果后按现有 warn-only 策略批准；没有关闭强制 Gate，也没有伪造“零警告”。

## 留存的现场与证据

本地测试根目录为项目下 `out/real-todo-e2e-20260917`；该目录内：
- `evidence/final-verification.json`：最终 Run / 8 节点、Coding、测试、PR 回执及会话校验摘要。
- `evidence/browser-business-verification.md`：真实浏览器验收步骤。
- `evidence/conversation-delivery-recheck.md`：最终真实 DeepSeek 交付查询答复。
- `evidence/clarification-v2.json`、`design.json`、`native-success.json`：阶段证据。
- 独立 Desktop / SQLite、团队后端和改后 To Do 页面保持可查看；原 walkthrough 数据和原项目工作区未清空。

