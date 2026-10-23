# B 工作包真实验收环境与预算

## 范围与证据分层

本页记录 #237、#226、#182 的独立验收工具；#245 的展示证据另见其验证记录。测试代码不进入产品默认启动路径，不读写用户业务数据。真实 Electron / OpenCode 加合成模型的协议测试、真实服务商模型实验、GitHub 交付各自记录，不能相互替代。

Node.js 24.18.0、Corepack pnpm 9.15.0、OpenCode 1.18.15 已核对。依赖沿用仓库 lockfile。PostgreSQL 使用专用 Docker 容器 `devflow-b-20261023`、独立 named volume、回环随机端口与专用数据库；每轮 UI 环境另建 `b_live_*` schema。停止环境保留 schema、profile、合成 Git 仓库和证据，避免重跑覆盖失败记录。

## ¥8 跨进程硬上限

2026-10-23 核对 [DeepSeek 官方价格](https://api-docs.deepseek.com/zh-cn/quick_start/pricing/)：`deepseek-flash` 对应 DeepSeek-V4.1-Flash-1017；高峰未命中输入 ¥2 / 百万 tokens、输出 ¥8 / 百万 tokens，命中输入 ¥0.04。B 网关始终按未命中高峰价保守计算，不依赖闲时或缓存折扣。

用户授权总额 ¥20；既有费用及未知预留 ¥2.639110，A / B 新增各最多 ¥8，另余 ¥1.360890。B 只初始化自己的 ¥8 新账本，旧账本不修改、不重开，未知预留不回收。

`scripts/devflow-b-budget-gateway.py` 使用整数微元、`flock`、原子替换和 `fsync`。完整 UTF-8 请求字节加 8192 字节安全余量按输入价，加显式输出上限和额外 1000 微元，先落盘预留再转发。最大请求 512 KiB，最大输出 65,536 tokens（匹配产品低强度思考的默认输出限额）；未指定输出时显式设为 8192。超过限制拒绝，不偷减请求中的显式上限。只接受固定官方 HTTPS DeepSeek Flash 地址、文本内容和客户端 function 工具；重定向禁止。其输出长度限制属于验证设置，不修改产品默认配置。

网关保留思考设置、tool calls 和 SSE 协议，仅为流式请求启用 usage。正常完整响应按真实 usage 的保守价结算；缺 usage、取消、断流、HTTP 失败保留全部预留。账本缺失、损坏、授权关闭或真实计量超过预留时停止准入。多个进程同时预留也不能越过 ¥8。不会记录原始提示、正文、思考或凭据。

六项离线回归已通过：8 进程竞争、重启未知保留、关闭授权、不可重复初始化、坏账本与身份失败关闭、正常/不完整真实 HTTP SSE 传输与费用。使用的上游为本地合成服务，没有付费调用。

```sh
python3 scripts/devflow-b-budget-gateway.test.py
# 每个 B 授权只运行一次 initialize；已有文件会失败，不能更换目录绕过累计额度。
DEVFLOW_B_LIVE_AUTHORIZED=1 python3 scripts/devflow-b-budget-gateway.py --state /absolute/new-b-budget --initialize
DEVFLOW_B_LIVE_AUTHORIZED=1 python3 scripts/devflow-b-budget-gateway.py --state /absolute/new-b-budget --key-file /absolute/existing-authorized-key --port 0
python3 scripts/devflow-b-budget-gateway.py --state /absolute/new-b-budget --summary
python3 scripts/devflow-b-budget-gateway.py --state /absolute/new-b-budget --close
```

真实密钥只由网关从既有授权文件读取。Electron 中保存的是合成占位凭据。显式的 `devflow-b-electron-bootstrap.cjs` 将该验证子进程里官方 DeepSeek 的实际请求转发到 B 网关，Provider 仍使用官方 metadata、生产解析和治理代码。没有配置网关时调用在本地拒绝。该 bootstrap 使用验证专用凭据适配，不能宣称已验收系统钥匙串。

Web 项目金额策略仍显式启用，月限 USD 2、警戒 USD 1，为生产保守预留留出空间；这是产品显示的 USD 规则。两个合成项目共享同一个网关人民币 ¥8 硬限额，不能把 USD 月限换算为新增用户授权，也不能关闭产品预算来通过验证。

## 运行入口

```sh
node scripts/devflow-b-postgres.mjs
# 需先构建桌面。默认只做真实 Web 创建/配对/领取，不调用模型。
node scripts/devflow-b-live-harness.mjs
# 无 OpenCode 场景共享同一 B API/Web，使用另一个团队项目、请求和 Electron profile。
node scripts/devflow-b-no-opencode.mjs /absolute/opencode-output/ready.json
node scripts/devflow-b-set-budget.mjs /absolute/output/ready.json
node scripts/devflow-b-live-actions.mjs /absolute/output/ready.json status
```

每轮 `ready.json` 提供精确 API/Web/CDP/profile/Run/项目路径。CDP 先通过 Node fetch 读取 `/json/version`，再连接返回的 WebSocket，避免主机 HTTP 代理误处理回环地址。环境存活期间可通过 Playwright 直接操作真实 UI；controller 使用真实 renderer preload / IPC，不写业务 SQLite 或伪造状态。

负责人核对网关 `/budget` 后，才能将当前轮 `gateway.json` 的 `url` 从 `null` 改为该网关地址。`generate`、`review`、`code`、`permission`、`answer`、`retry` 还要求 `DEVFLOW_B_LIVE_AUTHORIZED=1`。操作结果和截图落入本轮目录。`approve-gate` 需要明确的 `reviewed:true` 并绑定当前产物修订；`permission` 需要精确请求 ID、Coding Run ID 和人工核对标记。没有自动批准模型提出的工具或最终 diff。

向输出目录写入 `STOP` 可以退出该轮的 Electron/API/Web；不影响另一个工作包。无 OpenCode 辅助会话只关闭自己的窗口。专用 PostgreSQL、网关及账本另由负责人在最后记录状态后关闭。

### 编码运行只读证据

```sh
node scripts/devflow-b-coding-evidence.mjs /absolute/opencode-output/ready.json before-cancel
node scripts/devflow-b-coding-evidence.mjs /absolute/opencode-output/ready.json after-restart /absolute/previous/evidence.json
node --test scripts/devflow-b-evidence-redaction.test.mjs
node --test scripts/devflow-b-test-evidence.test.mjs
```

脚本只读取该 profile 的真实 Electron 状态及当前可见用量、独立 Todo 的文件与 Git diff、当前 Provider 私有 OpenCode 数据库中严格匹配工作树和 Coding Run / workspace metadata 的记录。不会发送模型调用、回答问题、授权工具、调用 plugin endpoint 或改业务状态。SQLite 使用只读连接和 `query_only`；Git 禁止可选锁、外部 diff 和 textconv。只在本轮输出目录新增权限受限的证据文件。

`evidence.json` 保存全部 provider 事件及 request ID、父子会话归属、问答回执与权限、费用状态、工作树逐文件摘要、独立测试的工作树归属和 sourceTreeDigest 核对；`summary.json` 汇总并对照顶部显示。编码宿主标准测试与独立 workflow test 节点分别列出。产品已将测试 cwd 脱敏为 `<workspace>` 时，绝对路径比较为 `null`；只有 workspace / Coding Run / 项目 / Workflow 归属与实际磁盘摘要全部匹配才记 `workspaceBindingVerified: true`，缺失证据不能当作通过。完整 Git patch 保存为独立文件，疑似凭据脱敏；提示、答案、原始模型输出和命令正文只保留大小及摘要。受控文档读取仅保留官方 URL、状态、大小、重定向与正文摘要。工具 `completed` 状态不等于执行成功，须结合错误和实际文件检查。网关没有产品 request ID，证据明确不伪造一一映射。

采样不是原子快照，`firstMaxEventSequence` / `lastMaxEventSequence` 仅记录所有 Coding Run 的最大事件序号，`maximumEventSequenceUnchanged` 只比较该最大值，不能据此宣称每条事件或所有业务状态稳定。若 Electron 在两次读取之间重启，保存初始状态与宿主证据并明确标记结束样本缺失。取消和重启前后可以传入上份证据比对文件及 diff，结合明确 Run 状态和调用 ID 核验结果。真实 OpenCode 临时数据库被清理后，旧工具记录以已归档样本为证；脚本不会据缺失数据库猜测任务结果。

## 必须分别验收的行为

| 范围 | 观察证据 |
| --- | --- |
| #237 父子任务 | 同 Coding Run / 工作树 / 身份 / operation；父返回后仍等待全部子会话停止 |
| #237 问答与权限 | 子问题实际 UI 提交；答案不批准命令；旧修订和迟到回答拒绝 |
| #237 取消、恢复 | 取消后没有新写入；刷新同进程续答；重启旧问题失效、工作树保留 |
| #237 用量 | 上游账本、逐调用结算、父子归属与任务顶部 token 合计交叉核对；unknown 不算零 |
| #237 文档 | 结构化公开读取成功，私网/重定向/过大正文拒绝；来源与限制可审计 |
| #226 | 显式不存在的 OpenCode 路径；内置模型审查真实读取、引用核验、前后源码摘要一致；开发执行器保持原配置 |
| #182 | Web 创建请求 → Electron 任务中心查看及显式领取 → 唯一 Run → 澄清/设计/开发/独立标准测试/真实交付/业务验收 → 重启回读 |
| #245 | Markdown 默认、原文切换、原文和保存字节不变；不引入额外模型请求 |

本工具默认准备到澄清节点，不宣称六阶段已完成。GitHub 交付需独立合成 Todo 远端仓库、有效 GitHub App 服务端配置及安装授权和项目绑定，后续仍要独立 Web 批准。没有真实交付证据时，业务验收应保持阻断。

## 当前准备检查

- 真实 Web 创建合成项目与请求、正常配对、Electron 任务中心先查看再领取成功，保存 3 张截图；第一次自动化在 Next 页面切换尚未完成时填表被组件初始化清空，增加页面网络就绪检查后通过，保留首轮失败记录，没有改产品逻辑。
- B 专用 PostgreSQL 已启动，初次新建容器及数据卷，没有复用其他容器。
- bootstrap 已加载，controller 通过真实 CDP / preload 读取到唯一 Run；网关初始化时 0 调用、0 费用。
- `gh` 为 `erich04`，token 有 `repo` scope；尚未创建远端 Todo 仓库。B API 没有配置 `DEVFLOW_GITHUB_APP_ID` / `DEVFLOW_GITHUB_APP_PRIVATE_KEY_BASE64`。普通 OAuth token 列举 App 安装返回 403，不能据此推断已安装或未安装。项目绑定界面为 Web「设置 › GitHub 仓库」。
- 两个成功准备的 profile 为 `opencode-1792772386842` 与 `no-opencode-1792773287381`，保存在本工作树 `.tmp/devflow-b-20261023/`。后者的 OpenCode 探测结果明确为 `unavailable`，编码配置 `native-model` 与审查配置 `native-agent` 均已保存。两个项目的云端预算已通过 Web UI 保存并真实同步到 Electron。
- 两个 profile 的 `devflow-b-live-actions.mjs status` 均通过真实 Electron CDP 连接；此检查不触发模型。门禁、命令与最终变更仍需操作者独立批准。
- 运行中的 Next dev 与验证任务的 Next build 最初共写默认 `.next`，出现 routes-manifest 缺失与 Web 500。新增 `DEVFLOW_NEXT_DIST_DIR`（默认仍为 `.next`），B 指定 `.tmp/next-<schema>`；`devflow-b-resume.mjs` 在原端口恢复服务，并保留已有 schema、profile 和 Run。Next 自动产生的 next-env / tsconfig 路径变动已恢复，不作为产品代码提交；后续启动仍需检查这两份生成文件。
- 首次阶段触发在云端预算未配置时被产品准入拒绝，没有发送模型请求；随后 Thinking low 默认的 65,536 输出上限被网关最初的 32,768 上限拒绝，账本仍为 0 调用。已把验证上限明确提高至 65,536，保持请求内容和思考参数，并验证 65,536 准入 / 65,537 拒绝；网关使用同账本、同端口重启，没有重置额度。这两次都不属于上游模型失败。
- #226 已完成真实无 OpenCode 复验：前两次审查暴露多 JSON 拼接问题，在内置审查提示契约内修复，通用解析器保持严格。修复后真实 DeepSeek 审查保存三个文件引用，独立宿主核验全部摘要和行范围、九文件未写入、Gate 和编码配置未改变、失败用量也计入顶部。完整的成功与失败记录、截图路径、调用 ID 和费用见 [#226 真实验收记录](../validation/issue-226-native-review-20261023.md)。三次审查共保守人民币 0.264988 元，全部属于同一 B 8 元账本；不代表 #182/#237 全部验收完成。
