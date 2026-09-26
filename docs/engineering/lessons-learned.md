<a id="devflow-studio-lessons-learned"></a>

# DevFlow Studio 工程经验

本文记录 DevFlow 开发中可复用的工程经验，聚焦操作层面的现象、根因、检查、修复和预防。架构取舍仍归入 ADR，里程碑进展仍归入 `docs/roadmap.md`；成熟且可审阅的规则应提升到 `docs/knowledge/checklists/` 或 `docs/knowledge/standards/`。

<a id="how-to-use-this-document"></a>

## 使用方法

如果某种故障可能在本地开发、冒烟测试、演示准备、服务商验收或发布验证中重复出现，就新增一个条目。

采用以下结构：

- **现象**：开发者或审阅者看到什么。
- **可能原因**：足以指导处理的最小解释。
- **检查**：用于确认问题的命令、界面信号、日志或进程状态。
- **修复**：最短且安全的恢复路径。
- **预防**：验收或演示前应检查什么。
- **稳定后沉淀**：是否应转为知识清单或标准。

<a id="electron-launch-and-demo-windows"></a>

## Electron 启动与演示窗口

- **现象**：Electron 打开默认欢迎应用、空白窗口或意料之外的渲染页面。
- **可能原因**：启动 Electron 时未传入桌面应用路径，或旧 Vite 服务仍在监听预期的桌面渲染端口。
- **检查**：
  - 窗口标题应为 `AI DevFlow Studio` 或 `ai-devflow-studio`。
  - Electron 进程参数应包含 `apps/desktop`，而非只有 `default_app.asar`。
  - `lsof -nP -iTCP:5173 -sTCP:LISTEN` 应显示预期桌面渲染服务。
- **修复**：
  - 演示前停止旧 DevFlow 桌面进程。
  - 使用 `corepack pnpm dev:electron` 启动真实桌面路径。
  - 渲染端口被占用时，清理旧进程并重启，不以回退端口作为验收依据。
- **预防**：作品展示或发布演示前执行 Electron 演示准备清单。
- **稳定后沉淀**：已沉淀到 `docs/knowledge/checklists/electron-demo-readiness.md`。

<a id="port-conflicts"></a>

## 端口冲突

- **现象**：代码未变，Vite、Next、API、Playwright 或冒烟测试却间歇失败。
- **可能原因**：旧开发服务仍在监听 DevFlow 的固定本地端口。
- **检查**：
  - 桌面渲染服务：`5173`
  - API：`4310`
  - Web 团队控制台：`4311`
  - 意外回退的渲染端口：`5174`
- **修复**：
  - 用 `lsof -nP -iTCP:<port> -sTCP:LISTEN` 识别监听者。
  - 仅停止拥有该监听端口的 DevFlow 进程树。
  - 除非编辑器辅助进程明确属于本次清理范围，否则不要处理它们。
- **预防**：演示端口被占用属于环境干扰，不能视为产品验收结果。
- **稳定后沉淀**：暂保留为工程经验；发布清单需要端口预检查时再纳入。

<a id="postgres-smoke"></a>

## Postgres 冒烟

- **现象**：`verify` 通过，但团队策略、例外、迁移或概览行为仍未确认。
- **可能原因**：`corepack pnpm verify` 有意不包含 Postgres，因为它需要外部数据库。
- **检查**：
  - 仅在明确设置 `DEVFLOW_DATABASE_URL` 时运行 Postgres 冒烟。
  - 证明干净数据库达到 Team schema v21，含数据的 v11→v12 升级精确保留数据，v12→v13 保留旧版已签发凭据且不编造服务商权威过期证据；v13→v14 只增加有边界的非秘密服务商重试信息；v14→v15 加入已核验发布证据采用，保持旧有凭据授权支持的发布权限不变；v15→v16 只增加仅含元数据的运行时摘要/审计，不为保留数据编造记录；v16→v17 同样只增加记忆摘要/审计；v17→v18 将同一生命周期版本下的质量审计版本独立出来；v18→v19 只增加有边界的协调投影；v19→v20 保留 GitHub 账号，仅额外允许独立受控的 `local-development` 服务商；v20→v21 允许受限的 `native` 编码摘要引擎，不改变保留摘要。
  - 运行隔离的本地认证 Postgres 冒烟，证明固定 owner 登录、项目与预算设置、配对码交换及已配对 Bearer 读取不依赖演示种子或 GitHub OAuth。
  - 确认策略保存/读取、策略执行评估、例外审计、过期策略拒绝、审批同步绕过拒绝及概览脱敏。
  - 确认 GitHub App 仓库绑定、交付请求、签名审批、凭据授权、远端分支头核验、Draft 完成、撤销和防重复执行审计路径。
- **修复**：
  - 仅重建预定的新建测试库；保留升级失败的测试库，直到查明事务边界及精确的不兼容记录。
  - 修复记录中指出的 v11 行，再重试同一个 v11→v12 迁移，不手工执行迁移 SQL，也不削弱断言。
  - `provider_credential_expires_at` 为 NULL 时，旧版已签发凭据必须继续拒绝授权；只有有边界的服务商观测才能确立权威过期时间。
  - 只有同系列紧邻前次尝试拥有精确的已核验分支头，且最终仅在 Draft 阶段失败，才允许采用发布证据；绝不能借此再次签发凭据或推送。
- **预防**：API、仓储层、迁移、策略、例外、GitHub 交付持久化或管理摘要行为变化时，运行 Postgres 冒烟。
- **稳定后沉淀**：已沉淀到 `docs/knowledge/checklists/postgres-smoke-readiness.md`。

<a id="opencode-runtime-signoff"></a>

## opencode 运行时验收

- **现象**：默认验证通过，但真实编码引擎路径仍未得到证明。
- **可能原因**：真实 opencode 运行时需要环境变量明确启用，不属于默认 `verify`。
- **检查**：
  - `DEVFLOW_RUN_OPENCODE_SMOKE=1`
  - `DEVFLOW_CODING_ENGINE=opencode-http`
  - 服务商 ID、模型 ID 和服务商 API 密钥的环境变量名称均已明确设置。
  - 冒烟输出不打印服务商机密。
- **修复**：
  - 将冒烟预检查作为契约门禁：未设置 `DEVFLOW_CODING_ENGINE=opencode-http` 时，真实冒烟必须在联系服务商前退出。
  - 仅在明确具备服务商凭据和本地 opencode 时，运行 `corepack pnpm test:opencode-smoke`。
  - 日常验证继续使用确定性的模拟引擎作为默认路径。
- **预防**：声称真实编码适配行为已验证前，执行 opencode 运行时验收清单。
- **稳定后沉淀**：已沉淀到 `docs/knowledge/checklists/opencode-runtime-signoff.md`。

<a id="knowledge-retrieval-and-evidence"></a>

## 知识检索与证据

- **现象**：Gate 或审查看起来引用了相关知识，策略却仍报告缺少证据。
- **可能原因**：检索命中只是建议，本身不能证明符合治理标准。
- **检查**：
  - 查找引用该标准的持久化产物、测试证据、审查产物或门禁决策。
  - 不将仅有检索命中的情况计为标准已满足的证明。
- **修复**：
  - 为选中的 Run 或节点关联或生成真实证据。
  - 知识检索继续作为人员和 Agent 的上下文。
- **预防**：遵守 `docs/adr/0007-knowledge-retrieval-is-not-governance-evidence.md` 记录的边界。
- **稳定后沉淀**：保留为有 ADR 依据的工程经验；具体审查清单需要提醒时再纳入。

<a id="gate-enforcement-and-retry"></a>

## 门禁策略执行与重试

- **现象**：被阻断的 Gate 有可用处理建议，但不应自动修改仓库。
- **可能原因**：v0.8 的策略感知交付明确要求人工批准。它提供恢复计划和重试上下文，不自动修复、自动豁免或修改主检出目录。
- **检查**：
  - 通过明确的桌面动作发起重试。
  - 编码工作发生在受管工作树中。
  - 团队摘要保持脱敏。
- **修复**：
  - 人工接受重试方向后，才使用节点检查器中的处理建议按钮。
  - 门禁审批和例外继续通过策略执行写入路径处理。
- **预防**：将自动绕过 Gate 或未经批准的重试视为产品回归。
- **稳定后沉淀**：可作为未来策略感知交付准备清单的候选内容。
