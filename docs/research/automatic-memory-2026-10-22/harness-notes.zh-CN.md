# Agent / harness 自动记忆调研

调研日期：2026-10-22。范围：只读官方公开文档；未安装产品、读取用户记录或修改配置。

## 已实读的一手来源

- OpenClaw Memory overview：<https://docs.openclaw.ai/concepts/memory>。
- OpenCode Config：<https://opencode.ai/docs/config/>。

两页通过 `curl` 正常 TLS 校验获取，未使用第三方镜像。网页为滚动更新文档，本次未固定到源码提交。

## OpenClaw：自动积累与后台整理，并保留人工控制

其当前公开设计是多层 Markdown 记忆：用户偏好、精炼长期记忆、每日记录，以及可供检查的整理日志。

自动化有不同触发点：日常工作可写笔记；接近上下文压缩时默认执行静默 memory flush；默认的定时 dreaming 再筛选和整理长期内容。flush 是压缩前检查点，不能泛化为每轮结束都会执行。只读工作区不能执行普通文件型 flush，失败也不阻断压缩。

dreaming 先检查评分、召回频率和查询多样性，再由模型选择合并或替代；写入使用经验证的来源。来源不可信的候选被挡在长期晋升之外，决策不可用时回退到追加。普通自动写入无需用户逐条确认，同时用户可以自然语言要求“记住”。偏好改变应替代旧条目，避免保留相互冲突的有效指令。

注意：flush 的重复文本保护只防止重复整段/段落，不等于完整的语义去重或所有错误的自动修复。删除派生索引与删除源文件也不是同一操作。

来源对应章节：How it works、What goes where、Automatic memory flush、Dreaming、PostgreSQL memory search。

## OpenCode：确认有自动压缩，不据此推断自动长期经验

已实读配置页明确：`compaction.auto` 默认 `true`，上下文满时自动压缩；`compaction.prune` 当前默认 `false`，可以启用清理旧工具输出；`compaction.reserved` 用于预留压缩空间。

`instructions` 支持配置指令文件路径与 glob。文件型指令、保存会话和压缩都可以提供连续性，但单凭这些不能认定内置了跨会话的自动经验提取、冲突治理和长期晋升。

本次没有成功读取 Rules 文档及对应源码，不宣称“OpenCode 完全没有自动记忆”，也不以插件生态替代对默认核心的核验。

## Claude Code：本次访问不足，不填补未知

尝试了以下官方入口，均在 TLS 连接阶段失败或重定向后失败：

- <https://code.claude.com/docs/en/memory>
- <https://code.claude.com/docs/en/memory.md>
- <https://docs.anthropic.com/en/docs/claude-code/memory>
- <https://docs.claude.com/en/docs/claude-code/memory>

因此本笔记不据记忆写其自动保存触发点、默认状态或安全边界。OpenClaw 的官方导入说明提及 Claude Code 的 project auto-memory 目录，可作为存在该能力的旁证，但不能替代 Claude 自己的契约。

## 对 DevFlow 的设计启示（建议，不是已实现）

1. 采用“自动一般经验为主、人工主动保存为补充”的产品方向，不要求用户逐条点保存。
2. 区分自动采集和正式生效：合格、低风险、来源明确的一般经验自动晋升；业务约束、权限决定和有冲突的内容进入待确认流程。
3. 将触发器放在 DevFlow 宿主：聊天回合完成、编码验证完成、压缩前检查点。provider hook 是接入方式，不能代替宿主的范围、事实依据和一致性控制。
4. 复用 Hindsight 的提取与整理能力，DevFlow 保留来源、用户/项目范围、规则分类、确认与撤销决策；不要同时维护两套重复的语义提取器。
5. 后台记忆处理与主回答解耦，使用重试去重键、成本预算和可查看的处理记录。静默不等于不可见，用户应能查看、纠正、删除和关闭。
6. 不能只看检索命中率；同时评测“本不该记的内容没有被晋升”、业务规则是否正确路由、冲突是否被拦截、删除是否能阻止再次召回。

## 调研限制

`web__run` 连接失败；后续使用经批准的只读 `curl`。网络存在间歇性 TLS 错误，成功页面与失败页面分别记录。未完成对 Claude Code 全机制及 OpenCode Rules 的一手核验；未扩展到 Letta/Mem0，避免用不充分来源形成“全行业默认自动”的判断。
