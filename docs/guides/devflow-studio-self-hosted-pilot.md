<a id="devflow-studio-self-hosted-pilot-guide"></a>

# DevFlow Studio 自托管试点指南

本指南说明 V1.5 试点栈的运行方式，包括 Web、API 和 Postgres，适用于由运维人员控制网络边界的小规模自托管评估。它不代表可直接对公众提供 SaaS 服务。

默认采用单团队入门流程。若显式启用独立组织模式，还应阅读[多组织升级指南](./multi-organization-deployment.md)，了解迁移 29、实时成员资格检查和由运维人员分配 GitHub 仓库的方式。

<a id="what-this-stack-proves"></a>

## 这套部署可以验证什么

- API 和 Web 使用生产构建产物，以非 root 用户运行；镜像中没有工作区源码或开发启动器。
- 一次性迁移必须成功结束，API 才能启动；API 就绪检查还会核对 Postgres 模式版本。
- Web 为项目创建桌面配对码，桌面端用它换取限定作用域的 Bearer 令牌。
- Web 创建带版本的工作请求（Work Request）；已配对的桌面端领取请求，生成唯一的正式本地 Run，并仅上传脱敏摘要。
- Web 提交绑定版本和策略的门禁命令（Gate Command）。领取请求的桌面端通过持久化收件箱与回执协议接收命令，重新评估本地证据、保存结果，再确认对应回执。团队端不能直接修改 Run。
- Web 展示同步后的项目和 Run 状态，不包含原始标准输出/错误、工作目录、提示词、补丁正文或模型服务商密钥。

2026-08-01 的开发目录演练见 [V1.4 电脑控制验证记录](./devflow-studio-v1.4-walkthrough-result-2026-08-01.md)。这是实现验证证据，不是 V1.4 的正式发布验收。

<a id="prerequisites"></a>

## 前置条件

- Docker 和 Compose v2。
- 仅当在宿主机执行仓库冒烟命令时，才需要 Node.js/Corepack。
- 一个 GitHub OAuth App，其回调地址必须与 `GITHUB_OAUTH_REDIRECT_URI` 完全一致。

候选版通过多架构清单摘要固定 Node 和 Postgres 基础镜像。更新摘要必须作为独立依赖变更评审；提升为新候选版前，重新运行两项 Docker 冒烟命令。

<a id="configure"></a>

## 配置

复制示例，启动前填齐所有空值：

```bash
cp .env.example .env
```

必填值：

- `POSTGRES_PASSWORD`：URL 安全的随机密码，因为 Compose 会将它写入内部 Postgres 连接 URL。
- `DEVFLOW_SESSION_SECRET`：独立生成、至少 32 个字符的随机值。
- `DEVFLOW_AGENT_CREDENTIAL_KEY`：另一个独立生成、至少 32 个字符的随机值，用于加密保存的模型服务商凭据；必须在这些数据的整个生命周期内保留。
- `GITHUB_CLIENT_ID`、`GITHUB_CLIENT_SECRET`、`GITHUB_OAUTH_REDIRECT_URI`：完整的 GitHub OAuth 初始配置。试点模式拒绝缺失、部分配置或无效值。
- `DEVFLOW_WEB_APP_URL`：浏览器可访问的 Web 控制台 URL。GitHub 回调成功后，API 重定向到此处，而非没有界面的 API 根路径。

`DEVFLOW_WEB_APP_URL` 与 `GITHUB_OAUTH_REDIRECT_URI` 必须使用相同协议和主机名，端口可以不同。这样 OAuth 状态与会话 Cookie 处于同一浏览器信任边界。共用协议为 HTTPS 时，API 会为两类 Cookie 设置 `Secure`；应在可信反向代理上统一终止 TLS，不要混用 HTTP 与 HTTPS URL。

可分别使用 `openssl rand -hex 32` 生成各项密钥。不要复用示例值、将真实密钥提交到源码仓库，或在没有凭据重新加密流程的情况下轮换 `DEVFLOW_AGENT_CREDENTIAL_KEY`。

Compose 将 API 固定为 `DEVFLOW_DEPLOYMENT_PROFILE=pilot`、`DEVFLOW_REQUIRE_AUTH=true`、`DEV_AUTH_ENABLED=false`，并禁用演示数据和模拟运行时。试点配置若削弱这些约束，API 会拒绝启动，尤其会拒绝 `DEV_AUTH_ENABLED=true`。
未签名的 `x-devflow-*` 身份请求头仅可用于显式启用、绑定本机回环地址且不面向浏览器的开发 API。

<a id="allowed-api-environment-variables"></a>

### 允许的 API 环境变量

试点 API 明确支持以下配置项：

- 网络：`HOST`、`PORT`。
- 数据库：`DEVFLOW_DATABASE_URL`（或 `DATABASE_URL`）、`DEVFLOW_DATABASE_APPLICATION_NAME`、`DEVFLOW_DATABASE_STATEMENT_TIMEOUT_MS`。
- 安全：`DEVFLOW_DEPLOYMENT_PROFILE`、`DEVFLOW_REQUIRE_AUTH`、`DEV_AUTH_ENABLED`、`DEVFLOW_SESSION_SECRET`、`DEVFLOW_AGENT_CREDENTIAL_KEY`、`DEVFLOW_WEB_APP_URL`。
- 运行时开关：`DEVFLOW_ENABLE_DEMO_DATA`、`DEVFLOW_ENABLE_FAKE_RUNTIME`；试点中二者必须为 `false`。
- 登录：`GITHUB_CLIENT_ID`、`GITHUB_CLIENT_SECRET`、`GITHUB_OAUTH_REDIRECT_URI`。
- GitHub 交付：`DEVFLOW_GITHUB_APP_ID`、`DEVFLOW_GITHUB_APP_PRIVATE_KEY_BASE64`。禁用 GitHub 交付时二者可同时留空；只配置其中一项会被拒绝。

试点模式拒绝未知的 `DEVFLOW_*` 或 `DEV_AUTH_*` 变量名，避免安全配置拼写错误却被静默忽略。Compose 只传入上述变量。Web 运行时允许的变量为 `DEVFLOW_INTERNAL_API_BASE_URL`、`DEVFLOW_PUBLIC_API_BASE_URL`、`DEVFLOW_WEB_APP_URL`、`HOSTNAME` 和 `PORT`。

<a id="configure-github-delivery"></a>

## 配置 GitHub 交付

GitHub 交付使用独立的 GitHub App。上面的 OAuth App 仅用于身份验证，权限保持 `read:user user:email`；不要扩大权限、持久化其访问令牌或用个人访问令牌替代。
每个自托管安装配置一个 GitHub App，仅允许选定仓库，并仅授予以下仓库权限：

- 元数据读取（`Metadata: read`）：GitHub 为安装的 App 授予的基础权限。
- 内容写入（`Contents: write`）：桌面端可以向一个 `devflow/` 分支发布一个已批准的提交。
- 拉取请求写入（`Pull requests: write`）：API 核验分支后，可以创建一个草稿 PR。

V1.5 的轮询流程不需要 webhook。只在可绑定到 DevFlow 项目的仓库中安装 App。私钥应留在 API 运维边界内；将 PEM 编码为不换行的 base64 后配置：

```dotenv
DEVFLOW_GITHUB_APP_ID=<numeric-app-id>
DEVFLOW_GITHUB_APP_PRIVATE_KEY_BASE64=<base64-encoded-private-key-pem>
```

不要将私钥或安装访问令牌粘贴到 Web、桌面端、数据库、日志或源码仓库。API 为指定仓库签发最长一小时的安装访问令牌。在单次发布尝试期间，带 `Contents: write` 权限的副本仅存在于桌面主进程内存中。
草稿查询和创建使用由 API 持有、精确限制为 `Contents: read + Pull requests: write` 的令牌：GitHub 可以读取已批准的基础与目标引用，PR 写入权限始终留在 API 进程中。

服务就绪后：

1. 使用现有 GitHub OAuth 身份登录，选择目标团队项目，打开 **GitHub Delivery**（GitHub 交付）。
2. 输入数字安装 ID 和仓库 ID，核对具体项目，勾选确认框后设置绑定。API 从 GitHub 解析正式的 `owner/repository` 和默认分支，Web 不能提供这些授权依据。
3. 在桌面端创建脱敏的 PR 交付包，再准备 GitHub 交付。桌面端在托管工作树内创建或核验一个提交，对该确切提交重新执行配置的测试命令，然后提交 `approval_required` 请求。
4. 在 Web 核对具体仓库、基础/目标分支、提交、Run/证据版本及 PR 标题。当前有效的 lead 或 owner 必须勾选独立确认框后批准；桌面 Bearer 令牌不能批准自己的请求。
5. 保持桌面端运行。调度器获取短期令牌，仅发布已批准的 SHA，不强制推送，并上报结果。API 独立核验远端目标提交后才创建一个草稿 PR；只有持久化的草稿证据可以将 Run 推进到业务验收。
6. 停用发布时，使用绑定版本的 **Revoke repository binding**（撤销仓库绑定）操作。撤销会阻止新的凭据授权，不会删除分支、关闭 PR 或改写 GitHub 历史。

<a id="github-delivery-recovery"></a>

### GitHub 交付恢复

| 持久化状态 | 含义 | 运维处理方式 |
| --- | --- | --- |
| `approval_required` | 尚未授权远端写入。 | 在 Web 核对确切请求，再批准或拒绝。 |
| `publishing_branch` | 有限范围的凭据/推送尝试正在执行，或结果不确定。 | 让桌面端核对确切的远端 SHA。界面若出现明确的恢复操作，可执行一次；不要手动推送或强制改写分支。 |
| `branch_published` | GitHub 已包含批准的提交，API 也已核验。 | 保持桌面端与 API 可用，让草稿创建继续。 |
| `creating_pr` | 草稿创建或查询正在执行，或结果不确定。 | 恢复一次；DevFlow 会先查找确切的目标/基础/提交标记，不盲目创建重复 PR。 |
| `recovery_required` | 已分类的冲突、超时、绑定撤销或外部结果不确定，需要处理。 | 阅读脱敏结果，恢复服务商/绑定授权，或解决指出的远端冲突，再使用桌面端明确的恢复操作。 |
| `content_scan_blocked` | 确切的出站 Git 对象或 PR 标题和正文中发现高置信度凭据匹配。 | 此交付意图不得恢复（Resume）或覆盖阻断。创建新的 Work Request/Run，并使用干净的 Coding Agent 工作空间重新构建和测试变更。 |
| `completed` | 确切分支与草稿 PR 已形成持久化证据。 | 继续业务验收。托管工作树只能通过正常的终态清理路径清除。 |

这里有两道独立的出站边界。在请求任何 GitHub 凭据前，Electron 主进程为确切的出站 Git 对象写入不含密钥的安全回执。API 在获取 PR 写入权限前扫描 PR 标题和正文。
Git 内容阻断发生在推送之前；PR 文本阻断可能发生在分支已发布并核验之后。无论哪种情况，`content_scan_blocked` 都不允许该意图继续远端写入，只能走上述干净重建路径。

DevFlow 绝不强制推送、删除远端分支或发布标签，也绝不合并、自动合并、关闭 PR，或静默扩大 GitHub App 权限。远端 `devflow/` 分支如果含有不同 SHA，应按冲突处理：在 GitHub 检查并保留证据，解决源状态后再准备新的、绑定版本的交付意图。
不要通过编辑 SQLite/Postgres 行或重放原始 REST/git 命令修复交付。

<a id="run-the-stack"></a>

## 启动服务

```bash
docker compose up --build
```

迁移容器运行一次 `node migrate.js`。只有它成功退出后，API 才运行 `node server.js`；API 就绪后，独立 Web 服务才运行 `node apps/web/server.js`。运行时镜像均不包含 `tsx`、应用源码或工作区开发依赖。

访问地址：

- Web：<http://127.0.0.1:4311>
- API 存活检查：<http://127.0.0.1:4310/health>
- API 就绪检查：<http://127.0.0.1:4310/ready>
- Web 存活检查：<http://127.0.0.1:4311/health>
- Web 就绪检查：<http://127.0.0.1:4311/ready>

`/health` 表明进程能响应请求；`/ready` 表明 API 能使用当前数据库模式。Web 就绪也依赖 API 就绪，Compose 据此控制启动顺序。

Web 用 `DEVFLOW_INTERNAL_API_BASE_URL=http://api:4310` 发起服务端请求，用 `DEVFLOW_PUBLIC_API_BASE_URL` 生成浏览器访问的 OAuth 链接。试点部署在反向代理后方时，后者必须设置为用户实际可访问的 URL。
Web 还接收 `DEVFLOW_WEB_APP_URL`，使用其规范化源地址检查浏览器写操作；协议、主机名和端口必须与用户所见一致。`http://0.0.0.0:4311` 等内部监听地址绝不是浏览器的信任源。

正常试点启动绝不加载演示种子数据。仅在隔离演示中，待服务就绪后显式运行一次性工具：

```bash
docker compose run --rm seed
```

不要对真实团队数据库运行此工具。

<a id="build-and-verify-the-desktop-pilot-bundle"></a>

## 构建并验证桌面试点包

从仓库构建产物生成当前宿主平台的桌面应用、可重复生成的归档和清单：

```bash
corepack pnpm build:desktop-pilot
```

命令生成 `out/desktop-pilot/artifact-index.json`、当前平台的应用目录、`.tar.gz` 归档及 `.manifest.json` 清单。清单记录包内文件和归档 SHA-256，不嵌入源仓库绝对路径。
使用以下命令验证确切的包内可执行文件：它应使用隔离用户数据启动，通过 `file://` 加载构建后的渲染器，并忽略注入的开发服务器 URL。

```bash
corepack pnpm test:desktop-pilot-smoke
```

试点包的范围有限：

- 只为当前宿主平台与架构构建。
- 未签名、未公证，归档也不是安装器。
- 包含构建后的渲染器、Electron 主进程/预加载产物和必需的 `sql.js` 运行时，不含工作区源码或开发启动器。
- 冒烟仅证明启动隔离与构建后界面加载，不证明代码签名、自动更新、从 macOS 验证 Windows 界面，或适合公开分发。

发布与里程碑状态由[路线图](../roadmap.md)统一维护。打包清单和文件名必须与构建所用源码版本匹配；版本标签本身不能作为发布证据。

<a id="complete-pairing-work-request-and-gate-walkthrough"></a>

## 完成配对、工作请求与门禁演练

1. 用 GitHub OAuth 登录 Web 团队控制台，选择目标团队项目。
2. 在项目面板点击 `Create desktop pairing code`（创建桌面配对码）。复制配对码，并将其作为短期密钥保护。
3. 打开 Electron 桌面应用，选择本地项目，将配对码粘贴到 `Desktop pairing code`，点击 `绑定`，再点击 `同步团队`。
4. 在 Web 为同一团队项目创建工作请求，标题和正文应范围明确。
5. 在桌面端打开已配对的本地项目，刷新 `Work Requests`，点击对应请求的 `创建本地 Run`。桌面端原子领取预期版本、绑定确定的本地 Run ID、创建唯一正式 Run，并确认已生成。成功前，团队端不伪造 Run。
6. 将本地 Run 从需求澄清推进到门禁。按提示点击 `同步团队`，使桌面端获得当前项目作用域的团队策略快照，团队端收到最新脱敏 Run 投影。
7. 刷新 Web，打开投影 Run，选择 `approve`（批准）或 `reject`（拒绝），填写必需原因并提交门禁命令。Web 只提交协作意图，不直接修改本地 Run。
8. 保持领取请求的桌面端运行。调度器轮询项目作用域的命令收件箱、领取有期限的回执，核验项目/领取方/Run/节点/版本/策略/阻断项的作用域，并重新评估完整本地证据。批准使用共享状态迁移；拒绝记录人工决定，并让 Run 继续暂停在门禁。
9. 桌面端确认确切回执后，在 Web 核对命令进入终态。后续 `同步团队` 才发布新的脱敏 Run 版本；确认回执本身不修改团队 Run 投影。

配对后，桌面同步使用经过认证的 Bearer 令牌，不再使用演示请求头。令牌认证失败时必须重新连接，不可静默回退到演示模式。
`stale_run`、`stale_policy`、阻断项不匹配或命令过期，都会安全地终止并拒绝操作：不能假定本地状态已迁移，Web 用户必须刷新后创建新命令。

<a id="smoke-test"></a>

## 冒烟测试

在仓库中显式运行 Docker 冒烟：

```bash
corepack pnpm test:docker-smoke
```

测试使用临时宿主端口启动隔离的 Compose 项目。测试驱动显式运行种子数据工具，用已签名认证会话 Cookie 创建配对码，换取桌面 Bearer 令牌，执行工作请求与门禁命令流程，核验 Web/API 可见性，最后删除隔离服务与卷。它不启用未签名身份请求头。
`test:docker-smoke` 需要 Docker，因此不包含在 `corepack pnpm verify` 中；CI 在独立 Docker 冒烟步骤运行它。

<a id="v15-lifecycle-and-rollback-matrix"></a>

### V1.5 生命周期与回滚矩阵

形成发布候选版前，显式运行生命周期验证：

```bash
corepack pnpm test:docker-lifecycle-smoke
```

该命令不产生模型费用，也不包含在默认 `verify` 中。它构建附注标签 `v1.4.0` 指向的确切源码，固定解析后的提交，在隔离数据库和容器中验证：

| 场景 | 自动化证据 | 支持的运维操作 |
| --- | --- | --- |
| 全新 V1.5 部署 | 生产迁移包从空数据库创建团队模式 v15，包括以服务商为准的过期时间、有限重试及已核验发布复用契约；当前 API 达到就绪。 | 先运行一次性迁移，再启动 API/Web。 |
| 保留数据升级 | 确切的 V1.4 迁移器生成有数据的模式 v10。种子 Run 在 Postgres 容器重启及 V1.5 迁移到模式 v15 后仍保留，并可通过当前 API 的认证读取查看。 | 备份 Postgres、停止写入方、运行一次 V1.5 迁移器，再启动 V1.5 API/Web。 |
| v11 到 v12 的事务重试 | v11 GitHub 交付行中不兼容的系列键导致 v12 迁移失败。事务保持模式 v11、迁移历史、列和原始行不变。修正键后重试到 v12，保留原字段，仅新增文档规定的系列/尝试回填。 | 失败数据库保持离线，修正报告的不兼容行，重跑同一 V1.5 迁移器；不要手动执行部分迁移 SQL。 |
| v12 到 v13 的服务商过期证据 | 旧版已签发凭据迁移后，契约版本为 `0`，原始服务商过期时间/观测值为 NULL。约束拒绝伪造的 `credential_provider_expiry_confirmed` 结果；只有带所需服务商观测的新版 `1` 证据才能解除。 | 将旧授权视为未解决并拒绝继续；不要用本地时钟回填服务商时间或手动改过期字段。 |
| v13 到 v14 的服务商重试 | 草稿 PR 恢复新增可为空的 `provider_retry_not_before`；只有符合范围约束的 `recovery_required` 行可以保存它。 | 恢复时先核对确切标记，不得在指定时间之前再次创建。 |
| v14 到 v15 的已核验发布复用 | 旧授权支持的发布新增 NULL `source_publication_id`，原字段不变；“有且仅有一个授权来源”约束拒绝零来源或双来源的发布。 | 草稿最终失败后，后续同系列已批准尝试只可复用完全匹配且已核验的前次发布；不得再签发凭据或推送。 |
| API 应用回滚 | 确切的 V1.4 API 面对团队模式 v15 时拒绝就绪。测试将升级前模式 v10 备份恢复到独立数据库，证明 V1.4 能经认证读取保留 Run 的概览。 | 不要让 V1.4 连接团队模式 v15，也不得对其运行 V1.4 迁移器。回滚时先停止 V1.5 写入方，恢复升级前备份为模式 v10，再启动 V1.4 API。 |
| 桌面应用回滚 | V1.5 桌面模式 v17 含有 V1.4 模式 v12 不认识的迁移。 | 不支持原地降级桌面数据库。升级前备份桌面用户数据目录；回到 V1.4 时恢复升级前备份，或使用独立的 V1.4 用户数据目录。 |

API 回滚验证只证明 V1.4 程序拒绝较新团队模式，并可读取明确恢复的 V1.4 备份。它不声称旧程序可以处理 V1.5 写入、读取团队模式 v15 或逆向迁移。
数据库回滚始终要求运维人员恢复升级前 Postgres 备份；桌面回滚同样要求其独立的升级前用户数据备份。

<a id="stop-and-reset"></a>

## 停止与重置

```bash
docker compose down
docker compose down -v
```

只有确定要删除试点 Postgres 卷时，才使用 `down -v`。

<a id="current-boundaries"></a>

## 本指南版本的能力边界

以下对应本指南的 V1.5 试点范围；当前发布状态以路线图为准：

- 不自动配置 HTTPS；在可信反向代理处终止 TLS。
- 桌面试点包仅适用于当前宿主平台，未签名、未公证，没有安装器或自动更新通道。
- 不提供 Kubernetes 部署。
- 不提供模型服务商密钥轮换或桌面令牌撤销界面。
- 除文档规定的门禁命令租约契约外，不保证多桌面并发。
- 不提供公开 SaaS 入门流程。
- 2026-08-01 的实现演练没有付费模型调用，不能作为 V1.4 正式验收。
