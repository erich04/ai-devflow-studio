# #231 原生会话与提案核对验证

日期为 2026-10-10（America/Chicago）；真实端点报告时间为 2026-10-11 UTC。基线 `b6ca31e2e85359d0ddcbcc3937320030eb517c5d`，分支 `codex/issue-231-native-conversations`。Node 24.18.0、pnpm 9.15.0、macOS arm64。决定与启用方式见 [ADR 0028](../adr/0028-native-conversations-and-proposal-review.md)。

## 隔离与证据范围

本次没有修改用户正在使用的 Run、原始需求、正式材料、Gate 或账单，没有重启部署中的 Electron/API/Web。确定性测试使用临时仓库、SQLite 和本地模型端点。真实端点使用已授权的官方 DeepSeek `deepseek-flash` 凭证，凭证仅在 Electron 内解密；来源数据库只读，运行采用临时 profile、合成任务和单独账本。每次探针上限 $1、最多 64 次请求，未知费用保留全额预留。

测试不是用户原现场的逐字重放，也不能证明原历史失败都源于 JSON 格式。原场景的两类文档变更用于构建隔离样例。

## 确定性验证

| 检查 | 结果 / 覆盖 |
| --- | --- |
| 原生 Provider 与 SQLite 主进程测试 | 普通 Markdown/JSON 示例、完整线上请求预检、长参数、Thinking 多轮/重启、候选先保存、核对重试、两次恢复额度重置、人工确认、原文保留及压缩、整批越界拒绝、未知目标修正、幂等工具恢复、并发来源变化拒绝 |
| `corepack pnpm verify` | 最终完整重跑通过：全仓类型检查、373 个测试文件 / 4,902 个用例通过、2 个 Postgres 条件测试文件 / 16 个用例跳过、跨平台检查通过 |
| `corepack pnpm test:e2e` | 46 通过，1 项可选截图任务跳过 |
| `corepack pnpm test:electron-smoke` | 通过：真实 Main/IPC/SQLite、任务/流程/审查/权限/重启 |
| `corepack pnpm test:native-coding-electron-smoke` | 通过：共享 Provider 变更后的编码与只读仓库审查回归 |
| `corepack pnpm test:workbench-conversation-electron-smoke` | 通过：原生工具、候选核对失败、展开保存确认、勾选人工确认、保存无额外模型调用、Run 不变及重启；端点为本地夹具 |
| `corepack pnpm build` | 最终工作树全仓生产构建通过，包含共享包、API、Worker、Web 及 Electron Main/preload/renderer |

源码中固定了 Cursor 发现的两个交界场景：错误结果已落盘但检查点滞后、候选保存失败后重试/换 Provider，以及来源在服务层校验通过之后、SQLite 持久化之前更新。断言为每个工具 ID 只有一条结果，恢复不重新生成已存在候选；来源过期不生成讨论提案产物。

补充的保存/重新核对交错测试验证：已保存候选的排队核对被拒绝，原核对状态保留，没有新的模型调用。第一轮全量验证发现旧接线测试把构造参数字段顺序写死；已改为检查 `store`/`memory` 连接关系并重跑，没有删除该行为断言。

随后一次全量运行有两个原有 `App.test.tsx` 创建任务用例超过默认 5 秒限制（其余 4,900 个测试通过）。不改代码、超时或断言，单独重跑这两个用例均通过，测试部分合计 270 毫秒；当时主机还有其他高 CPU 进程，但没有足够证据把超时明确归因于某个进程。该次失败记录保留。最终完整重跑 `corepack pnpm verify` 通过，其中 `App.test.tsx` 全部 174 项通过；没有放宽全局超时或删减测试。

## 真实 DeepSeek 端点

逐请求用量、状态、费用与各探针的原始通过标记保存在[脱敏证据 JSON](evidence/issue-231-native-live-20261010.json)。费用由提供方返回的最终 usage 与项目定价函数核算，不是供应商账单对账结论。

| 模式 | SSE | 非流式 | 验证内容 |
| --- | --- | --- | --- |
| Thinking 关闭 | 通过 | 通过 | 两个用户轮次，每轮原生查询后返回普通文本 |
| low | 通过 | 通过 | 同上，保留完整 Thinking 工具历史 |
| high | 通过 | 通过 | 同上 |
| max | 通过 | 通过 | 同上 |

8 格共 32 个真实请求全部完成。没有套用正文 JSON，也没有把调用工具成功当作最终答复完成。

两种提案路径：

1. **空状态条件 + npm test 基线**：读取正式材料、生成候选、独立核对通过、保存待评审提案。保存不再调用模型，原 Run 不变。
2. **方案摘要 + 阅读提示**：简化的正式材料夹具本来缺少原始需求的一些条目，核对返回真实 `missing`，状态为 `needs_revision`。候选及意见保留；显式人工确认后保存成功，未伪装成 AI 通过。随后以较小的探针上下文触发一次历史压缩，再次原生查询并回答成功，旧原文仍保留。

共计 **51 次真实请求**、51 笔最终用量、0 笔费用未知，按项目定价计算 **$0.051281148**。其中 2 次调用失败但返回完整 usage，均照常纳入用量和费用。原生协议没有消除所有输出长度或模型失败，也不会让失败调用变成免费。

### 中间失败与修正

- 首次探针 8 格通过，但整体报告 `passed=false`：后续服务场景的驱动从配置 JSON 读取了不存在的 Provider ID。两场景都在发送前失败，0 次请求。驱动已改为显式选择的 Provider ID；未把这次失败记成模型问题。
- 第二次探针的摘要场景错误地断言“必须 AI 通过”，遇到正确的 `needs_revision` 而失败；空状态场景通过。修正驱动为验证真实核对意见和人工继续路径，第三次摘要/人工保存/压缩场景通过。保留前两份报告的失败标记，没有改写成全绿。
- 首批 32 次报告没有保存 finish reason（驱动读取了错误层级）；最终 usage 和真实工具/文本断言完整。后续驱动已改为读取 `responseMetadata.finishReason`；不补造缺失字段。单次异常元数据也已补入驱动，供后续实验使用。
- 最后的线上请求序列化重构不改变实际字段；确定性测试断言预检序列化与真实 fetch body 完全一致，没有为这个重构重复消费同一整套付费矩阵。

## 重现入口

先选择已授权 Provider 的现有加密凭证库和 ID，不能把 API key 写进命令行。以下命令真实计费：

```bash
DEVFLOW_WORKBENCH_LIVE_DATABASE=/absolute/path/to/authorized/devflow.sqlite \
DEVFLOW_WORKBENCH_LIVE_PROVIDER_ID=provider-id \
DEVFLOW_NATIVE_LIVE_OUTPUT=out/native-conversation-live \
corepack pnpm test:native-conversation-live
```

仅运行两种提案可设置 `DEVFLOW_NATIVE_LIVE_PROPOSALS_ONLY=1`；指定 `DEVFLOW_NATIVE_LIVE_SCENARIO=0` 或 `1` 可只运行一种。输出目录包含脱敏报告、本次账本和合成提案；不会自动上传原始提示、推理或凭据。应为每次实验选独立输出目录，避免覆盖旧证据。

## 保留的边界

这些结果只支持官方精确模型 ID `deepseek-flash`。第三方兼容端点、DeepSeek Pro、其他模型和操作系统仍未做该协议矩阵。没有新增数据库迁移或改动用户进度；旧会话不自动转换协议。签名安装包、正式部署、用户真实六阶段交付不属于这份验证结论。

默认全量测试中需要独立 Postgres 的条件测试仍按测试配置跳过；本次没有修改 API 预算存储或再次宣称 Postgres 实测。Cursor 的发现按 ADR 中的接受/延后决定处理，顾问报告不代替本地与真实端点证据。
