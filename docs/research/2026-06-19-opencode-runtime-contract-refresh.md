<a id="opencode-runtime-contract-refresh"></a>

# OpenCode 运行时契约复核

日期：2026-06-19。相关计划：docs/plans/v0.9-real-runtime-observability.md；相关 ADR：docs/adr/0009-managed-opencode-coding-adapter.md。以下“当前”均指相应历史观察日期，不是今天重新探测的结论。

<a id="summary"></a>

## 摘要

v0.9.1 验证当时本地 OpenCode 基线，并记录 v0.9.2 应加固的契约；不修改运行时代码，也不声称新一轮真实服务商冒烟已完成。

本地 /opt/homebrew/bin/opencode 存在，版本为 1.17.5，与 v0.6 近期待签署记录一致。`corepack pnpm opencode:status` 是真实调用前安全检查本地版本、默认模拟、真实门禁和服务商配置的入口。

2026-06-20 复查：

- opencode:status 在 PR #3 head `ec878e5` 通过。
- 本地二进制仍报告 `1.17.5`。
- 默认禁用真实 OpenCode 冒烟，只有明确 DEVFLOW_RUN_OPENCODE_SMOKE=1 才开启。
- 签署 shell 有意不配置服务商，避免 verify 意外调用服务商；除非要真实冒烟，这是预期状态。

同日生命周期加固：进程边界公开 pid?: number，支持时使用 POSIX detached:true 启动服务以便进程组终止；SIGTERM 后回退 SIGKILL，无 PID/不支持平台使用 child.kill()。终态区分 cancelled、timed_out、interrupted。工作树状态为 active/deleted/cleanup_failed，发出脱敏 cleanup 事件，清理失败不覆盖业务终态。成功真实冒烟增加工作树清理断言，真实执行仍要求服务商配置。

<a id="existing-evidence"></a>

## 已有证据

v0.6 记录为 OpenCode 1.17.5、火山 Ark double/ark-code-latest。真实执行明确设置 DEVFLOW_RUN_OPENCODE_SMOKE=1、DEVFLOW_CODING_ENGINE=opencode-http、DEVFLOW_OPENCODE_PROVIDER_ID=double、DEVFLOW_OPENCODE_MODEL_ID=ark-code-latest；通过 bash → edit → bash → bash 多步权限，生成 devflow-opencode-smoke.txt，密钥未写项目文件。

这是历史证据；v0.9 声称当时运行时可演示前仍须重新真实签署。

<a id="current-code-contract"></a>

## 当时代码契约

<a id="engine-selection"></a>

### 引擎选择

来源：apps/desktop/electron/coding-engine.ts。

默认 fake，真实开关 DEVFLOW_CODING_ENGINE=opencode-http。真实输入包括 DEVFLOW_OPENCODE_BIN、DEVFLOW_OPENCODE_PROVIDER_ID、DEVFLOW_OPENCODE_MODEL_ID、DEVFLOW_OPENCODE_API_KEY_ENV；缺少最后一项时，默认密钥环境名为 OPENAI_API_KEY。

默认 `corepack pnpm verify` 必须保持模拟。仅设真实冒烟开关不够，还必须指定真实引擎，否则 test:opencode-smoke 在联系服务商前退出。

安全检查命令：

```bash
corepack pnpm opencode:status
```

不联系服务商/模型 API，只检查本地工具版本和是否有意配置真实环境。

<a id="http-transport"></a>

### HTTP 传输

来源：apps/desktop/electron/opencode-http-adapter.ts。仍选 opencode serve HTTP：

- `opencode serve --hostname <host> --port <port>` 启动。
- POST /session 创建会话。
- POST /session/:id/message 发消息。
- GET /permission 轮询权限。
- POST /permission/:id/reply 回复。
- POST /session/:id/abort 中止。
- GET /session/:id/diff 读取差异。

ACP 按 ADR 0009 延后，除非真实契约测试证明更适合。

<a id="permission-relay"></a>

### 权限转交

edit、bash、write、patch 默认先询问；另归一化收到的 install、external_directory。v0.9.2 必须验证真实 Agents 界面可见、可处理，不能只依赖单元测试。

<a id="cancel-and-timeout"></a>

### 取消与超时

已有 CodingEngineAdapter.cancel(input)、abortOpencodeSession(...) 及 opencode-process.ts 的托管关闭。v0.9.2 须证明运行中取消、等待权限或完成时超时、取消/超时/正常完成终态分离、全部终态清理工作树与服务。

代码已有终态区分、进程组回退及工作树清理状态的确定性单测，但仍需真实配置复验运行时行为。

<a id="diff-and-evidence"></a>

### 差异与证据

可读取 HTTP diff；OpenCode 返回空差异或变更后关闭消息流时，已有受管 Git 工作树 diff 回退。

保持模拟引擎一致结构：脱敏差异、依赖准备、本地测试、编码事件、仅脱敏远程摘要。不得向团队 API 发送原始提示词、stdout/stderr、补丁、cwd、服务商秘密或仓库外路径。

<a id="provider-contract-to-reconfirm"></a>

## 待重新确认的服务商契约

预期演示服务商为火山 Ark，但协议族（OpenAI/Anthropic 兼容）、地址、服务商/模型 ID、密钥环境名、代理及全局认证文件要求必须验证。

目标边界：凭据仅在运行时注入托管进程，DevFlow 不写全局 OpenCode 认证，日志不打印密钥。

<a id="provider-profile-template-no-secrets"></a>

### 服务商配置模板：不含秘密

用于 v0.9 真实验证起点，记录已知火山 Ark 自定义配置结构而不提交密钥或全局认证。2026-06-20 本地 ~/.config/opencode/opencode.json 使用 double、ark-code-latest、https://ark.cn-beijing.volces.com/api/coding/v3、@ai-sdk/openai-compatible。

密钥只留本地；冒烟前置仍要求明确环境变量。以下英文占位符表示仅在 shell 设置、绝不提交，按原命令模板保留：

```bash
DEVFLOW_RUN_OPENCODE_SMOKE=1 \
DEVFLOW_CODING_ENGINE=opencode-http \
DEVFLOW_OPENCODE_BIN=/opt/homebrew/bin/opencode \
DEVFLOW_OPENCODE_PROVIDER_ID=double \
DEVFLOW_OPENCODE_MODEL_ID=ark-code-latest \
DEVFLOW_OPENCODE_API_KEY_ENV=ARK_API_KEY \
ARK_API_KEY="<set in shell only; never commit>" \
corepack pnpm test:opencode-smoke
```

- double、ark-code-latest 来自 v0.6 历史签署。
- ARK_API_KEY 是环境名称，不是值；本地配置保存凭据，而环境变量仍是 DevFlow 明确启动的门禁。
- 不得将服务商密钥写入项目、截图、冒烟输出、全局 OpenCode 认证、PR 或团队摘要。
- 2026-06-20 使用上述开关和 ARK_API_KEY 配置通过 bash → edit → bash → bash；原输出 `opencode smoke passed; changed paths: devflow-opencode-smoke.txt` 表示冒烟通过。
- 2026-06-20 的 v0.9.0 发布后真实冒烟改用从本地配置读取、未打印的 ANTHROPIC_AUTH_TOKEN 环境，仍为 double/ark-code-latest，约 1 分 38 秒，转交 bash → edit → bash，同样生成文件、运行样例测试、清理工作树。

<a id="2026-08-09-v14-release-update"></a>

### 2026-08-09 V1.4 发布更新

上面的 Chat 配置保留为此前成功记录。V1.4 使用候选绑定配置 `@ai-sdk/openai`，使 OpenCode 使用 Responses API；这对应当时火山 Coding Plan 推荐，不是本次重新查询官方建议。同样服务商/模型/编码地址及仅环境凭据边界，外部配置不能覆盖候选配置。

托管进程禁用 question，会话拒绝不支持的 question 和子会话 task；只读取 /session/status 精确父项，丢弃重试 message/action，首次重试即 provider_retry_observed 失败。每段 240 秒权限发现期限覆盖权限及状态请求，即使注入 fetch 忽略取消也生效；批准后重置，并非全流程总期限。这区分重试和普通超时，且不留服务商正文、秘密或路径。

仅发布的真实执行向 OpenCode 传假凭据和随机回环地址，由候选的出站门禁独占真实令牌并固定到官方 Ark Responses。严格三段：仅 bash 且强制工具、仅 edit 且强制工具、仅完成并移除工具；只有精确上一权限批准才放行下一段。每段须有成功 response.completed SSE 终止事件，并证明无未获额度请求抵达 Ark，才能记录 automaticRetry=false。

<a id="v092-go-criteria"></a>

## v0.9.2 开始条件

只有目标版本已记录、传输与 ADR 0009 一致或已更新、配置无秘密、权限/取消/超时/默认拒绝/diff/清理各标支持/不支持/延后，且默认跳过真实冒烟并仅由 DEVFLOW_RUN_OPENCODE_SMOKE=1 开启时，才从契约复核进入加固。

<a id="open-questions-for-live-signoff"></a>

## 真实签署待确认问题

- 当时环境的 1.17.5 是否仍提供相同会话/权限/diff HTTP 端点？
- 火山 Ark 哪种兼容协议更稳定？
- 权限待回答时 abort 是否可靠停止？
- 超时清理是否总能终止服务并删除受管工作树？
- 哪些真实轨迹事件应进入 v0.9.3 Agents 界面？
