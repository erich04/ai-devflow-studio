<a id="工作台-deepseek-thinking-验证记录"></a>

# 工作台 DeepSeek 思考模式（thinking）验证记录

验证日期：2026-09-17（America/Chicago）。基线：`8cce39ada5499c158f5d84f8fc10d1ccc712679c`，本记录对应其上的未提交改动。

## 本次行为

- 工作台独立对话使用官方 DeepSeek Provider 时，发送 `thinking.type: enabled`、`reasoning_effort: low`，并以 SSE 接收返回内容。
- `reasoning_content` 在最终答案之前实时显示；生成时默认展开，结束后默认折叠，用户可重新展开。最终 `content` 继续通过现有结构化校验后显示为回答。
- 推理记录只持久化到当前本地会话，不进入其他会话、共享流程事实或后续请求历史。取消、断流及恢复后保留已收到的记录，并标记中断。
- 本次启用范围为工作台对话。需求澄清、方案设计、Gate Review 和 Coding 的独立生成调用保持原请求契约，并纳入回归验证。
- 输出 token 上限没有提高；`low` 相对更高推理强度降低计算投入，不代表比原来的关闭 thinking 模式更省 token。

参数依据：[DeepSeek 思考模式](https://api-docs.deepseek.com/zh-cn/guides/thinking_mode/)、[Chat Completion 参数](https://api-docs.deepseek.com/zh-cn/api/create-chat-completion/)、[JSON 输出](https://api-docs.deepseek.com/zh-cn/guides/json_mode/)。

## 自动化结果

10 个测试文件、144 个测试全部通过：

```sh
corepack pnpm exec vitest run \
  packages/shared/src/workflow-agent.test.ts \
  packages/shared/src/agent-review.test.ts \
  packages/shared/src/provider-error.test.ts \
  packages/shared/src/provider-reasoning.test.ts \
  apps/desktop/electron/workflow-runtime.test.ts \
  apps/desktop/electron/native-coding-executor.test.ts \
  apps/desktop/electron/native-coding-executor-v2.test.ts \
  apps/desktop/electron/provider-operation-guard.test.ts \
  apps/desktop/electron/workbench-conversation-service.test.ts \
  apps/desktop/src/WorkbenchWorkspace.test.tsx
```

覆盖内容：

| 范围 | 已验证 |
| --- | --- |
| Provider | thinking 与 low 参数；推理先于答案到达；分片 UTF-8、SSE、心跳与独立 usage 帧；JSON 降级响应 |
| 异常 | 截断、输出超限、无效帧、缺失结束信号、Provider 错误、取消卡住的读取；不把半截答案当成功 |
| 保存与隔离 | 实时事件与 SQLite 保存；重启恢复；取消后重试不重复用户消息；跨会话隔离；推理不回灌后续 prompt；分片凭据脱敏 |
| 对话界面 | 生成时可见；答案独立显示；完成后折叠和展开回看；会话切换隔离 |
| 需求澄清 | 产物、来源信息、保存提案上下文与只读证据；错误时不生成成功产物 |
| 方案设计 | 使用澄清上下文生成设计产物并衔接流程；输出校验与失败用量保留 |
| 其他流程 | Gate Review、Native Coding v1/v2、Provider 操作保护；可信流程状态转换、测试证据原子提交、交付和验收 |

Shared 与 Desktop 类型检查、Desktop 构建、`git diff --check` 均通过。构建仍有现有的大 chunk 提示；旧 Inspector 测试仍有 React act 警告，均未导致失败。

## Electron 验证

运行 `node scripts/workbench-conversation-electron-smoke.mjs`，使用隔离的临时项目和数据目录，通过真实 Electron Main、Provider 适配器、IPC、SQLite 和界面执行。

- 模型响应来自受控本地 SSE 服务；测试进程阻止外部 Provider 请求，不读取用户真实 API Key。
- 共 20 次受控请求。最终答案被测试服务暂缓返回，界面已先显示推理内容，再释放答案并检查结果。
- 检查六阶段中的全部 8 个节点、44 个详情页签，以及导航、历史恢复、会话隔离、取消与重试、主题和窄窗口。
- 通过报告：[`report.json`](../../out/workbench-conversation-qa/report.json)。
- 已目视检查实时推理截图：[`00-live-reasoning.png`](../../out/workbench-conversation-qa/00-live-reasoning.png)。图中的 `REASONING_LOCAL_ONLY` 是测试标记。

## 当前桌面与验证边界

DevFlow E2E 已加载新构建。通过桌面可访问性信息确认：原团队项目“中文任务清单”、筛选需求 Run、现有两轮聊天及 8,239 tokens 的历史统计仍在，Run 仍停留在需求澄清。

重启时旧进程未响应正常退出；确认无进行中的对话、无输入草稿并备份 SQLite 后，仅终止该已核验身份的旧进程，再使用原数据目录和配置启动。未代替用户发送消息、生成阶段产物或推进 Gate。

本次没有调用真实 DeepSeek 服务，未消耗其额度。以上结果验证协议处理、应用联动和生成流程回归；不等同于对新 thinking 配置完成了一次真实 DeepSeek 端到端业务运行。用户下一次发送对话时才会使用新配置，旧消息不会补出历史推理内容。
