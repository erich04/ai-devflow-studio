<a id="adr-0025-resident-knowledge-context"></a>

# ADR 0025：项目说明与知识目录常驻上下文

- 状态：已接受（Accepted），2026-09-29。实施分批见[知识上下文改造方案](../plans/knowledge-context-redesign-2026-09-29.zh-CN.md)。
- 取代：ADR 0007、0008 中以词法命中片段作为审查依据的部分；搁置 ADR 0017 的混合检索接入（表与契约保留）。
- 保留：ADR 0002（Git Markdown 为权威来源）、ADR 0007 "检索结果不是治理证据"的原则、ADR 0011（Markdown 不离开桌面）。

<a id="context"></a>

## 背景

运行时知识来自整仓 Markdown 的词法检索：不计词频与逆文档频率，按连续汉字整段切词，取前 3 个片段。K0 用 24 条中文场景评估，"应适用的规范"召回率为 23.3%；需求确认 Gate 的治理检查列出 163 份文档，其中大部分是方案和验证报告。

K0 另外实测（OpenCode 1.18.15，本地假模型服务）：只读阶段 Agent 的 OpenCode 会话会加载仓库根目录的 `AGENTS.md`，同时带入用户全局的 `~/.config/opencode/AGENTS.md`、全局 `opencode.json` 的 `instructions`、`~/.claude/skills` 和 `~/.agents/skills`；只隔离 XDG 目录时，`~/.claude/CLAUDE.md` 仍会进入。同一任务换执行器，模型拿到的规范不同，DevFlow 也不记录。

<a id="decision"></a>

## 决策

1. **L0 项目说明**：仓库根目录的 `AGENTS.md`（没有时用 `CLAUDE.md`），上限 32 KiB。Direct Provider 与 DevFlow 自有提示词由 DevFlow 注入；OpenCode 自行加载，DevFlow 只记录摘要。有已保存提供方绑定时，OpenCode 使用隔离的配置目录：只读阶段 Agent 同时隔离 HOME；编码引擎保留 HOME，因为 shell 命令需要用户工具链，`~/.agents/skills` 的技能描述因此仍可能出现，但技能调用被权限规则拒绝。
2. **L1 知识目录**：只索引项目知识目录（`knowledgeBasePath`，默认 `docs/knowledge/`）。front matter 新增 `stages`（适用阶段）与 `gate`（`true`、`false` 或阶段列表，默认 `false`）。按阶段整篇注入，超出预算的降为目录。没写 `stages` 的文档按 category 推默认阶段。
3. **Gate 治理检查**只针对 `gate` 覆盖当前阶段的文档。测试规范按测试证据判定满足或违反的规则不变。
4. **L2 现场检索**：能调用只读工具的执行器自己读知识与代码；引用继续按本地字节计算 sha256 校验，只作补充说明，不作为 Gate 判定依据。
5. **上下文清单**：每次组装记录 L0、L1 的路径、字节数、摘要、是否截断与预算使用，写入轨迹。
6. 不引入向量索引、嵌入模型、GraphRAG 或代码索引；不用 LLM 改写知识。Web/API 端这一版不同步知识。

<a id="consequences"></a>

## 后果

- 同一阶段在各执行器上拿到相同的项目说明与规范，结果可复现并可审计。
- 知识作者需要维护 `stages` 与 `gate`；未声明 `gate` 的项目不再产生知识治理检查，严格策略里依赖治理检查的阻断只对显式声明的规范生效。
- 每次调用多出几 KiB 到二十几 KiB 输入，由阶段预算与稳定前缀下的 prompt cache 控制。
- 仓库 `AGENTS.md` 是提示注入面：能提交代码的人可以影响模型行为，但不能扩大 DevFlow 或 OpenCode 的权限。
- OpenCode 会在自身环境说明中发送仓库绝对路径，这是外部工具行为，DevFlow 的脱敏无法覆盖；记录为已知限制。
