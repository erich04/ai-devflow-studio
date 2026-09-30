# 知识上下文改造方案：项目说明常驻 + Agent 现场检索

- 状态：第 3 版，方向和第 0 节的三项决定已确认（erich04，2026-09-29）。K0–K4 均已完成；结果见第 11 节。剩下第 12 节第 3 条的真实模型验证，其中一部分已由 #203 覆盖。
- 分支：K0–K2 随 #191、K4 随 #194、知识审查 local-agent 随 #197、K3 随 #198 合入 `main`；知识页检查纳入编码回执的清单在 `feat/knowledge-checks-coding-receipts`，基于 `e9ce1f5`。
- 文中的新字段、新工具、新批次在对应批次完成前都只是计划。实施结果见第 11 节。
- 决策记录：[ADR 0025](../adr/0025-resident-knowledge-context.md)。

## 0. 已确认的决定（2026-09-29）

1. **暂不接入 Codex**。本方案只覆盖 Direct Provider、OpenCode 和 DevFlow Native v2。以后要接 Codex，另立方案。
2. **front matter 新增 `stages` 和 `gate` 两个字段**，由文档作者显式声明适用阶段和是否作为 Gate 依据。没写 `stages` 的文档按现有 category 对照表推默认阶段，`gate` 默认为 `false`。
3. **Web 端这一版不同步知识**：维持 ADR 0011 的边界，Markdown 不离开桌面。以后需要时再考虑只同步元数据（标题、版本哈希、Gate 要求检查哪几篇），不同步正文。

## 1. 结论

不再用"词法检索取前 3 个片段"给模型提供知识，改成三层：

1. **项目说明常驻（L0）**：仓库根目录的 AGENTS.md。无论用哪个执行器，看到的都是同一份。
2. **知识目录常驻（L1）**：项目知识目录（默认 `docs/knowledge/`）按阶段整篇注入，超出预算的只给目录。
3. **现场检索（L2）**：能调用工具的执行器（OpenCode）自己用 grep 查、自己读文件。引用来自实际读取，由 DevFlow 按文件字节校验。

Run、Gate、证据等结构化事实继续走现有的工作流投影和讨论工具。记忆由另一条线（P0–P2）负责，本方案不改。

不做：向量索引、GraphRAG、代码索引。v2.1 的向量表和 RRF 契约保留，但不接入。

## 2. 现状

| 入口 | 知识从哪来 | 问题 | 代码 |
| --- | --- | --- | --- |
| 澄清、设计（Direct Provider） | 提示词里没有知识，也没有 AGENTS.md | 模型不知道项目规范 | `packages/shared/src/workflow-agent.ts` 的 `createWorkflowArtifactPrompt` |
| 澄清、设计（OpenCode 只读） | 提示词同上。会话目录是仓库根，且没有关闭说明文件加载 | 会读仓库的 AGENTS.md，也可能带入用户全局说明，DevFlow 不记录（K0 实测结论见第 11 节） | `apps/desktop/electron/stage-agent-executor.ts` |
| 知识审查 | REVIEW_CRITERIA 放词法命中的片段，最多 8 段、共 24,000 字符 | 中文基本命中不了；只支持 Direct Provider | `packages/shared/src/agent-review.ts` |
| Gate 治理检查 | 本阶段类别下的所有文档都列为"需要证据"，类别按路径猜 | 按代码推算，本仓库的需求确认 Gate 约有 163 份 | `packages/shared/src/knowledge.ts` 的 `documentsForNode` |
| 编码简报 | 词法命中最多 8 条，每条摘录 1,200 字符，合计 6,000 字符，优先级 60 | 同上。OpenCode 编码引擎在工作树里运行，会自己读 AGENTS.md；Native v2 不读 | `packages/shared/src/coding-agent.ts` |
| 讨论栏 `knowledge` 工具 | 按空格切词，任一词作为子串命中就返回，取前 8 条，不排序 | 中文查询通常是一整句，切不开 | `apps/desktop/electron/workbench-conversation-service.ts` |
| 知识页 | 全仓 191 份 Markdown 的列表，外加"文档 → 标签"图 | 混进了方案和验证报告 | `apps/desktop/src/views/KnowledgeView.tsx` |

共性问题：

- 索引范围是整个仓库，而不是策展过的知识目录。桌面端也不读项目配置的 `knowledgeBasePath`，这个字段只出现在测试夹具里。
- 项目说明文件有的执行器读、有的不读，DevFlow 也不记录读了什么。
- 同一个任务换一个执行器，模型拿到的规范就不一样。

## 3. 设计原则

1. **执行器之间一致**：同一任务无论选哪个执行器，项目说明和阶段知识都相同。执行器之间只有一个区别：能不能现场查。
2. **常驻内容小而确定**：来源、顺序、上限固定，并记录摘要，结果可复现。常驻内容放在提示词的稳定前缀里，便于命中 prompt cache。
3. **Gate 判定只看确定性输入**，即常驻层加结构化事实。现场检索读到的内容只用作补充说明和引用，不作为通过依据。
4. **仓库里的说明文件是不可信输入**：它可以约束模型行为，但不能扩大权限。权限仍由 DevFlow 的能力授权和 OpenCode 的权限配置决定。
5. **沿用外部约定，不发明新格式**：用 AGENTS.md（OpenCode、Codex、Claude Code 等工具通用），大小上限参考 Codex 的默认值 32 KiB。

## 4. 目标结构

### 4.1 L0：项目说明

- **读哪个文件**：只读仓库根目录的 `AGENTS.md`，没有时读 `CLAUDE.md`。
  - DevFlow 发起的运行都以仓库根或受管工作树根为工作目录，OpenCode 从当前目录向上找最近的一份，加载的就是根目录这份。
  - 子目录里的说明文件由 Agent 在需要时自己读。
- **上限**：32 KiB。超出部分截断，并在界面提示。本仓库的 AGENTS.md 是 3,003 字节。
- **不带入用户全局说明**：`~/.config/opencode`、`~/.claude` 下的文件不进入 DevFlow 发起的运行。个人偏好不应影响团队流程，而且这部分无法审计。
- **怎么注入**：
  - Direct Provider、Native v2、知识审查：DevFlow 读取文件，放在提示词开头的 `PROJECT_INSTRUCTIONS` 段。
  - OpenCode：由 OpenCode 自己加载，DevFlow 不重复注入，只计算同一文件的摘要写进上下文清单。

### 4.2 L1：知识目录

- **范围**：只索引项目的知识目录，不再扫描全仓。读取项目配置的 `knowledgeBasePath`，没有配置时用 `docs/knowledge/`。
- **front matter 新增两个字段**（保留现有的 title、category、summary、tags、ownerId）：

  ```yaml
  ---
  title: 测试证据规范
  category: testing_standard
  stages: [test, pr]   # 注入到哪些阶段的提示词里
  gate: true           # 是否作为对应阶段 Gate 的审查依据
  ---
  ```

  - `stages`：适用阶段，取值为 `clarify`、`design`、`build`、`test`、`pr`、`accept`。不填时按现有 category 对照表（`knowledgeDocumentCategoriesForStage`）推默认阶段。
  - `gate`：`true` 表示进入对应阶段的治理检查。不填时为 `false`，文档只作为背景资料，不产生警告或阻断。
- **解析器**：换成支持列表和布尔值的 front matter 解析。只接受第 4.2 节列出的键，其余键保留原样、不解释。`packages/shared` 目前没有任何运行时依赖，Web 端也引用它，所以不引入通用 YAML 库，而是实现一个受限子集：标量、带引号的字符串、`true`/`false`、行内列表 `[a, b]` 和块列表 `- a`。
- **每次调用按阶段组装**：
  1. 适用本阶段的文档整篇放入。先放 `gate: true` 的，其余按路径排序。
  2. 超过阶段预算后，剩下的文档降为目录项，只列标题、摘要、路径和摘要哈希。预算初定 24 KiB，与现在知识审查的上限相当。现有 10 份策展文档合计 29,230 字节。
  3. 不适用本阶段的文档只列标题和路径，条数超过上限时截断，并注明省略了多少。
- **位置**：目录和正文都放在稳定前缀里，紧跟 L0。

### 4.3 L2：现场检索

- **能力**：OpenCode 用现有的 read、glob、grep、list。
- **提示词**：说明知识目录的位置，附上目录清单，并告诉 Agent 需要细节时自己去读。
- **引用**：
  - 沿用现有的 `repositoryFindings` 结构和 `validateAndDigestRepositoryCitations`：按本地字节算 sha256，路径不能越出仓库。
  - 补一项校验：行号范围必须落在文件的实际行数内。现在只校验格式。
- **Direct Provider**：没有这一层，界面上继续标明"未进行仓库核查"，这是现有行为。

### 4.4 L3：结构化事实与记忆

- 不改。Run、节点、材料、证据和 Gate 决定继续由工作流投影和讨论工具提供。
- 记忆召回和提示缓存布局由另一条线处理（ADR 0024，#193 的提示前缀契约，本方案原先称为 P0）。L0 和 L1 按那条线的稳定前缀规则放置。K3 核对后只有 Native v2 提示布局一处与 #193 重叠；#193 合入后评估，项目说明留在简报里，不单独移动，见 11.9。

### 4.5 上下文清单

每次模型调用都记录一份清单，扩展现有的 `contextDigest` 和 `CodingContextReceipt`：

- **L0**：文件路径、字节数、sha256、是否截断，以及由谁加载（DevFlow 注入还是 OpenCode 自己加载）。
- **L1**：整篇注入的文档（路径加 sha256）、降为目录的文档、预算用了多少。
- **执行器**：执行器和引擎的版本。

审查结论和设计证据都引用这份清单。它取代现在按片段记录的 `KnowledgeReference`，以及其中 `kh-` 前缀的 32 位 FNV 哈希。

## 5. 各入口的改法

| 入口 | 改后 | 批次 |
| --- | --- | --- |
| 澄清、设计（Direct Provider） | 提示词开头加 L0 和 L1 | K1 |
| 澄清、设计（OpenCode） | 注入 L1，L0 由 OpenCode 自己读；有已保存提供方绑定时隔离用户全局配置；记录清单 | K2 |
| 知识审查 | REVIEW_CRITERIA 改为本阶段 `gate: true` 的文档整篇；新增 local-agent（OpenCode）选项，可以读仓库核对；默认仍只警告 | criteria 在 K1，local-agent 在 K2 |
| Gate 治理检查 | 只检查 `gate: true` 且适用本阶段的文档。测试规范按测试证据判定满足或违反的规则不变 | K1 |
| 编码简报 | `knowledge` 来源改为适用 build 阶段的文档加目录；OpenCode 编码引擎同样隔离全局配置；Native v2 加 L0 | K3 |
| 讨论栏 | `knowledge` 工具拆成 `knowledge_list`（目录）和 `knowledge_read`（按路径分段读）。现有 `repo_search` 已经能搜知识目录 | K3 |
| 知识页 | 展示知识目录、适用阶段、哪些是 Gate 依据、L0 文件和预算，以及检查结果（见 K4） | K4 |

K1 要同步给现有 `docs/knowledge` 的 10 份文档补上 `stages` 和 `gate`。这样严格策略下"测试规范缺证据即阻断"等规则在本仓库的表现保持不变。

## 6. 分批实施

| 批次 | 内容 | 完成条件 |
| --- | --- | --- |
| K0 核实与评估集 | ① 起一个本地假模型服务，截获 OpenCode 发给模型的请求，确认 `serve` 会话会按 `directory` 加载仓库 AGENTS.md，以及会不会带入用户全局文件。② 整理 20–30 条中文评估场景，每条标注需求、阶段、应适用的知识文档、Gate 应检查的规范；记录现有词法检索的命中率作为基线 | 两项都有结论；评估集入库；默认零付费调用 |
| K1 知识目录与常驻注入 | shared 与桌面主进程：读取知识目录（`knowledgeBasePath`）、新 front matter 字段、读取 L0、按阶段组装、上下文清单。Direct Provider 阶段提示词、知识审查的 criteria 和 Gate 治理检查改用新输入。给现有 10 份文档补字段 | 评估集里"应适用的文档"全部进入对应阶段的上下文；本仓库需求确认 Gate 的治理检查数从约 163 降到 `gate: true` 的文档数；同一输入组装两次，清单完全相同 |
| K2 OpenCode 对齐 | 阶段 Agent 和编码引擎隔离用户全局配置；知识审查支持 local-agent；补上引用行号范围校验 | 假模型服务断言：请求里有仓库 AGENTS.md，没有用户全局说明；local-agent 审查的产出通过现有校验 |
| K3 编码简报与讨论栏 | 替换编码简报的知识来源；Native v2 加 L0（经简报）；拆分讨论栏的知识工具 | 现有编码和讨论冒烟测试通过；简报回执记录新清单 |
| K4 知识页与检查 | 知识页按 4.2 展示。加入确定性检查：断链（相对链接和锚点）、缺 front matter、`stages` 取值非法、超出预算、清单里的文件已被删除 | 检查结果显示在知识页，不阻断流程 |

依赖关系：

- K0 → K1 → K2 依次进行。
- K3 在 K1 之后。原写"等另一条线的 P0 合入"不准确：2026-09-30 逐文件核对后，只有 Native v2 提示布局一处与 #193 重叠（见 11.9）。
- K4 在 K1 之后，随时可以做；涉及 `DesktopViews.tsx` 的界面部分等 S6 合入后 rebase 再做。

## 7. 与既有设计的关系

- **保留**：
  - ADR 0002：Git Markdown 是权威来源。
  - ADR 0007 里"检索结果不是治理证据"的原则。
  - ADR 0011：Markdown 不离开桌面（第 0 节决定 3）。
- **取代或搁置**：
  - ADR 0007、0008 里以词法命中片段作为审查依据的部分被取代。
  - ADR 0017 的混合检索搁置：表和契约保留，不接入。
  - `CONTEXT.md` 里"知识片段""知识检索命中""知识引用"的定义需要更新。
- 决策记录见 [ADR 0025](../adr/0025-resident-knowledge-context.md)。

## 8. 风险

1. **成本**：常驻注入每次调用多出几 KiB 到二十几 KiB 的输入。用阶段预算和 prompt cache 控制；K0 的评估集记录每个阶段的实际体积。
2. **仓库 AGENTS.md 是提示注入面**：能提交代码的人就能影响模型。它不能扩大权限（见第 3 节原则 4），界面上显示本次加载了哪些说明文件及其摘要。
3. **OpenCode 的加载行为依赖外部版本**：K0 在当前支持的 1.18 上实测；升级 OpenCode 时重跑 K0 的核实脚本。
4. **Web 端审查仍然没有知识**：这是决定 3 接受的代价。Web 审批依赖桌面同步上去的审查结果。

## 9. 不做

- 向量索引、嵌入模型、GraphRAG、给代码建索引。
- 用 LLM 生成知识摘要，或自动改写知识文档。
- 记忆召回、压缩和提示缓存布局，这些属于另一条线。
- 本版不做：Codex 接入、Web 端同步知识。

## 10. 修订记录

- **v1**（2026-09-29）：初稿，含 Codex 只读阶段 Agent 和编码引擎评估。
- **v2**（2026-09-29）：按第 0 节决定删除 Codex 相关内容（原第 6 节和 K4），原 K5 改为 K4；`stages` 缺省改为按 category 推默认阶段，删除单独的兼容模式；Web 端维持不同步。入库时补充：front matter 解析采用受限子集，不引入 YAML 依赖。

## 11. 实施结果

以下结果都来自本地确定性运行：本地假模型服务或假提供方，没有调用真实模型，没有远端发布。

### 11.1 K0 核实（2026-09-29）

**① OpenCode 实际加载了哪些说明文件**。脚本 `scripts/knowledge-context-opencode-probe.mts`：本地 OpenCode 1.18.15，本地假模型服务截获请求，临时 Git 仓库和临时 HOME 中放入哨兵文件，不读也不改真实用户配置。改动前（DevFlow 当时传给只读阶段 Agent 的环境）：

| 来源 | 是否进入模型请求 |
| --- | --- |
| 仓库根目录 `AGENTS.md` | 是 |
| 仓库根目录 `CLAUDE.md` | 否（`AGENTS.md` 优先） |
| `~/.config/opencode/AGENTS.md` | 是 |
| `~/.config/opencode/opencode.json` 的 `instructions` | 是 |
| `~/.claude/skills` 的技能描述 | 是 |
| `~/.claude/CLAUDE.md` | 否（被 `~/.config/opencode/AGENTS.md` 覆盖；只隔离 XDG 目录时会进入） |
| `~/.agents/skills` 的技能描述 | 是（K2 补测） |

另外两点：OpenCode 在自身环境说明中把仓库**绝对路径**发给提供方，DevFlow 的脱敏覆盖不到；本机真实 `~/.config/opencode` 下有 `opencode.jsonc` 和插件，按上表机制，改动前的阶段 Agent 会加载它们（机制已实测，本机插件本身未实测）。

**② 中文评估集与基线**。`scripts/fixtures/knowledge-context-evaluation.json` 共 24 条场景，覆盖六个阶段，每条标注应整篇进入上下文的规范（required）、至少出现在目录的规范（available）和 Gate 应恰好检查的规范（gate）。改动前的结果（`docs/engineering/evidence/knowledge-context-baseline-20260929.json`）：

| 指标 | 改动前 |
| --- | --- |
| 索引范围 | 全仓 191 份 Markdown，2,064 个片段 |
| required 召回率 | 23.3% |
| 全部命中的场景 | 7 / 24 |
| Gate 检查恰好正确的场景 | 0 / 24 |
| 各阶段治理检查数（clarify / design / build / test / pr / accept） | 163 / 35 / 155 / 2 / 8 / 32 |

`--baseline` 模式只复现改动前的索引范围和词法检索；Gate 选择已改为按 `gate` 字段，所以要看改动前的治理检查数请以上述证据文件为准。

### 11.2 K1 结果

- **实现**：
  - `packages/shared/src/knowledge-context.ts`：阶段解析、按阶段组装、预算与目录、上下文清单。
  - `knowledge.ts`：front matter 受限子集解析（行内与块列表、布尔值、行内注释），`stages`、`gate`；治理检查只看 `gate`；未显式传入检索器时，引用按阶段生成（`strategy: 'stage'`，并带 `stages`），不再调用词法检索。
  - 桌面索引只读知识目录（默认 `docs/knowledge`，`''` 表示整仓），为每份文档记录 sha256 摘要，读取根目录 `AGENTS.md`/`CLAUDE.md`（32 KiB 上限、拒绝符号链接越界），快照哈希包含说明文件。
  - 阶段 Agent 提示词在 `RAW_REQUEST` 之前加入 `PROJECT_INSTRUCTIONS` 与 `PROJECT_KNOWLEDGE`（已脱敏），溯源记录清单（`provenance.knowledgeContext`），轨迹新增 "Bind project knowledge"。
  - 知识审查：REVIEW_CRITERIA 改为整篇文档、Gate 依据在前（片段上限由 8 提到 32，字符总预算 24,000 不变），并加入项目说明。
  - 编码简报：知识引用限定为适用 build 阶段的文档（只改一行，完整改造留在 K3）。
  - 本仓库 10 份知识文档补了 `stages`/`gate`，`packages/shared/src/fixtures.ts` 同步。
- **结果**（`docs/engineering/evidence/knowledge-context-resident-20260929.json`）：索引 10 份文档、30 个片段；required 与 available 召回率均为 100%；24/24 场景的 Gate 检查恰好正确；各阶段治理检查数 0 / 0 / 0 / 1 / 1 / 1（K1 入库时方案评审为 1，2026-09-30 按差异 2 改为 0）；单阶段知识上下文最大 11,043 字节（accept），低于 24 KiB 预算。`scripts/knowledge-context-evaluation.test.ts` 把这些条件固定进 `corepack pnpm test`。
- **与方案的差异**：
  1. `gate` 除 `true`/`false` 外也接受阶段列表。原因：测试证据规范要在设计阶段注入，但只在测试阶段作为 Gate 依据。
  2. 本仓库测试证据规范的 `gate` 为 `[test]`。K1 入库时设为 `[design, test]`，以保留改动前"严格策略下方案评审 Gate 缺测试证据即阻断"的表现；2026-09-30 用户决定改为只在测试阶段检查，因为方案评审时还不可能有测试证据。影响：
     - 严格策略下，方案评审 Gate 不再因缺测试证据而阻断；缺少门禁审查时仍然阻断。
     - 方案评审的 REVIEW_CRITERIA 里，这份规范仍整篇注入，但不再排在最前，也不带 `[Gate criteria]` 标记。
     - 确定性假提供方对方案评审 Gate 不再给出"Gate requires reviewer evidence"风险，本仓库样例的审查级别由"警告"变为"信息"。
  3. 桌面端的本地项目没有 `knowledgeBasePath` 字段（该字段只属于团队项目，且默认值是 `docs/<slug>/`），所以本批统一使用 `docs/knowledge`。2026-09-30 用户决定暂时保持固定；按项目配置知识目录需要本地项目设置，另行处理。
  4. 没有声明 `gate` 的项目不再产生知识治理检查（第 0 节决定 2 的直接后果）。

### 11.3 K2 结果

- **已完成**：
  - 只读阶段 Agent 在有已保存提供方绑定时使用隔离的 OpenCode 配置目录（独立 XDG 目录与 HOME，关闭 Claude 兼容和默认插件），运行结束后删除。探针结果：仓库 `AGENTS.md` 仍进入请求，上表所有用户全局来源均不再进入。`corepack pnpm test:knowledge-context-opencode-probe` 在出现泄漏时以非零退出。
  - OpenCode 编码引擎使用按项目固定的隔离配置目录（位于桌面用户数据目录），但**不移动 HOME**，因为编码运行里的 shell 命令需要用户的工具链。因此 `~/.agents/skills` 的技能描述仍可能进入编码运行，而技能调用本身被权限规则拒绝。编码引擎这条路径没有做运行时探针，结论依据的是与阶段 Agent 相同的加载机制（推断）。
  - 引用校验新增：行号范围必须落在文件实际行数内。
- **知识审查 local-agent**：2026-09-30 补上，是 #191 之后单独的批次，见 11.7。
- **已知限制**：仓库绝对路径仍由 OpenCode 发给提供方（见 11.1）。

### 11.4 验证

- `corepack pnpm verify`（2026-09-30，rebase 到 main `a10625d` 之后，含测试证据规范改为 `gate: [test]`）：类型检查通过；330 个测试文件通过、1 个跳过，4,491 个测试通过、15 个跳过；跨平台检查通过。rebase 之前在旧 main `f0fad85` 上为 4,486 通过、15 跳过（改动前基线 4,462 通过、15 跳过）。
- `corepack pnpm test:electron-smoke`：rebase 之后重跑，通过（隔离临时数据、假提供方）。
- `corepack pnpm test:workbench-conversation-electron-smoke`：rebase 之后运行，通过（隔离临时数据，本地受控模型服务，`externalProviderCalled: false`）。
- 探针与评估：`corepack pnpm test:knowledge-context-opencode-probe`（需要本机 OpenCode 1.17/1.18）、`corepack pnpm knowledge:evaluate`。
- 未运行：真实模型调用（包括 `test:stage-agent-opencode-smoke`，需要显式授权的提供方与预算）、界面走查。知识页的展示改造属于 K4；S6 已合入 main，K4 可以基于本分支进行。

### 11.5 K4 结果

- **实现**：
  - `packages/shared/src/knowledge-checks.ts`：确定性检查，不调用模型，也不阻断任何步骤或 Gate。
    - 缺少 front matter：文件开头没有，或没有结束的 `---` 行。
    - `stages`、`gate` 中不是阶段的取值。解析时这些值会被忽略，作者此前看不到。
    - 相对链接和锚点：链接按 GitHub 的规则解析（相对文档，`/` 开头相对仓库根）；锚点取标题 slug 与 `<a id>`/`<a name>`；代码块和行内代码里的不算。
    - 超出预算：某阶段适用的文档超过 24 KiB，或项目说明超过 32 KiB。
    - 上下文清单中记录过、当前知识目录里已没有的文件（包括项目说明）。
  - `summarizeKnowledgeStageBudgets`（`knowledge-context.ts`）：与阶段提示词相同的组装逻辑，知识页的用量表和预算检查共用。
  - 桌面索引新增 `linkTargets`：知识文档链接到、但不在索引里的仓库路径。不跟随符号链接；Markdown 目标用同一个安全读取函数列出锚点。最多 256 个目标，其中最多 64 个读取锚点。`linkTargets` 不计入 `contentHash`，所以链接目标变化不会触发 Gate 重新评估。
  - 知识页（`KnowledgeView.tsx`）新增「知识目录」区：
    - 项目说明的文件、大小和上限，摘要放在「详情」；
    - 各阶段注入的文档数、Gate 依据数和用量；
    - 检查结果，写明只用于提示，原始检查代码放在「详情」；
    - 每份文档的适用阶段与 Gate 依据阶段（未声明 `stages` 时注明按分类推定）。
    - 知识目录为空时，用一行说明代替六行全零的用量表。
  - 上下文清单取自当前项目任务的阶段 Agent 轨迹（`executorProvenance.knowledgeContext`）。
- **结果**：本仓库 `docs/knowledge` 没有检查问题（1 处链接已核实，0 处未核实），由 `scripts/knowledge-context-evaluation.test.ts` 固定。
- **与方案的差异与限制**：
  1. "清单里的文件已被删除"对照阶段 Agent 的清单；K3 之后也对照编码回执的清单（`contextReceipt.knowledgeContext`，见 11.9 之后的补充）。知识审查记录的 `knowledgeCriteria` 不是同结构的清单，不纳入。
  2. 索引达到上限（`truncated`）时不做已删除文件检查，因为缺失可能只是没有进入索引。
  3. 符号链接、特殊文件和超出数量上限的链接目标计为"未核实"，不报断链；目标文档锚点超过 1,024 个时不检查锚点。
  4. 超出仓库根目录的相对链接按断链报告。
  5. 阶段名沿用任务页的显示名，测试阶段显示为「测试证据」。
  6. 界面改动在 `KnowledgeView.tsx`，没有改 `DesktopViews.tsx`。第 6 节"涉及 `DesktopViews.tsx`"的预估不准确。
- **界面检查**：用基线工具的 `doc-tour` 样例在隔离环境截图，尺寸为 1440×742 浅色和 1024×742 深色。为了截到有文档和检查问题的状态，临时给样例仓库加了两份知识文档（其中一个非法阶段、一个断链），截图后已还原，截图没有入库。模型调用来自确定性假提供方。

### 11.6 K4 验证

- `corepack pnpm verify`（2026-09-30，`feat/knowledge-page-k4`，基于 main `b79a910`）：类型检查通过；332 个测试文件通过、1 个跳过，4,512 个测试通过、15 个跳过；跨平台检查通过。
- 新增测试：`knowledge-checks.test.ts`（10 项）、`knowledge-directory-view-model.test.ts`（6 项）；`KnowledgeView.test.tsx` 增加 3 项；`repository-knowledge.test.ts` 与 `knowledge-context-evaluation.test.ts` 各增加 1 项；`App.test.tsx` 的知识页用例增加断言。
- `corepack pnpm test:electron-smoke`：通过。隔离临时数据、假提供方，新增知识目录与检查结果的断言，走真实主进程索引。
- `corepack pnpm test:workbench-conversation-electron-smoke`：通过，使用本地受控模型服务，`externalProviderCalled: false`。
- 未运行：真实模型调用、可用性走查。

### 11.7 知识审查 local-agent 结果（K2 剩余部分）

- **实现**：
  - 设置 › 模型与执行方式新增「门禁审查方式」：只依据材料与知识目录（默认，一次模型调用），或 OpenCode 读取仓库核对。选择保存在本机设置 `knowledgeReviewExecutor`，任务页首屏不加控件。
  - 主进程用所选的已保存 Provider 启动一次只读 OpenCode 会话，沿用阶段 Agent 的做法：
    - 只允许 read、glob、grep、list；
    - 使用隔离的 OpenCode 配置目录与 HOME；
    - 每轮模型调用都经过项目预算中继，一次性预算批准编号会传给中继；
    - 会话结束后仓库的 HEAD、状态、差异与未跟踪文件必须不变；
    - 请求额外权限或产生改动时停止，不保存报告。
  - 提示词：直接调用时的审查提示词原样放在最后，前面加上只读仓库的说明和 `repositoryFindings` 的格式。仓库引用按本机文件字节计算 sha256，并检查路径与行号范围，结构校验复用阶段 Agent 的 `validateRepositoryFindings`。
  - 审查结论先经过与直接调用相同的结构校验（`normalizeKnowledgeReviewProviderOutput`，从 OpenAI 兼容 Provider 中抽出），再走现有的新鲜度检查、审计与产物保存。Gate 建议仍然只警告。
  - 审查记录新增 `executorKind` 与 `repositoryFindings`，只有 local-agent 执行时写入；直接调用即使输出里带了仓库事实也会丢弃。用量记录的 `executorKind` 相应为 `local-agent`。
  - 任务页的门禁审查面板写明审查方式。OpenCode 审查的仓库事实与引用收在折叠区，注明"只作补充说明，不作为 Gate 依据"。
  - 失败原因写成中文，包括：未检测到 OpenCode、请求额外权限、仓库在审查期间变化、仓库引用无法核对、工具调用超限、超时与停止。选择 OpenCode 但当前 Provider 是演示用假 Provider 时，在任务页说明原因，不发起调用。
- **与方案的差异与限制**：
  1. 预算预检仍按直接调用的提示词估算，只覆盖第一轮；后续轮次由预算中继逐轮准入。费用未知时预检会直接阻断，所以没有把整次审查标成"费用未知"。
  2. OpenCode 审查超时为 240 秒（直接调用由 Provider 的请求超时决定）。
  3. 仓库事实只保存在本机审查记录里，不随审查摘要同步到团队；Web 端看不到。
  4. 仓库绝对路径仍由 OpenCode 发给提供方（同 11.1），探针再次确认。

### 11.8 知识审查 local-agent 验证

- `corepack pnpm verify`（2026-09-30，基于 main `c145f5f`）：类型检查通过；334 个测试文件通过、1 个跳过，4,524 个测试通过、15 个跳过；跨平台检查通过。
- 新增或改写的测试：
  - `knowledge-review-local-agent.test.ts`：共享层 4 项；主进程 6 项，使用临时 Git 仓库和注入的会话，覆盖引用摘要、权限请求、仓库变化、无法核对的引用、非法输出、停止与超时。
  - `knowledge-review-runtime.test.ts`：执行方式与确认时不一致时拒绝。
  - `ipc-contract.test.ts`：`executor` 与 `knowledgeReviewExecutor` 的解析。
  - `TaskWorkPanel.test.tsx`：审查方式与仓库事实的展示。
  - `App.test.tsx`：在设置切换方式后，任务页的审查请求带上 `executor: 'local-agent'`。
  - `main-repository-knowledge-wiring.test.ts`：断言执行方式随知识快照一起传入审查运行时。
- `corepack pnpm test:knowledge-context-opencode-probe`：通过。新增 review 场景，本机 OpenCode 1.18.15 与本地假模型服务：
  - 审查会话加载了仓库 `AGENTS.md`，用户全局说明与技能都没有进入请求；
  - 请求里带有只读说明和原审查提示词；
  - README 引用得到 sha256 摘要。
  - 探针用假模型服务代替预算中继，所以预算准入不在这一项的覆盖范围内。预算中继本身沿用阶段 Agent 已有的实现。
- `corepack pnpm test:electron-smoke`、`test:workbench-conversation-electron-smoke`：通过（隔离数据、假提供方，`externalProviderCalled: false`）。两项冒烟都使用默认的直接调用方式，没有在 Electron 窗口里跑 OpenCode 审查。
- 未运行：真实模型调用（第 3 条待定）、Electron 窗口中的 OpenCode 审查走查。

### 11.9 K3 结果（编码简报与讨论栏）

- **与记忆线的关系**（2026-09-30 逐文件核对 #193、#196）：
  - #193 重写了 `native-coding-executor-v2.ts` 的提示布局（三阶段共用固定 system prompt，user JSON 以 `stateVersion → brief` 开头），但没有改编码简报的生成（`coding-agent.ts`）、回执类型（`execution-context.ts`），也没有改讨论栏的工具说明与 `knowledge` 处理。
  - 所以 K3 的简报与讨论栏部分不依赖它；只有"项目说明在 Native v2 提示里放在哪"一处要等它合入。
- **编码简报**：
  - `knowledge` 来源改为 `assembleKnowledgeStageContext`：适用 build 阶段的规范整篇放入，其余列目录。简报总上限是 24,000 字节，所以知识单独限 8 KiB（`CODING_BRIEF_KNOWLEDGE_BUDGET_BYTES`），不沿用阶段提示词的 24 KiB；超出的文档只列目录，执行器可以在工作树里读。
  - 项目说明按执行器分三种（`codingBriefKnowledgeDelivery`）：OpenCode 自己从工作树读 `AGENTS.md`，简报只记录（`executor`）；Native v2 不读，简报带上正文，上限 8 KiB（`devflow`）；无费用的假引擎两者都不给（`none`）。
  - 回执 `CodingContextReceipt` 新增 `knowledgeContext`（上下文清单），执行开始事件里记一行摘要。清单只作记录：知识之后变化不会让进行中的运行失效，这与记忆不同。
  - 没有传入知识时仍用原来的引用行（兼容旧调用方）。
- **Native v2 的项目说明**：Native v2 通过简报拿到项目说明，没有改 `native-coding-executor-v2.ts`。K3 时曾打算在 #193 合入后把它移到 user JSON 中 `brief` 之前，让同一项目的不同任务共享缓存前缀。#193 合入后（2026-09-30）用它的真实 DeepSeek 证据（`prompt-cache-live-20260930.json`）核算，**决定不移**：
  - 同一次编码运行里，analysis、initial、repair 的 `brief` 完全相同，项目说明已经随 `brief` 命中缓存（#193 证据中 initial 调用命中 1,152–1,280 tokens）。移动只影响每个新编码运行的第一次调用。
  - 本仓库 `AGENTS.md` 约 730 tokens；按 `deepseek-flash` 未命中 $0.30/M、命中 $0.006/M 计，每个新编码运行约省 $0.0002。
  - 代价：执行器请求的 `contextDigest` 目前只对简报求摘要，移出后要给项目说明另加摘要并改执行器契约；还要改 ADR 0024 第 1 节刚用真实模型验证过的 user JSON 顺序。
  - 如果以后项目说明明显变大（接近 8 KiB 上限）或编码运行变得很频繁，再按同样方法重算。
- **讨论栏**：
  - `knowledge` 工具拆成 `knowledge_list({stage?,offset?})`（知识目录：适用阶段、Gate 依据阶段、摘要、字节数、摘要哈希，以及项目说明文件）和 `knowledge_read({path,offset?,limit?})`（按路径分页读一篇或项目说明，正文脱敏）。按关键词找仍用 `repo_search`，提示词里写明了。
  - 读取知识目录以外的路径会拒绝，并指向 `repo_read`。
  - 旧的 `knowledge({query})` 不再出现在提示词和 MCP 工具列表里，但仍可调用，这样已有的工具观察可以按相同 name 和 args 重新查询（#193 的降级占位规则）。
- **未做**：编码简报没有真实模型的前后对比。
- **补充（K3 合入后）**：知识页的"文件已删除"检查同时对照编码回执中的上下文清单（`recordedKnowledgeManifests` 增加 `codingRuns` 参数，按 Coding Run 的开始时间记录）。页面上的计数改为"份上下文清单"，不再称为"次模型调用"，因为一次编码运行只有一份清单。

### 11.10 K3 验证

- `corepack pnpm verify`（2026-09-30，基于 main `b6ca57f`）：类型检查通过；335 个测试文件通过、1 个跳过，4,536 个测试通过、15 个跳过；跨平台检查通过。第一次运行时本机另有 vitest 进程占满 CPU，6 个测试超时（其中包括没有改动的 `apps/web`），单独重跑这些文件全部通过，随后完整重跑通过。
- 新增或改写的测试：
  - `coding-agent.test.ts`：简报整篇放入适用规范、其余列目录、三种项目说明方式、项目说明截断、未传知识时的兼容。
  - `coding-runtime.test.ts`：回执记录上下文清单；按执行器选择项目说明方式。
  - `workbench-knowledge-tools.test.ts`：目录、按阶段过滤与分页、按路径读取与脱敏、越界路径。
  - `workbench-mcp-bridge.test.ts`：工具列表只公开新的两个工具，旧工具仍可调用。
  - `workbench-conversation-service.test.ts`：模型按 `knowledge_list` → `knowledge_read` 调用，提示词不再列出旧工具。
- Electron 冒烟（隔离数据、本地受控模型服务）：
  - `test:workbench-conversation-electron-smoke`：通过。样例仓库新增 `docs/knowledge/cleanup.md`，模型改为先 `knowledge_list` 再 `knowledge_read`，并断言读到的正文；`externalProviderCalled: false`。
  - `test:native-coding-electron-smoke`：通过。样例仓库没有知识文档和 `AGENTS.md`，所以只证明简报改动后 Native v2 流程不受影响；项目说明进入 Native v2 简报由 `coding-agent.test.ts` 覆盖。
  - `test:electron-smoke`：通过。
- 与记忆线的兼容：与 #193、#196 的最新提交做了试合并，结果见 PR 描述。
- 未运行：真实模型调用。

## 参考

- [OpenCode：Rules（AGENTS.md 加载顺序、Claude Code 兼容开关）](https://opencode.ai/docs/rules/)
- [OpenCode：CLI 与环境变量](https://opencode.ai/docs/cli/)
- [Codex：AGENTS.md 发现规则与 32 KiB 上限](https://developers.openai.com/codex/guides/agents-md)
- [Anthropic：Effective context engineering for AI agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)

外部资料的内容已改写，以符合许可要求。

## 12. 交接：待决定事项与下一步（2026-09-30）

本节供接手的对话使用。完成后删除本节，结论并入第 11 节。

**当前状态**：K0–K4 已全部合入（#191、#194、#197、#198），#193 也已合入。Native v2 中项目说明的位置经核算不再调整（11.9）。剩下第 3 条真实模型验证中未覆盖的部分。ADR 编号为 0025，因为记忆学习那条线（`../ai-devflow-prompt-cache`）占用了 0024。

**用户决定**（erich04，2026-09-30）：

1. 测试证据规范改为 `gate: [test]`：**已改**，见 11.2 差异 2。`packages/shared/src/fixtures.ts` 与评估集中 6 个 design 场景的 `gate` 已同步。
2. 提交方式：rebase 到最新 main，重跑 `verify`，分批提交，推送并开 PR，CI 通过后合入。#191 按此方式合入；K4 沿用同一方式。
3. 真实模型验证：**部分覆盖，其余待定**。[#203](../validation/real-deepseek-flow-20260930.md) 在 main `b6ca57f`（含 K0–K2、K4 与知识审查 local-agent，不含 K3）上用 `deepseek-flash` 从需求澄清跑到 PR 交付包，最后一次完整通过。它走的是生产路径，知识上下文的组装代码都执行了。但按报告，示例仓库与工作区基线工具的 `health-api` 相同，而基线工具的示例仓库没有 `AGENTS.md` 和 `docs/knowledge`，组装结果为空；报告也没有检查提示词内容。所以知识注入本身没有被真实模型验证。仍未覆盖：带知识目录的仓库、OpenCode 阶段 Agent 与 OpenCode 门禁审查、K3 之后的编码简报与讨论栏知识工具。做法仍为两种：用户手动跑，或用户指定已保存的提供方和预算上限后由 Agent 在隔离数据中运行。
4. 下一批按 K4 知识页 → 知识审查 local-agent → K3 的顺序进行：**已全部完成**。K3 按用户 2026-09-30 的要求先做不依赖记忆线的部分，#193 合入后核算，项目说明的位置不调整（11.9）。
5. 本地项目知识目录暂时固定为 `docs/knowledge`，见 11.2 差异 3。

**注意**：只在本 worktree 中修改；不改 `../ai-devflow-studio`（主工作区）和 `../ai-devflow-prompt-cache`。跑开发服务或 Electron 前先检查 4310、4311、5173 端口是否被其他对话占用。
