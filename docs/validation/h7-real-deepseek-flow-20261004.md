# H7：真实 DeepSeek 完整流程回归 — 2026-10-04

H7 完成。包含 H5 补丁的候选版本从需求澄清走到 PR 交付包；真实调用验证了 #199 用量及预算去重、#200 思考开启时 Native 分析上限 4096。H6 的历史页面关闭未在本轮出现，仍不能据此关闭 #202。

## 版本与隔离

- 基线：最新主干 `8c6a501`；H6 调查提交 `722659d`；H5 补丁 `87c052c` 在当前 `codex/hardening-h7` 上对应 `5bd602b`。这些是本地候选提交，尚未推送或合并。
- 本机 macOS、Node.js 24.18.0、pnpm 9.15.0、Electron 42.11.6；使用重新构建的 Main/preload/renderer，未打包、未签名。
- 官方 `https://api.deepseek.com`，模型 `deepseek-flash`，思考 `enabled / low`。
- 每轮独立临时 Git 示例仓库、SQLite、档案注册表和内存版 Team API。没有复用已有项目、运行或数据库作为测试数据。
- 仅复用已保存 Provider 的加密凭据，使用原开发应用身份解密；密钥不经过 renderer、不打印或写入报告。源 SQLite 前后 SHA-256 一致。临时数据和服务已清理。
- 通过 renderer IPC 执行真实主进程路径；目录选择对话框返回隔离仓库。编码先读取精确差异，由执行者核对两个文件后按摘要批准；不是逐步手工点击 UI 的验收。

需求与 2026-09-30 基本相同：`health()` 新增调用时刻的 ISO `checkedAt`，保留 `status`；在 `src/health.test.js` 验证日期可解析及 ISO 往返一致；不加依赖、不改其他文件。

## 完整通过的第二轮

时间：2026-10-04 14:28:17–14:30:10 UTC。

| 步骤 | 结果 |
| --- | --- |
| 需求澄清 | 生成并保存澄清 v1 |
| 需求确认 Gate | 真实模型生成审查报告，生成报告不推进 Gate；随后按澄清版本批准 |
| 方案设计 | 生成完整设计材料，进入设计 Gate |
| 方案评审 Gate | 真实审查报告保存成功，随后按设计内容摘要和版本批准 |
| DevFlow Native | 分析和改码各调用一次；仅涉及 `src/health.js`、`src/health.test.js`；核对精确差异后批准，写入受管工作树 |
| 测试证据 | 编码运行内测试通过；测试节点再次运行通过、退出码 0；两份证据的适用性均为 `current`，保存代码指纹 |
| PR 交付包 | 生成包含变更、测试、策略和预算的交付包，停在准备 GitHub 交付；没有发布分支、创建远程 PR 或进入业务验收 |
| 生命周期 | 没有窗口关闭、渲染进程退出或子进程异常退出；页面仍能截图 |

实际实现：

```js
export function health() { return { status: "ok", checkedAt: new Date().toISOString() } }
```

原示例仓库保持初始内容，改动只在其受管工作树。新增测试验证字符串类型、`Date.getTime()` 非 NaN，以及 `parsed.toISOString() === checkedAt`。

## #199：逐笔核对用量与预算

- 第二轮 6 次 HTTP 模型调用全部为 200，`finish_reason=stop`，均有完整用量；没有模型重试。
- Provider 用量合计、本地任务合计、Team 项目汇总均为 **43,861 tokens**。
- Native 两次调用各保留一个不同的 `budgetAttemptId`，运行汇总也保留这两个编号，团队同步后没有再加一遍编码 tokens。
- 按同一峰时价格逐笔独立计算，6 次调用合计 **$0.029119188**；Team 项目金额和 `/api/runtime/budget/evaluate` 的 `currentSpendUsd` 均为相同值（浮点误差阈值 $0.000001）。没有再增加一份 Native 编码费用。

**价格口径**：现有团队调用结算使用 `estimateAgentTokenUsage(... worstCase: true)`，统一按峰时价估算；本地 Native 运行摘要使用调用时段价。这两种金额不应直接当作同一口径相减。团队金额是保守预算估算，不是 DeepSeek 控制台扣款凭证。

## #200 与 H5/H6

- Native 分析的真实 HTTP 请求明确包含 `max_tokens: 4096`、`thinking.type: enabled`、`reasoning_effort: low`；改码也为 4096。两次均自然结束，没有触发输出上限。
- 两轮共四次 Gate 审查成功，没有出现 #201 的格式失败；历史原文仍缺失，本轮成功不等于找到了历史失败的具体原因。
- 两轮完整流程没有出现 `settlement_sync_failed` 或页面关闭。H6 的故障注入结果见 [H6 记录](h6-settlement-electron-20261004.md)；#202 保持开放。

## 首轮校准与总费用

1. 隔离启动最初用了打包产品名称，保存于开发应用身份下的凭据无法解密；改为开发端 package 名称 `@ai-devflow/desktop` 后成功。这次没有发出模型请求，源数据库未改变。
2. 第一轮 6 次真实调用完成全部业务步骤，43,331 tokens 的三方核对通过；最终预算断言错误地与谷时价比较，脚本退出 1。使用这轮真实用量逐笔调用现有结算函数，结果全部等于峰时价，确认是验证脚本的价格口径错误。没有修改产品计价代码。
3. 修正断言并保留第一轮文件，用同一个累计账本再跑一轮，完整退出 0。没有把第一轮失败覆盖为通过。

两轮共 **12 次真实调用、87,192 tokens**。按峰时价累计估算 **$0.057449604**；本次为周末谷时，按公开价格和响应中的缓存用量计算约 **$0.028724802**。未访问供应商账单，实际扣款以其账单为准。[官方价格表](https://api-docs.deepseek.com/quick_start/pricing/)（2026-10-04 核对）。

Team 项目预算每轮为 $1、预警 $0.50；脚本另有跨轮共享的 $1 累计账本和最多 12 次请求限制，发起前按峰时价保守预留。未显式限制输出的请求按模型完整输出上限预留，未知用量保留预留额，不按零处理。

## 验证与复跑

桌面构建、专用 TypeScript 检查、`node --check scripts/hardening-live-bootstrap.cjs`、`corepack pnpm test:cross-platform`、真实完整回归通过。累计预算守卫还通过了不联网的受控检查：允许请求、用量计算、阻止其他主机、单次超额阻止和累计超额阻止。

H5 全套 `verify`、build、Web E2E、Electron smoke 结果见 [H5 记录](h5-review-json-20261004.md)。H6/H7 没有额外产品逻辑改动，不把这轮脚本验证宣称为再次运行了全部单元测试。

```sh
corepack pnpm --filter @ai-devflow/desktop build
corepack pnpm exec tsc -p tsconfig.hardening-smoke.json
# 以下为付费 opt-in；须先获得本轮项目、Provider 和预算授权。
DEVFLOW_H7_LIVE=1 \
DEVFLOW_H7_DATABASE='/path/to/development/devflow.sqlite' \
DEVFLOW_H7_PROVIDER='existing-provider-id' \
DEVFLOW_H7_LEDGER='/path/to/authorized-run/ledger.json' \
DEVFLOW_H7_OUTPUT='/path/to/authorized-run/attempt' \
corepack pnpm exec tsx scripts/hardening-live-flow.mts
```

编码阶段会停在 `native-coding:review-diff`。检查输出目录的 `preview.diff` 后，才将 `pending-approval.json` 中的对应摘要写入同目录 `approved-digest.txt`；不批准则五分钟后退出。预算账本跨同一授权下的多轮复跑复用，不能通过清空账本绕过累计限制。

本次本地证据在 `output/hardening/h7/`：第一轮 `report.json` 为失败；`verified-run/report.json` 为通过；共享 `ledger.json` 含 12 次调用的用量、状态码、结束原因和请求配置。`verified-run/` 另有精确差异、生成材料和最终截图。网络记录不含密钥、提示词、回答或思考正文；输出文件未提交。H7 不覆盖真实 Postgres、GitHub 发布、业务验收、OpenCode、Windows 或签名安装包。
