# 跨场景记忆方案：Cursor 调用状态与 Codex 自查

日期：2026-10-22。对应[方案草案](../../plans/memory-sharing-and-learning-2026-10-22.zh-CN.md)。

**结果：方案已细化，Cursor 外审尚未取得有效结果。下面的修订来自 Codex 源码自查，不是 Cursor 的意见。产品实现未修改。**

## Cursor 只读评审尝试

使用 [cursor-collab-review 技能](/Users/erich/.codex/skills/cursor-collab-review/SKILL.md)，模型固定为 `grok-4.7-xhigh`（Grok 4.7 Extra High，非 Fast），`--mode ask`，评审范围和禁止事项写在方案附录。

本机正常权限下，`agent status` 确认已登录，`agent models` 列出了指定模型。受限沙箱最初无法读取正常登录态，随后只读复核成功；没有重新登录、读取密钥或修改账号。

| 尝试 | 输入 | 实际结果 |
| --- | --- | --- |
| 第一次 | 初稿 v1 | 约 5.54 秒后连接失败；无 session ID、0 个 stream event、0 次工具调用 |
| 第二次 | 同一初稿 v1 | 约 5.58 秒后同样失败；无 session ID、0 个 stream event、0 次工具调用 |
| 第三次 | Codex 自查修订后的 v2 | 约 5.49 秒后同样失败；无 session ID、0 个 stream event、0 次工具调用 |

三次错误相同：`Client network socket disconnected before secure TLS connection was established`。对 CLI 帮助列出的默认服务地址 `https://api2.cursor.sh` 进行了不带凭据的 HEAD 连通检查；经过本机既有代理和一次直连检查均在 TLS 建连处失败。未改变系统代理、TLS 校验或模型。

CLI 返回没有模型会话及结果，因此没有 Cursor 的 verdict、阻塞项或建议可供处置。不能宣称“已经与 Cursor 讨论完成”“Cursor 通过”或“Cursor 拒绝”。三个 `*.attempt1.raw.json` 仅在本机审计归档保留经过技能包装器脱敏的终止记录，不随源码发布；文件名时间来自工具，本文日期按用户时区记录。

`input-manifest.json` 记录工作树 HEAD、初始相关源码摘要及两版方案摘要；`review-input-v1.zh-CN.md`、`review-input-v2.zh-CN.md` 是当时输入的原样快照，内部相对链接以原方案目录为基准。它们只用于审计，不作为最新方案。

## Codex 独立核对与修订

| ID | 发现与源码依据 | 处置 |
| --- | --- | --- |
| S1 | 聊天 `publish` 保存 `kind: log`，正文明确“待确认”；见 `workbench-conversation-service.ts` 的 `publish` | 采纳：方案第 4/5 节将业务规则送回正式需求/设计流程，经验使用独立人工确认 |
| S2 | 当前候选来源解析和 SQL 只认识 `agent_observation` / `coding_run`；来源 helper 返回 Runtime 风格标识 | 采纳：第 6.4 节覆盖严格解析、条件列、忽略记录、投影和附件；不伪造 Runtime；独立协调器附件暂不开放 |
| S3 | `authorize/commitAgentMemoryPromotion` 使用 Main 内部 capability；公开 durable 方法由代理串行包装 | 采纳：单次 UI 确认需要一个受控事务组合操作，复用校验核心；不依靠连续调用多个公开写方法假装原子 |
| S4 | 现有修订保持原 `sourceCandidateId`；Hindsight 按正式记忆来源和配置投影 | 采纳：聊天入口只修订原本的会话来源。跨来源修改暂不支持，避免聊天正文以旧 Coding 来源身份外送 |
| S5 | Team enqueue 当前特判排除 `coding_run`；新来源如果照默认分支可能进入不支持的路径 | 采纳：第 6.4 节要求明确来源允许列表；会话来源不进 Team 或 Hindsight，既有 includeMemories 不默许新增来源 |
| S6 | 会话只按配对身份或已附加 Run 创建者召回；生命周期人工动作本身也要求 Run | 采纳：首期写入明确绑定当前项目 Run；不通过 UI 当前卡片或某个其他 Run 猜用户；无任务身份另案设计 |
| S7 | 数据库写入和网络派发之间不存在原子事务；OpenCode 还有宿主不可见的内部模型回合 | 采纳：第 7 节区分准备、尝试发送、收到响应及发送结果未知；不宣称模型采纳；不自动重放不确定请求 |
| S8 | 现有聊天会丢弃可选记忆后再压缩历史；旧回执主要只有消息数量与预算 | 采纳：最终装配后生成实际来源清单，省略项不得列为已发送；保留原硬预算并测试序列化/转义开销 |
| S9 | 2026-10-20 小样本混合 Top1 低于词法，普通无答案也有误召回；未评生成答案 | 采纳：第 8 节将知识和长期记忆分别冻结评测，独立计分检索与答案；启用门槛是建议值，需用户 review |
| S10 | 草案初版的冲突结果与原子确认状态没有完全对齐 | 修订：冲突只返回预览且零写入；确认记录按 create/revise/reference_existing 区分；修订不留下无用途候选 |

## 延后项与理由

- 自动从全部聊天提炼长期记忆：增加噪声与来源判断成本；首期使用公开消息选取与人工确认，用户可直接 review。
- 无 Run 的永久本地身份：涉及独立身份绑定、历史记录归属与配对切换，不在经验入口内用启发式补齐。
- 跨来源合并：需重新设计每次修订的来源链及投影授权，暂不复用一个旧 candidate ID 隐藏来源变化。
- 写 Git 知识文件、团队共享、本体对象自动确认：各自需要明确写入与版本流程，不作为 P1 完成条件。
- 开启正式记忆 Hindsight hybrid：等待独立评测，不从知识文档的接线完成或小样本结果推断收益。

## 本轮验证范围

本轮只检查源码与文档：本地链接、方案一致性、旧文件摘要和 Git 暂存差异摘要。验证结果记录于 `document-checks.json`。

没有运行产品测试、构建、Electron、迁移、Hindsight 或 DeepSeek 实验。历史验证记录只是设计输入，不能作为拟议功能已经实现或已经测试的证据。Cursor CLI 的评审尝试不计作产品模型验证。

## 待完成的外审

网络恢复后，使用同一指定模型对最新方案发起新的只读会话（本轮没有可恢复 session），重点询问第 6 节事务/来源影响、第 7 节发送状态及第 8 节评测门槛；逐项独立处置返回意见。本轮不创建定时任务，也不实施方案。用户现在可以先 review 文档，外审未完成的状态必须保留。
