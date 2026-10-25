# 自动记忆：调研结论与方案取舍

日期：2026-10-22。目的：响应用户“自动保存为主，业务规则/冲突才确认，保留主动保存”的要求，修订[实施方案](../../plans/memory-sharing-and-learning-2026-10-22.zh-CN.md)。本轮不改产品代码、不操作实际记忆库、不调用业务模型。

## 1. 核心结论

原方案把所有聊天经验都放到人工确认入口，操作负担过高。行业已有自动积累、后台整理与用户主动强调并存的设计，可以采用。需要区分三个不同问题：当前会话何时压缩、长期经验何时写入、什么内容能成为业务规则。

Hindsight 的集成层提供事件触发，服务端提供抽取和组织能力；DevFlow 可以复用后者并实现自己的宿主触发，无需让用户逐条保存。服务不会自行监听一个未接入的 Agent，也不会替 DevFlow 批准业务规则。

## 2. 取证范围与比较

| 对象 | 本次证据 | 可确认策略 | 对 DevFlow 的意义 |
| --- | --- | --- | --- |
| Hindsight coding-agent 集成 | 本机由官方 README 生成的技能说明；未确认运行插件版本 | hook 型宿主 Stop 写入；部分插件型宿主每轮 upsert，并以 idle flush 补最终答复；主动保存工具是补充 | 生命周期事件驱动自动写入；不同宿主并非完全相同触发粒度 |
| Hindsight 服务 | 先前下载、哈希与归档一致的固定 v1.0.0 OpenAPI | retain 提取、去重、关联；consolidation 创建/更新 observations；有独立删除 API | 复用语义能力；归纳、删除及应用生效分开 |
| OpenClaw | 本次实读官方 Memory 页面 | 自动笔记、压缩前静默 flush、后台 dreaming；人工自然语言“记住”仍可用 | 自动处理为主、分层筛选、可查看整理日志 |
| OpenCode | 本次实读官方 Config 页面；本机 Hindsight 技能另描述插件集成 | 核心自动 compaction 默认 true，当前 prune 默认 false；这两项不能直接证明长期经验学习 | 不把上下文压缩与跨会话记忆混为一谈；DevFlow 宿主统一学习即可覆盖 OpenCode 场景 |
| Claude Code / Codex / DeepSeek Harness | 本轮未得到足以核实其核心默认行为的当前官方资料 | 不作未经核验的默认触发/删除能力断言；Hindsight 技能提到的适配支持也不代表核心自带能力 | 不用“所有 Agent 都如此”作为设计理由；已有两种官方实读资料与锁版本契约足以支持本次方案取舍 |

一手来源：[OpenClaw Memory](https://docs.openclaw.ai/concepts/memory)、[OpenCode Config](https://opencode.ai/docs/config/)、[Hindsight 固定 OpenAPI](https://github.com/vectorize-io/hindsight/blob/39c65ffe2f140d0c84cee58566cad8900c5b9908/hindsight-docs/static/openapi.json)。本机说明：[hindsight-coding-agent SKILL.md](/Users/erich/.agents/skills/hindsight-coding-agent/SKILL.md)。

详细证据见 [Hindsight 笔记](hindsight-notes.zh-CN.md)和 [harness 笔记](harness-notes.zh-CN.md)。成功访问的网页是滚动文档，不伪称对应某个发布版本；固定 OpenAPI 是契约证据，不等于本轮服务实测。

## 3. 对“该存的存、该删的删”的修正

可以自动筛选、提取、去重、组织与形成更新的观察结论。不能据此承诺：

- 所有“不重要”的原始消息会被自动物理删除；
- 观察结论更新后，它引用的所有旧资料和备份都已删除；
- 各产品的 hook 都在同样的“每轮结束”发生；
- 服务能区分 DevFlow 的已批准业务要求和普通聊天中的提议。

因此将原始来源保留、正式经验有效期、归纳版本和用户遗忘分开建模，才有可验证的产品行为。用户无须逐条保存，并不意味着这些动作可以没有记录。

## 4. 推荐结构及备选取舍

推荐：**完成事件 → 持久任务 → Hindsight retain → 完成后列举结果 → 本地策略自动生效/例外确认 → 共用现有长期记忆召回**。

这样利用既有 Hindsight 和本地记忆两边的能力，不新建一套通用语义引擎，也不额外引入远端权威的记忆生命周期。一般经验自动生效，无需人工点击晋升；业务规则与冲突才进入确认。

采用固定文档/操作后读取 `memories/list`，而非用 recall 推断本次抽取结果；新增严格输出、分页和来源校验。fact ID 不假定跨重新抽取不变。不能可靠映射来源的事实暂不生效，并产生可诊断原因。

备选方案的取舍：

| 备选 | 本次决定 | 原因 |
| --- | --- | --- |
| 直接给 Native/OpenCode/聊天分别装写入插件 | 不采用 | DevFlow 已掌握更可靠的作用域、批准和完成事实；否则重复提取且难统一删除 |
| Hindsight 直接成为所有经验的唯一生效数据库 | 暂不采用 | 要另建本地与远端审批、墓碑和版本的一致性，改动比复用现有正式记忆更大 |
| 每轮 dry-run 抽取后再 retain | 不采用主流程 | dry-run 本身可计费且没有可恢复操作身份；再次 retain 可能重复抽取 |
| 首日开启全部 observations/reflect | 分阶段 | 多来源归纳增加撤销、来源映射和冲突验证工作；未确认 bank 不能直接供生产 Agent 消费 |
| 所有自动输出先让用户点确认 | 不采用 | 与用户明确选择的自动主流程冲突，只应确认例外 |

## 5. 旧方案变更清单

- “保存按钮是主入口”改为宿主完成事件自动学习，按钮和明确“记住”作为补充。
- `conversation_confirmation` 改为真实 `conversation_turn` 来源，人工/自动是 decision；不混淆内容来自哪里与谁决定生效。
- 无 Run 自由聊天的身份从 P3 提到首期，避免最常见聊天仍不能自动学习。
- “所有聊天来源不得上传 Hindsight”改为项目级单独选择来源并记录启用；既有授权不自动扩大。
- 当前确定性 Coding 学习保留，新增自动策略复用既有版本、墓碑、权限和召回。
- 新增可靠后台任务、原子 enqueue、崩溃恢复、费用准入与可观察状态。
- 手动保存可固定重要条目；自动整理不能删除人工固定内容，冲突不能静默覆盖。
- 评测增加误记、漏记、冲突、遗忘、重复调查与任务效果，不再只比较检索排序。

[旧版快照](previous-manual-first-plan.zh-CN.md)仅为历史留存，里面的相对链接保留原 `docs/plans/` 基准，不能作为现行导航；原 [Cursor 失败及人工方案自查记录](../memory-sharing-review-2026-10-22/disposition.zh-CN.md)保持不变。本版没有完成新的 Cursor 外审，也不把 Codex 的并行独立核对称为 Cursor 意见。

## 6. 本轮验证范围

本轮执行文档结构、链接和文件范围检查，结果见 [document-checks.json](document-checks.json)。未运行类型检查、产品测试、Electron、Hindsight 服务或真实模型实验。工作树原有的产品改动及暂存区不归属于本轮；用本轮开始时的文件哈希快照确认未改动它们。

网络方面：搜索工具连接失败，公开站点多次 TLS 失败，部分官方文档通过正常 TLS 的只读 curl 成功获取。一次扩大网络访问的自动审批超时后，依工具要求作一次只读重试，获准执行但仍遇 TLS 故障；没有以关闭 TLS 校验或修改用户网络配置绕过。DeepSeek GitHub 页面曾获取到 HTML，但未获得可复核的记忆内容，因此未用其作结论依据。
