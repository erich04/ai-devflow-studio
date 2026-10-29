# #226 内置仓库审查真实验收记录（2026-10-23）

## 当前结论

修复内置审查的逐轮工具提示后，**#226 的本次真实验收通过**：真实 Electron 在 OpenCode 探测为 unavailable 时完成 DeepSeek 内置仓库审查，保存三个源文件引用；独立宿主脚本重算了完整文件摘要、仓库摘要与行范围，全部匹配。前两次失败记录和费用保留，后续复现与修复复验均由负责人明确安排，没有无限自动重跑。

已通过的宿主检查：审查前后全部 9 个合成仓库文件的字节数和 SHA-256 一致，Git HEAD、工作树状态与 diff 摘要一致；没有 Coding Run；开发执行器始终为 `native-model`，审查方式为 `native-agent`；仍停留澄清 Gate，后续节点没有推进。

## 隔离环境与调用归属

- 本工作树：`devflow-b-opencode-20261023/ai-devflow-studio`。
- 证据目录（下文路径均相对于本工作树）：`.tmp/devflow-b-20261023/no-opencode-1792773287381/`。
- Electron profile 位于证据目录的 `profile/`，CDP `http://127.0.0.1:65175`；独立缺失的 `DEVFLOW_OPENCODE_BIN` 使该进程无法发现兼容 OpenCode，不卸载或改动主机软件。
- 团队项目 `p-b-readonly-1792773287381`；本地项目 `local-f465be8bdc6a`；Run `run-work-request-05f80d25d5c1e5d619c32fa58a0e6dce`。
- 真实 DeepSeek `deepseek-flash`，思考 enabled/low。使用同一个 B 人民币 8 元硬上限网关/账本；Web USD 项目预算保持启用。
- 入口是 Playwright 连接实际 Electron renderer、调用实际 preload/IPC；不直接改 SQLite、不伪造工作流状态。控制器动作后保存实际 UI 截图。验证 bootstrap 的密钥存储是隔离的合成凭据适配，不能据此声称操作系统钥匙串已验收。

## 第一次真实审查：失败已保留

父任务先生成澄清材料，产物保存在 `1792773664827-generate.json`。审查前固定全部源文件摘要和实际配置，审查期间独占网关调用，审查结束后再次取同一组宿主证据。

| 检查 | 实际证据 / 结果 |
| --- | --- |
| 前后源文件、HEAD、状态 | `native-review-before.json`、`native-review-after.json`，全部相等，工作树干净 |
| 无 OpenCode | 两份宿主快照中的 discovery 均 unavailable |
| 开发与审查独立 | 两份配置均为 coding `native-model`、review `native-agent` |
| 实际 UI 切换审查方式 | `native-review-method-independent.json/.png`：设置中选择 direct-provider 再选回 native-agent，每次重新读取的开发配置与切换前严格相等；未触发模型 |
| Gate 不自动推进 | 两份 Run 和所有节点状态严格相等，`paused_at_gate` / clarify Gate |
| 审查产物 | `agentReviews` 为空；没有可验证的引用报告 |
| 失败记录 | `1792774030267-review-failure.json`、`native-review-failure-events.json` |
| UI 截图 | `native-review-before.png`、`native-review-after.png`、`1792774030267-review-failure.png` |
| 失败费用不丢失 | `agentTokenUsage` 保存审查的 41,425 输入、2,046 输出 tokens；顶部显示 45,971，等于生成 2,500 + 审查 43,471 |

失败发生在通用 Provider 的 JSON 解码，现有证据不足以推断已进入引用/最终报告 schema 校验。宿主事件给出：`invalid_model_output` / `invalid_json`，HTTP 200、`finishReason=stop`，正文 304 bytes、思考 609 bytes，显式输出上限 65,536；末轮 response ID `e58b4df2-9086-44ff-a235-d5438ee5b575`。没有保存模型正文，不能从长度猜测具体错误。

该操作的共享网关账本 call IDs **7–13**，全部正常完成且 usage 完整，保守人民币费用 **0.099218 元**（高峰输入未命中单价计算，不扣缓存折扣）；并非一次失败操作只收费一轮。对应产品预算调用：

```text
model-call-42a12959-4d5a-415f-a22b-6bf1074605cb
model-call-f9456b2c-f141-4d6f-800c-1f1b3b4c85e9
model-call-253ae1bf-e184-42d6-8f56-189b62971463
model-call-776e374d-caf2-46f7-90e9-5779e376f036
model-call-456ba1be-379d-47fa-b634-c5b3a3036404
model-call-f7c03365-d389-4b91-abbc-67d5485e9b97
model-call-770a2f3d-7645-47e4-9e4f-e7ae3314e823
```

## 第二次真实审查：结构诊断复现

验证专用 `devflow-b-response-diagnostics.cjs` 可在明确启用的 no-OpenCode profile 中记录有界结构诊断：顶层键、repo 工具名、参数键名、JSON 有效性/位置、完整对象数及 finish reason。它不存正文、思考、路径参数值、任意自定义键、提示或凭据。SSE 读取用克隆响应，不改变产品输入或 Provider 解析。

`node --test scripts/devflow-b-response-diagnostics.test.mjs` 两项离线测试通过：敏感字面量/异常键不落盘，以及 SSE 分片诊断不消费产品响应。经负责人安排，在同 profile 重启 Electron 并做一次诊断复现；没有重启 API/Web、重建项目或重置账本。

本次账本 IDs **14–18**，29,423 输入、999 输出 tokens，保守费用 **0.066838 元**、unknown 0。`response-shapes.jsonl` 显示五轮响应中四轮分别包含 **5 / 2 / 2 / 4 个完整顶层对象**，JSON 解码失败位置为 51 / 52 / 72 / 58；唯一合法轮是单个 `repo_list` 请求。所有响应 `finishReason=stop`，SSE envelope 解析正常。故本次确定的问题为模型在同一响应拼接多个对象，不是输出被截断或宿主漏取流式片段。通用严格解析拒绝这些响应符合预期。

`native-review-diagnostic-before.json`、`native-review-diagnostic-after.json`、`native-review-diagnostic-summary.json` 保存独立宿主证据。全部源文件、工作流节点、执行器配置仍保持一致；失败保存于 `1792774557594-review-failure.json`，没有报告引用验收成功。

## 针对审查协议的修复与离线验证

`createLocalAgentKnowledgeReviewPrompt` 新增可选 `toolProtocol: 'native-json'`，由内置审查显式选择。默认 OpenCode 提示保持原行为。内置审查的提示现在使用真实的 `repo_list` / `repo_read` / `repo_search` 名称和参数要求，明确一个回合只能输出一个工具请求或最终报告、输出后停止等待宿主观察、多个文件分回合读取；重试纠正同样明确禁止拼接或批处理。内置审查必须读过至少一个相关文件并引用，移除该模式下“可省略仓库引用”的矛盾提示。

未改变通用 Provider 解析器、权限、引用校验或预算逻辑。新增回归将两个各自有效的工具 JSON 拼接后送入真实 Provider 解析代码：仍拒绝、两个工具都不执行；随后正确的单工具请求只执行一次，下一轮收到宿主实际文件内容，报告得到宿主计算的引用摘要；失败与成功轮的用量均计入。配合提示契约和既有未读引用拒绝测试，两个测试文件共 **8 项通过**；shared / desktop 类型检查与差异格式检查通过。这些离线结果与下一节真实验收分别记录。

## 修复后真实成功验收

重新构建桌面后，仅重启同一个 no-OpenCode profile，沿用原 Run、API/Web、数据库与账本。2026-10-23 17:02 UTC 发起一次审查，保存 `1792774953691-review.json`，Review ID `agent-review-review-request-723e266b-7374-40e9-bb97-f7f78bc28bf2-electron`。

结构诊断显示五个完整合法单对象回合：`repo_list` → `repo_read` → `repo_read` → `repo_read` → 最终报告。宿主内置审查只接受此前实际读过的文件，且完整读取摘要必须匹配最终文件；成功报告经过该校验。独立 `devflow-b-verify-native-review.mjs` 再从磁盘读取文件，重算整个工作树摘要和以下引用：

| 文件 | 引用行 | SHA-256 |
| --- | --- | --- |
| `src/store.js` | 1–3 | `6ffd92ea878c6b7377e22d7c20b4aa9fd52680eaa56234fe9ffa39bb94115ff3` |
| `src/app.js` | 2–5 | `22eb3038172510be09aba9ace838ed2a3e9003d9b846b6eb281739bdda03a1b0` |
| `test/store.test.js` | 1–2 | `3cc766ba7ca0f51aa5daa31781e73567e3d645fba136d9c599713ce07b8fa78b` |

这些行实际分别包含新增/切换/删除三个函数、localStorage 回退和渲染回调、三个操作的断言。模型对风险和材料完整性的意见仍属于建议；本验收证明实际读取、证据绑定与只读边界，不将其结论当作 Gate 批准或已经运行测试。

`native-review-fixed-before.json` / `native-review-fixed-after.json` 验证：全部九文件、HEAD、Git 状态和 diff 摘要相同；Run 和所有节点状态相同；没有 Coding Run；开发执行器配置严格相同，仍为 `native-model`；OpenCode discovery 仍 unavailable。独立核验保存为 `native-review-success-verification.json`。

账本 call IDs **19–23**，32,138 输入、4,332 输出 tokens，保守费用 **0.098932 元**，与产品返回 usage 和五个 budgetAttemptIds 一致：

```text
model-call-b3d55b69-5ca6-48ec-bc90-4a18c7d87f96
model-call-1027ace7-a6b3-4f47-bce0-6eccaf1c14f3
model-call-592bc5ef-93cc-4e31-9504-bf730b8de609
model-call-50676ccf-2ea1-4e00-af80-fe489de3c529
model-call-154a709d-f7b7-4ee1-ace3-af5bff9d8b9f
```

任务顶部实际显示 **112,863 tokens · 预计 $0.016**，与四条本任务 usage（一次生成、两次失败审查、一次成功审查）之和一致；产品 USD 估算包含缓存折扣，不等同于网关人民币保守价。三次审查共保守 **0.264988 元**，均已计入既有 B 8 元账本，没有另开额度。

实际 UI 截图为 `native-review-success.png`、`native-review-success-findings.png`、展开事实与引用的 `native-review-success-citations.png`，可见仍待确认的 Gate、累计用量，以及“内置审查读取仓库核对 · 核对 3 项事实，引用 3 个文件”。保存的报告、状态与引用仍可在同一 profile 回读。
