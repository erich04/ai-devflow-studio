<a id="devflow-studio-demo-and-smoke-guide"></a>

# DevFlow Studio 演示与冒烟指南

本指南说明已发布的 V1.5 GitHub 交付路径。当前发布版本为 `v1.5.0`，1.x 的有限范围完成门禁已通过；与候选版本绑定的不可变证据保存在 `docs/releases/v1.5.0/`。

<a id="baseline-prerequisites"></a>

## 基础前提

- Team/API/Postgres 须报告 Team schema v21，包含服务商权威过期时间、有边界的服务商重试、已验证发布证据采用，以及仅含元数据的 Agent Runtime、Memory 和 Coordination 投影契约。
- Electron/SQLite 须报告 Desktop schema v35。
- Web/API/Postgres 演练需要已认证的 owner、lead 和已配对桌面身份。
- GitHub 交付演练需要已核验的 GitHub App 仓库绑定、经过测试的权威受管工作树提交、PR 交付包和精确的交付意图（Delivery Intent）。
- 日常演示使用模拟 GitHub 客户端和本地裸仓库。真实私有 GitHub 沙箱仅用于发布验收，须另行获得与候选版本绑定的授权。

<a id="desktop-demo"></a>

## 桌面演示

```bash
corepack pnpm dev:electron
```

预期结果：窗口标题为 `AI DevFlow Studio`，Electron 加载 `apps/desktop`，而非 `default_app.asar`。

建议路径：

1. 打开工作台，连接本地仓库并选择当前 Run。
2. 查看门禁策略执行、知识审查、编码 Agent 轨迹、代码差异和测试证据。
3. 生成仅含元数据的 PR 交付包，准备不可变的交付意图。
4. 同步脱敏交付请求，再通过独立、带签名身份的 Web lead/owner 会话批准该精确版本。
5. 恢复桌面发布，确认预期提交成为已核验的远端分支头，并记录一个与之匹配的 Draft PR。
6. 在业务验收前检查完成证据。业务验收绝不能合并或修改该 PR。

Electron 主进程负责读取和发布受管工作树。GitHub App 私钥保留在 API，短期仓库令牌仅保留在 Electron 主进程内存，渲染进程只看到状态。

<a id="recovery-actions"></a>

## 恢复操作

- **修订（Revise）**：发生实质变化后，在发布前创建新的意图版本，并使旧审批失效。
- **继续（Resume）**：继续同一个 `recovery_required` 尝试，不分配新的远端身份。
- **重试（Retry）**：只有当前配对认领者证明精确的远端前次尝试已为 `failed` 或 `revoked`，才创建下一次尝试。如果前次尝试在同一不可变系列中已有已核验发布，仅在创建 Draft PR 时失败，则获得批准的后续尝试采用该证据，直接进行 Draft 核对，不再申请凭据或推送。
- **停止（Stop）**：暂停精确的当前尝试，留待人工恢复，不声称已回滚远端操作。

这些操作都不能静默复用审批、强制推送、删除分支、发布标签或合并 PR。

<a id="webapi-team-demo"></a>

## Web/API 团队演示

```bash
corepack pnpm dev:api
corepack pnpm dev:web
```

打开 `http://127.0.0.1:4311`，使用已认证会话。

建议路径：

- 以 owner 身份配置或撤销已核验的 GitHub App 仓库绑定。
- 以 lead 或 owner 身份检查脱敏交付请求，批准其精确版本。
- 确认桌面 Bearer 权限不能批准自身请求。
- 检查绑定版本、审批、系列/尝试/修订、远端分支头、Draft PR、审计和验收摘要；其中不得出现本地路径、原始输出、补丁、源码或凭据。

<a id="smoke-commands"></a>

## 冒烟命令

```bash
corepack pnpm test:e2e
corepack pnpm test:electron-smoke
corepack pnpm test:native-coding-electron-smoke
corepack pnpm test:v15-github-delivery
corepack pnpm test:v15-github-delivery-packaged-smoke
```

Postgres 使用一次性的干净数据库，或明确准备的含数据 v11 测试库：

```bash
export DEVFLOW_DATABASE_URL='postgres://postgres:devflow@127.0.0.1:55432/devflow_v15'
corepack pnpm test:postgres-smoke
corepack pnpm test:local-auth-postgres-smoke
```

Postgres 冒烟须证明：新建数据库达到 Team schema v21；含数据的 v11→v12 迁移保留数据；v12→v13 迁移保留旧版已签发凭据，并在原始服务商过期时间为 NULL 时继续拒绝授权；v13→v14 仅新增可空且有边界的服务商重试字段。还须证明 v14→v15 保留 `source_publication_id`，并严格执行“凭据授权或采用既有发布证据”的权限约束。

v15→v16 须保留全部已有状态，创建空的 `agent_runtime_summaries` 和 `agent_runtime_projection_audits`，拒绝未脱敏或结构不一致的运行时记录。v16→v17 须创建空的 `agent_memory_summaries` 和 `agent_memory_projection_audits`，不包含本地内容，也不编造生命周期记录。v17→v18 须为摘要和审计新增独立 `quality_version`，以 `(memory_id, head_version, quality_version)` 作为审计身份。

v18→v19 须创建空的 `agent_coordination_summaries` 和 `agent_coordination_projection_audits`，不包含本地内容或编造的生命周期记录。v19→v20 须保留 GitHub 账号，仅接受 `github` 和 `local-development`，拒绝未知服务商。v20→v21 须保留已有编码摘要，在已有引擎值之外只允许受限的 `native` 编码引擎。

独立的本地认证冒烟使用隔离 schema，证明本地登录、空概览、项目创建、预算持久化、配对码交换和已配对桌面 Bearer 读取均可运行，不依赖演示种子或 GitHub OAuth 调用。它还验证仓库绑定及撤销、精确交付请求审批、凭据授权、远端核验、Draft 完成、恢复/审计行为和脱敏。

自托管生命周期边界使用：

```bash
corepack pnpm test:docker-lifecycle-smoke
```

生命周期冒烟覆盖新建 schema、保留数据升级、事务迁移重试和有边界的备份/恢复回滚，必须确定性地停止其 API 与容器。

<a id="real-github-sandbox-boundary"></a>

## 真实 GitHub 沙箱边界

真实私有 GitHub 沙箱不是日常演示命令。只有冻结候选版本获得明确授权后，发布验收才能运行一次。它可以认证 GitHub App、以非强制方式发布一个已批准提交，并创建或核对一个 Draft PR。不允许自动重试，也绝不能合并 PR、删除分支或发布标签。

本指南不授权付费服务商冒烟。GitHub 交付验证不使用模型服务商；OpenCode 或其他付费服务商请求需要另行获得与候选版本绑定的明确授权。

<a id="github-actions-notes"></a>

## GitHub Actions 注意事项

如果 PR 检查立即失败且没有任何任务步骤，先查看检查注释，再排查产品代码。Runner 账号或消费限额失败意味着工作流步骤并未执行；本地证据不能将此类基础设施失败变成通过的 CI 门禁。
