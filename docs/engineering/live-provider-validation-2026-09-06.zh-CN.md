# 真实 Provider 流程验证记录 · 2026-09-06 / 07

状态：**进行中，尚未完成端到端交付验收。** 初轮在方案审查发现设计输出契约问题并修复。9 月 7 日恢复验证后，新 Run 已完成真实澄清及审查，Desktop 预算重启恢复已验证；随后 Mac 再次自动锁定。GitHub App 在线核验确认新仓库尚未纳入当前安装。本文不将单元测试中的假 Provider 或受控 smoke fixture 计入真实流程结果。

## 范围与环境

- 测试需求：只修改 mini Agent 的 README，在开头项目摘要段落之后插入指定的一句话；保留其他内容，运行 `corepack pnpm verify`，经产品 GitHub Delivery 交付 Draft PR，不合并。
- 隔离测试仓库：`erich04/devflow-mini-agent-live-20260906`，GitHub repository ID `1359740566`，从原 mini Agent 的 main 初始化。
- 原 `erich04/devflow-mini-agent` 仓库、历史 Run、已绑定的 Team Project 和原 Docker 服务保留。
- Team：真实 GitHub 登录 + 已有 API/Postgres Docker 服务。Web 修复经过生产构建验证，最终复测入口为 `http://127.0.0.1:4313`；它连接同一个真实 API。
- Desktop：实际 Electron main/preload，既有 local-development 数据目录，使用新导入的隔离 checkout。
- Team Project：`p-mini-agent-isolated-live-20260906`；Local Project：`local-151324aa88ad`。
- Provider：已保存的 DeepSeek direct provider，模型 `deepseek-v4-flash`；Coding Executor 已设为 DevFlow Native v2，使用同一 Provider。
- Team 预算：月限额 $1.00，预警 $0.50。测试命令已通过 Desktop UI 保存为 `corepack pnpm verify`。

## 已完成的真实操作

1. 通过 GitHub 正常登录 Team Web。
2. 从空表单新建 Team Project；刻意在另一窗口退出登录，复现旧会话提交失败，并验证修复后表单保留、登录恢复和同一 slug 只创建一次。
3. 导入独立本地 clone，用 Web 生成的一次性配对码完成 Desktop 与 Team Project 绑定。
4. 在 Team Web 创建 Work Request，从 Desktop Inbox 创建本地 Run，并将投影同步至 Team。
5. 真实 DeepSeek 生成需求澄清、执行需求门禁审查；检查结果后通过需求 Gate。
6. 真实 DeepSeek 生成设计，再由真实 Provider 进行方案门禁审查。审查指出设计重复澄清、缺少实施方案，保留该审查证据并修复产品代码。

Work Request：`work-request-b4312a53-770c-41d4-be1e-19edbd78cbc0`。

Run：`run-work-request-80b23c151926198ef4747666971cafb9`。

分支：`ai/work-request-80b23c151926`（由产品创建的工作流分支标识；Coding 尚未开始）。

### 真实调用记录

时间为 UTC；token 数来自 Provider response usage。应用记录的费用不等同于云端账单，因此这里仅列 token 证据。

| 阶段 | 时间 | 输入 token | 输出 token | 结果 |
| --- | --- | ---: | ---: | --- |
| 需求澄清 | 2026-09-07 04:41:34 | 401 | 841 | 生成澄清 v1 |
| 需求审查 | 2026-09-07 04:43:41 | 4804 | 694 | warn，非阻断，进入需求 Gate |
| 方案设计 | 2026-09-07 04:50:57 | 1483 | 878 | 生成设计，但内容复用澄清格式 |
| 方案审查 | 2026-09-07 04:52:16 | 4918 | 649 | warn，指出缺少实际实施方案；本轮按质量阻塞处理 |

对应审查 ID：`agent-review-review-request-1788756221705-electron`、`agent-review-review-request-1788756736221-electron`。完整原始需求、产物和脱敏 Trace 保存在该 Run 的本地数据与 Team 投影中。没有直接修改数据库来推进状态。

## 问题、修复与复测

| Issue | 问题与处理 | 验证状态 |
| --- | --- | --- |
| [#66](https://github.com/erich04/ai-devflow-studio/issues/66) | 会话过期创建项目触发整页异常。提取返回结构化结果的 Server Action 和表单，保留输入并提供新窗口登录入口。 | 真实过期会话、GitHub 重新登录、相同 slug 成功创建一次均已验证；API 未登录写入拒绝及客户端重试测试通过。 |
| [#67](https://github.com/erich04/ai-devflow-studio/issues/67) | 创建成功无反馈、列表不刷新。增加显式提交状态及结果，使用 Server Action revalidation，移除重复 refresh；生产 A/B 进一步确认移除根级 loading 边界后列表才正确更新。 | `Project Creation Final Refresh QA` 创建成功后，无手动刷新即出现项目、配对按钮与预算项目入口。保留正常页面及按钮反馈，根级加载占位移除。 |
| [#68](https://github.com/erich04/ai-devflow-studio/issues/68) | 第二个 Team Project 无预算配置入口。预算详情携带所选 projectId，配置页提供项目选择，并按项目重置面板。 | 真实新项目未沿用第一项目金额；保存 $1.00 / $0.50，生产构建中两次调整预警值后按钮均恢复“已保存”。 |
| [#62](https://github.com/erich04/ai-devflow-studio/issues/62) | Desktop 已保存预算但顶部 not loaded。将项目预算读写提升为共享 hook，区分策略加载/缺失/禁用/不可用与单次 Coding 预算决策，隔离项目和绑定的异步结果。 | 单元及 App 集成回归通过；9 月 7 日真实重启后，顶部显示“预算策略 已配置 · $1.00 / 月 · 预警 $0.50，预算评估 尚未执行”。新 Run 与 Agents 面板保持一致。 |
| [#69](https://github.com/erich04/ai-devflow-studio/issues/69) | 设计阶段只有澄清字段，导致模型重复需求。统一生成器与 Provider adapter 的阶段输出指令，设计必须返回实际 Markdown 正文，缺失或空正文报 schema_invalid。 | 真实失败证据已保存；输出契约、HTTP adapter 和缺失正文测试通过，真实重新生成与审查待解锁。 |

预算保存按钮持续 pending 与已关闭的 [#40](https://github.com/erich04/ai-devflow-studio/issues/40) 有关。本轮生产环境确认保存本身成功，而客户端 transition 未结束；以显式请求状态和 Server Action revalidation 修复并完成真实回归。

一次配对 401 来自测试操作重复使用已消费的一次性配对码，首次交换实际成功，后续同步正常。这不是产品缺陷，不计入 Issue。

## 9 月 7 日恢复验证

保留初轮 Run，重新通过 Team Web 提交 `README workflow note - verified design`，并从 Desktop Inbox 创建本地 Run：

- Work Request：`work-request-010522fc-b32a-4a5e-b8cf-4671316a9410`。
- Run：`run-work-request-09b489a2902d1c7581979830d63c9210`。
- 当前节点：需求确认 Gate。
- 工作流分支标识：`ai/work-request-09b489a2902d`。
- 在原精确文字要求之外，提供当前 README 摘要原文、verify 包含 typecheck / Vitest / Vite build、依赖准备命令和 main 基线；要求编码 Agent 在修改前独立检查这些事实。

| 调用 | UTC 时间 | 输入 token | 输出 token | 结果 |
| --- | --- | ---: | ---: | --- |
| 新 Run 需求澄清 | 2026-09-07 06:54:52 | 547 | 803 | 真实 DeepSeek 生成澄清 |
| 需求审查 | 2026-09-07 06:58:16 | 4937 | 359 | 澄清充分，warn，未阻断 |
| 同一需求再次审查 | 2026-09-07 06:58:55 | 4937 | 368 | warn，未阻断；UI 操作反馈延迟时重复触发，计入全部调用，不计作额外阶段完成 |

恢复 Web 时发现上一轮手工复制的验证运行副本缺少静态资源。重新生产构建并将 standalone 与相同构建的 static 一起复制后恢复，所有页面引用的资源返回 200。新独立运行副本位于 `out/live-provider-20260907/web-runtime`，仍使用 4313 端口并连接真实 Team API。此处属于验证环境准备错误，不归为产品缺陷。

仓库绑定表单实际提交 installation `153168718` 与 repository `1359740566` 后，在线验证失败。使用同一现有 App 身份只读核验：原 `erich04/devflow-mini-agent` 返回 200、安装 `153168718`、Contents/Pull requests write；新 `erich04/devflow-mini-agent-live-20260906` 返回 404。当前安装为 selected repositories，因此需把新仓库加入现有安装。未改变任何 GitHub App 权限，也未创建安装凭据或绕过发布授权。隔离 checkout 的 origin 已确认为新仓库，main 基线为 `8491ff3f20918cd4f26390fa34373b7d224aecf4`。

## 代码验证

- 最终当前代码 `corepack pnpm verify`：258 个测试文件、3634 个测试通过，类型检查和跨平台检查通过。
- Local MCP 行为：真实写盘失败恢复、版本冲突、精确重试、并发提交和重启读取经过公开 LocalStore 接口验证。
- `corepack pnpm build`、`test:electron-smoke`、`test:build-output-smoke` 通过。
- `corepack pnpm test:e2e`：9 个受控浏览器场景通过。
- 所有受控 smoke 只证明自动化契约，不作为真实 Provider 调用或真实 GitHub 交付证据。

代码分为四个本地提交，位于 `codex/architecture-micro-refactor-20260906`：`4b86e93`（Local MCP 微重构）、`94bd992`（Web 表单与预算）、`f03152b`（设计契约）、`f4d7fd4`（Desktop 预算状态）。尚未推送或合并。

## 下一步与外部依赖

1. 手动解锁并在验证期间保持 Mac 解锁；Desktop 已持久保存新 Run 的澄清和审查结果。
2. 返回新 Run 的 Inspector，通过已审查的需求 Gate，再以修复后的契约执行真实设计和方案审查。
3. Native Coding 在 managed worktree 提交实际 README 修改建议，审核精确 diff，经产品批准后应用；运行完整 verify 并归档证据。
4. 在 GitHub Settings 完成 Confirm access，并把新测试仓库加入现有 App 安装 `153168718` 的仓库访问列表。随后通过产品绑定项目仓库、准备 Delivery、Team 审批准确 commit SHA、创建 Draft PR、执行最终验收。

目前没有新的 README 修改、测试产物、交付 commit、Draft PR 或最终验收结果；不能据此宣布从需求到云端完整跑通。
