<a id="execution-tools-and-read-only-design-validation--2026-09-22"></a>

# 执行工具与只读设计验证 — 2026-09-22

涉及 #156、#157、#158；#135 仍等待签名 macOS 安装验收。本记录对应当日实现和验证范围。

<a id="resulting-behavior"></a>

## 实现后的行为

- Agents 将开发配置命名为**项目执行工具**，内置执行器命名为 **DevFlow Native（内置编码执行器）**。实现 v2 与配置修订号分别标注；内部标识、已保存设置和旧记录不变。
- 澄清和设计按 Run/节点选择执行器及已保存的服务商。OpenCode 设计使用既有只读阶段 Agent 契约；聊天与开发配置仍相互独立。主进程自行发现 OpenCode 并解析凭据，不信任渲染进程传入的路径。
- 两条设计路径都要求使用成功需求 Gate 绑定的精确澄清版本。完整已批准澄清正文、原始请求正文及已保存的设计节点提案会传给服务商。排除未批准修订和其他节点的讨论输入。
- 设计证据记录已批准输入的身份/正文摘要、执行器/模型及已核验本地引用。失败或取消不改变当前阶段；成功后停在方案评审 Gate。

<a id="verification"></a>

## 验证

- `corepack pnpm typecheck`：通过；新增设计冒烟测试已纳入 `typecheck:opencode-smoke`。
- `corepack pnpm test`：300 个测试文件、4,081 项测试通过。本地跳过 15 项需显式启用的 PostgreSQL 测试，既有 CI Postgres 作业单独覆盖。
- `corepack pnpm build`、`test:cross-platform`、`test:build-output-smoke`：通过。
- `corepack pnpm test:e2e`：全部 41 个浏览器场景通过。既有执行工具选择器及 Direct Provider 仓库影响断言已按明确后的界面调整。
- 新增批准输入测试覆盖待批准、含糊、错误 Run、错误节点、未批准、被篡改的绑定，旧版兼容、真实 HTTP 请求正文，以及停在审查 Gate 的行为。
- 新增测试覆盖明确的 OpenCode 设计 IPC 路由且不写编码配置、独立节点选择、界面取消/重试、有界取消标识、拒绝迟到结果，以及澄清和设计的只读仓库/权限检查。
- `corepack pnpm test:stage-agent-design-contract`：使用真实 OpenCode 1.18.15 与本地模拟 OpenAI 兼容流式服务。读取 `task.ts`，提供完整批准输入，生成有摘要支撑的引用，保持 Git/文件内容不变；在一个操作等待时并发运行第二个模型而不打断前者，随后只取消该等待请求。
- `corepack pnpm test:stage-agent-design-electron`：使用隔离的真实 Electron 主进程/preload/渲染层、真实 OpenCode 及同一本地模拟服务。验证界面选择、设计产物出现前取消、明确重试、唯一设计产物、编码配置不变、人工审查仍待处理，以及重启后无重复模型请求或产物。仅在该测试进程中替换凭据存储，适配器只接受其精确模拟密钥；未使用用户钥匙串或付费模型。截图写入 `output/playwright/stage-agent-design/`。

<a id="cursor-advisor-disposition"></a>

## Cursor 审查建议的处理

Cursor Grok 4.6 Extra High 以只读方式审查有界方案和当前实现，报告 `pass_with_risks`。其建议经过独立源码核对：

- 采纳独立的取消/提交边界；仅靠 Run 时间戳不能拒绝迟到回复。
- 采纳从节点详情和 Agents 两处取消，并精确绑定 Run/节点归属。
- 采纳严格的批准输入、明确路由、重启测试及有界取消解析器。
- 采纳展示已核验事实/引用，并更新当前操作指南。
- 保留既有阶段 Agent 适配器，无需重写共享聊天工具或大规模迁移运行时。设计中可以描述实施命令，但本阶段不能执行它们。

<a id="user-environment-preservation"></a>

## 用户环境保留

全部开发和功能测试使用隔离检出、临时仓库及测试档案，没有操作用户 Run、Gate、会话、提案、服务商或项目配置。本机更新复用既有应用身份、桌面档案、API 数据库和端口，生成新的 SQLite/Postgres 备份，并在本地记录前后数据比较。重启后必须核对原业务进度，再将操作交还用户。
