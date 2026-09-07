# 真实 Provider 流程验证记录 · 2026-09-06 / 07

状态：**进行中，尚未完成端到端交付验收。** 真实流程已执行到方案审查；发现设计输出契约问题后已修复代码，但重启 Desktop 时系统报告 Mac 已锁定，等待手动解锁。本文不将单元测试中的假 Provider 或受控 smoke fixture 计入真实流程结果。

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
| [#62](https://github.com/erich04/ai-devflow-studio/issues/62) | Desktop 已保存预算但顶部 not loaded。将项目预算读写提升为共享 hook，区分策略加载/缺失/禁用/不可用与单次 Coding 预算决策，隔离项目和绑定的异步结果。 | 单元及 App 集成回归通过；已构建新版，真实 Desktop 复测待解锁。 |
| [#69](https://github.com/erich04/ai-devflow-studio/issues/69) | 设计阶段只有澄清字段，导致模型重复需求。统一生成器与 Provider adapter 的阶段输出指令，设计必须返回实际 Markdown 正文，缺失或空正文报 schema_invalid。 | 真实失败证据已保存；输出契约、HTTP adapter 和缺失正文测试通过，真实重新生成与审查待解锁。 |

预算保存按钮持续 pending 与已关闭的 [#40](https://github.com/erich04/ai-devflow-studio/issues/40) 有关。本轮生产环境确认保存本身成功，而客户端 transition 未结束；以显式请求状态和 Server Action revalidation 修复并完成真实回归。

一次配对 401 来自测试操作重复使用已消费的一次性配对码，首次交换实际成功，后续同步正常。这不是产品缺陷，不计入 Issue。

## 代码验证

- 最终当前代码 `corepack pnpm verify`：258 个测试文件、3634 个测试通过，类型检查和跨平台检查通过。
- Local MCP 行为：真实写盘失败恢复、版本冲突、精确重试、并发提交和重启读取经过公开 LocalStore 接口验证。
- `corepack pnpm build`、`test:electron-smoke`、`test:build-output-smoke` 通过。
- `corepack pnpm test:e2e`：9 个受控浏览器场景通过。
- 所有受控 smoke 只证明自动化契约，不作为真实 Provider 调用或真实 GitHub 交付证据。

代码分为四个本地提交，位于 `codex/architecture-micro-refactor-20260906`：`4b86e93`（Local MCP 微重构）、`94bd992`（Web 表单与预算）、`f03152b`（设计契约）、`f4d7fd4`（Desktop 预算状态）。尚未推送或合并。

## 下一步与外部依赖

1. 手动解锁 Mac，连接重启后的 Desktop，验证预算顶部已配置状态。
2. 保留原 Run 的不合格设计和审查记录，从新 Work Request 重新开始，以修复后的契约执行真实澄清、设计与审查。
3. Native Coding 在 managed worktree 提交实际 README 修改建议，审核精确 diff，经产品批准后应用；运行完整 verify 并归档证据。
4. 为新测试仓库完成现有 GitHub App 的仓库访问配置。当前 GitHub Settings 停在 Confirm access，需账号持有人完成身份验证。随后通过产品绑定项目仓库、准备 Delivery、Team 审批准确 commit SHA、创建 Draft PR、执行最终验收。

目前没有新的 README 修改、测试产物、交付 commit、Draft PR 或最终验收结果；不能据此宣布从需求到云端完整跑通。
