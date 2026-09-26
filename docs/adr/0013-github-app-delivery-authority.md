<a id="adr-0013-github-app-delivery-authority"></a>

# ADR 0013：GitHub App 交付权限

状态：已接受（Accepted）。

日期：2026-08-11

<a id="context"></a>

## 背景

DevFlow 当前只用 GitHub OAuth App 建立浏览器身份：请求 `read:user user:email`、读取个人资料，然后丢弃访问令牌。V1.5 需要范围限定到单个仓库的写权限，使桌面可以发布一个预期提交，API 可以在明确的签名 Web 批准之后创建一个草稿拉取请求。

备选方案包括：

1. 扩大并持久化既有用户 OAuth 令牌；
2. 要求每个桌面操作者提供个人访问令牌；
3. 使用 GitHub App 安装，取得限定仓库的短期凭据；
4. 让 API 通过 GitHub 对象 API 上传代码。

受管工作树和 Git 对象位于桌面。API 不能成为原始源码上传服务，桌面也不能长期保管广泛授权的用户令牌。

<a id="decision"></a>

## 决策

V1.5 交付使用 GitHub App 安装。

- 自托管 API 在运维配置中保管 GitHub App ID 和私钥。
- Postgres 只保存项目到安装/仓库的绑定以及脱敏审计元数据。
- 既有 GitHub OAuth App 继续只用于身份，权限保持 `read:user user:email`；访问令牌不持久化、不复用于交付。
- 当前有效的 lead 或 owner 通过签名浏览器会话批准确切的脱敏交付请求；桌面 Bearer 权限不能批准自己的请求。
- 此后，已配对桌面主进程通过已鉴权 API 请求安装访问令牌（installation access token）。
- API 将桌面安装访问令牌限制为单个仓库和 `Contents: write`。
- 令牌有效期不超过一小时。桌面主进程仅为当前尝试在内存中持有，用完清除。
- 渲染进程（renderer）绝不接收私钥、安装访问令牌、授权头、凭据助手或原始 Git 命令。
- 桌面主进程只将已批准的预期提交发布到已批准的命名空间分支。
- API 独立读取远端分支头；只有它与预期提交一致时，才使用 API 持有的、限制到单个仓库和确切权限组合 `Contents: read + Pull requests: write` 的令牌，读取两个引用并仅创建草稿拉取请求。
- V1.5 中 DevFlow 不会合并或自动合并，不会强制推送，不会删除远端分支，不会发布标签，也不会扩大权限。

<a id="authority-model"></a>

## 权限模型

| 事实或操作 | 权威来源 |
| --- | --- |
| 完整本地 Run、受管工作树、预期提交、本地尝试及结果 | 桌面 SQLite / Electron 主进程 |
| 脱敏交付请求、lead/owner 批准、组织、成员身份、项目仓库、GitHub App 安装绑定及撤销 | API/Postgres |
| App 私钥及安装令牌签发 | API 进程配置 |
| 为确切 Git 推送使用短期 Contents 令牌 | Electron 主进程内存 |
| 远端分支头核实及草稿拉取请求创建 | API 进程 |
| 已发布分支及草稿拉取请求 | GitHub |
| 工作流阶段推进及业务验收 | 经过证据检查的权威本地 Run |

安装访问令牌证明 GitHub 能力，不证明人工意图。交付批准仍是独立、不可变的 Team 决策，绑定确切的脱敏交付请求，并在发布前镜像到本地尝试。

<a id="failure-and-recovery-rules"></a>

## 失败与恢复规则

- 权限缺失、过时、撤销、跨项目、跨仓库或过宽时拒绝执行。
- 获得已批准交付意图之前，不签发任何凭据。
- 预期提交或证据摘要变化会使批准失效。
- Electron 主进程扫描确切的出站 Git 对象，并在请求任何 GitHub 凭据前持久记录不含秘密的安全回执。API 在请求 PR 写入权限前独立扫描 PR 标题和正文。这是两条独立的出站内容边界，证据脱敏或其中一条通过都不能替代另一条。
- 任一边界高置信命中均进入 `content_scan_blocked`。操作者不得恢复（Resume）或覆盖阻断。唯一安全继续方式是新的 Work Request/Run，在干净的 Coding Agent 工作空间中重建并重新测试实现。Git 内容阻断发生在推送前；PR 文本阻断可能发生在已核实分支发布之后，但对被阻断意图不得再进行远端写入。
- 推送或 PR 响应不明确时，必须先与 GitHub 对账，再尝试另一次写入。
- 冲突的远端分支或拉取请求变为操作者可见的恢复事项，DevFlow 不重写它。
- 撤销阻止新凭据签发。已签发令牌按短期凭据处理，一旦得知撤销就停止本地尝试。

<a id="consequences"></a>

## 影响

收益：

- 仓库访问可以独立于用户身份安装和撤销。
- 安装令牌有效期短，可限定单个仓库及权限集合。
- 桌面保持本地代码发布，不持久保存长期写凭据。
- GitHub 审计归属可以识别 App 安装。

成本与限制：

- 自托管运维者需要创建、安装 GitHub App，并配置私钥。
- API 需要实现 JWT 签名、安装发现/绑定、令牌签发及脱敏错误处理。
- V1.5 不把远端写入归于个人 GitHub 用户令牌；签名 Web 交付批准和 Team 审计提供人工归属。
- 已签发令牌无法即时撤销，因此短有效期、单次尝试处理及本地取消仍很重要。

<a id="rejected-alternatives"></a>

## 未采用的替代方案

<a id="persist-the-current-oauth-access-token"></a>

### 持久保存当前 OAuth 访问令牌

现有身份 OAuth 契约范围窄、已充分测试，并会丢弃令牌。扩大权限会把登录与仓库写入耦合，产生长期用户凭据保管，并增加撤销和仓库范围判断的难度。

<a id="personal-access-token-on-desktop"></a>

### 桌面个人访问令牌

PAT 范围与有效期取决于操作者，难以证明，容易泄露到渲染进程、日志或持久化存储；也会在团队项目权限边界之外产生第二套凭据模型。

<a id="api-side-git-object-upload"></a>

### API 侧上传 Git 对象

这需要源文件 blob 和提交对象跨越既有本地优先边界。桌面已拥有权威受管工作树，应在桌面执行 Git。

<a id="references"></a>

## 参考

- https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-an-installation-access-token-for-a-github-app
- https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/authenticating-as-a-github-app-installation
- https://docs.github.com/en/rest/pulls/pulls#create-a-pull-request
