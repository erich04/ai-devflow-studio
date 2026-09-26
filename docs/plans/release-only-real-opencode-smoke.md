<a id="release-only-real-opencode-provider-smoke"></a>

# 仅发布时执行的真实 OpenCode 服务商冒烟

<a id="summary"></a>

## 摘要

本文保存 V1.3/V1.4 的真实付费 OpenCode 发布契约，要求创建对应标签前针对已配置服务商显式执行一次。历史上“每次后续发布都要执行”的宽泛说法不再作为通用授权：只有当前发布契约明确要求、并取得绑定候选的单独授权时才执行。V1.5 不要求也不授权再次进行付费模型冒烟，详见[运行时签署清单](../knowledge/checklists/opencode-runtime-signoff.md)。

该门禁排除在 `corepack pnpm verify`、默认 GitHub CI 和日常检查之外，因为会消耗额度且依赖本地配置。文档本身不代表 v1.3 已通过或失败；状态由发布 JSON、对应 release:status 模式及 v1.3.0 标签目标决定。

<a id="policy"></a>

## 策略

- 默认 CI 使用 `corepack pnpm verify` 和模拟编码引擎，不调用付费服务商。
- 对应发布签署增加明确的付费冒烟：`corepack pnpm --silent opencode:status`、`corepack pnpm --silent opencode:release-preflight`、`DEVFLOW_RUN_OPENCODE_SMOKE=1 ... corepack pnpm --silent test:opencode-smoke`，须在打标签前完成。
- V1.3 结果写入 `docs/releases/v1.3.0/real-opencode.json` 并绑定候选 C。
- V1.4 写入 `docs/releases/v1.4.0/real-opencode.json`，绑定 C，精确记录一次顶层付费冒烟、零未获额度请求，以及所有者明确授权且未设置硬性费用上限。
- 第二次顶层付费冒烟必须先有实质修改后的新候选及新的明确授权。
- 凭据绝不能写入文档、日志、截图、PR、GitHub 发布、团队摘要或冒烟产物。

<a id="standard-volcengine--doubao-command"></a>

## 标准火山引擎/豆包命令

使用已验证的本地配置。以下保留命令与英文占位符作为可识别模板；占位符表示只在 shell 设置、绝不提交的密钥，不能原样当真实凭据运行。

```bash
export ANTHROPIC_AUTH_TOKEN="<set in shell only; never commit>"
export DEVFLOW_RUN_OPENCODE_SMOKE=1
export DEVFLOW_CODING_ENGINE=opencode-http
export DEVFLOW_OPENCODE_PROVIDER_ID=double
export DEVFLOW_OPENCODE_MODEL_ID=ark-code-latest
export DEVFLOW_OPENCODE_API_KEY_ENV=ANTHROPIC_AUTH_TOKEN
export DEVFLOW_OPENCODE_RELEASE_PROFILE=v1.4

corepack pnpm --silent opencode:status
corepack pnpm --silent opencode:release-preflight
corepack pnpm --silent test:opencode-smoke

unset ANTHROPIC_AUTH_TOKEN DEVFLOW_RUN_OPENCODE_SMOKE DEVFLOW_CODING_ENGINE
unset DEVFLOW_OPENCODE_PROVIDER_ID DEVFLOW_OPENCODE_MODEL_ID DEVFLOW_OPENCODE_API_KEY_ENV
unset DEVFLOW_OPENCODE_RELEASE_PROFILE
```

若 OpenCode 不在 PATH，补充：

```bash
export DEVFLOW_OPENCODE_BIN=/opt/homebrew/bin/opencode
```

DEVFLOW_OPENCODE_BIN 须在三条命令之前设置。V1.3 精确配置为 double/ark-code-latest，密钥环境名称必须为 ANTHROPIC_AUTH_TOKEN，发布记录不能替换为 ARK_API_KEY。

V1.4 的精确服务商配置由候选代码持有，opencode:status 报告其身份。double/ark-code-latest 配合 ANTHROPIC_AUTH_TOKEN 时，覆盖环境中的内联 OpenCode 配置，使用候选拥有的 Responses API 配置：包 `@ai-sdk/openai`、地址 `https://ark.cn-beijing.volces.com/api/coding/v3`、引用 `{env:ANTHROPIC_AUTH_TOKEN}`。配置不含密钥值，传输超时有界。真实调用时，候选将地址换为持有凭据的出站门禁所拥有的随机回环能力地址；OpenCode 仅收到单次假凭据，只有门禁附加真实令牌，并固定转发到官方 Ark Responses 端点。

pnpm --silent 只隐藏包含候选工作目录的生命周期横幅；状态与冒烟输出仍显示，仍须通过路径与秘密脱敏检查。

前置检查以假凭据、隔离存储、macOS 网络沙箱运行 `opencode debug config --pure`。仅在内存解析 JSON，校验 Responses 包、地址、模型、超时，删除临时目录，只打印固定成功/失败摘要，不转发真实凭据。

托管进程强制 OPENCODE_CLIENT=server，禁用可选 question 工具覆盖；会话拒绝 question/task，因为 DevFlow 不转交这些交互/子会话通道。轮询精确父会话状态，永久丢弃服务商重试消息/动作详情，首次观察重试即以静态 `provider_retry_observed` 失败。初始段与每个续接段各有 **240 秒权限发现期限**，包括不响应取消的权限/状态请求；**不是整个冒烟限时 240 秒**。重试或超时均中止受管会话，验证清理完成后才结束。

严格工具配置先通配拒绝，仅 edit/bash 为 ask。持有凭据的出站门禁精确允许三段获额度请求：仅 bash、仅 edit、仅完成。前两段仅保留所需工具，tool_choice 为 required，禁用并行工具；完成段移除全部工具。初始额度只允许 bash，唯一已批准 bash 激活 edit，唯一已批准 edit 激活完成；额度不累计。回复权限前等待来源 Responses 流结束。无效批准顺序或未获额度请求本地拦截、撤销剩余额度，并永久标记失败。通过要求三段各产生一次成功 response.completed，未获额度拦截、无效请求、失败段均为 0，清理时活跃连接为 0。

<a id="required-evidence-to-record"></a>

## 必须记录的证据

V1.3 记录位置为 `docs/releases/v1.3.0/real-opencode.json`。以下键、枚举和格式占位符保留以对应机器契约；须替换为 C 上真实观察值，不能照抄 passed：

```json
{
  "targetVersion": "1.3.0",
  "candidateSha": "<C full SHA>",
  "status": "passed",
  "recordedAt": "YYYY-MM-DDTHH:mm:ss.sssZ",
  "opencodeVersion": "<version from opencode:status>",
  "provider": "double",
  "model": "ark-code-latest",
  "keyEnvName": "ANTHROPIC_AUTH_TOKEN",
  "duration": "<elapsed duration>",
  "permissionRelay": "<observed permission sequence>",
  "diffEvidence": ["devflow-opencode-smoke.txt"],
  "testEvidence": "passed",
  "cleanup": "passed",
  "redactionCheck": "passed"
}
```

V1.3 历史记录无需追补字段。V1.4 同路径版本目录的记录使用相同非秘密元数据，另加：

```json
{
  "targetVersion": "1.4.0",
  "candidateSha": "<C full SHA>",
  "status": "passed",
  "attemptCount": 1,
  "automaticRetry": false,
  "costCapUsd": null,
  "releaseProfile": "v1.4",
  "providerApiMode": "responses",
  "resolvedConfigPreflight": "passed",
  "providerRetryObserved": false,
  "egressGate": {
    "armedSegmentCount": 3,
    "forwardedRequestCount": 3,
    "completedResponseCount": 3,
    "blockedUncreditedRequestCount": 0,
    "blockedInvalidCount": 0,
    "failedSegmentCount": 0,
    "activeRequestCount": 0,
    "closed": true
  }
}
```

这些值描述授权边界，不是编造的账单。attemptCount 计算绑定候选的顶层调用；automaticRetry=false 要求启动器不重复调用、引擎未观察重试、未转发未获额度请求。后续合法模型步骤只能由明确托管权限批准单独激活。通过时本地拦截的未获额度请求也必须为零，否则不能记录 false。costCapUsd=null 明确表示授权**不设置硬性服务商费用上限**，不是未知或缺失。顶层调用一旦开始，不论成功、失败、超时还是服务商报错，都消耗唯一授权次数。

所有占位符用 C 的真实记录替换；recordedAt 为合法时间，diffEvidence 至少一条非空仓库相对变更路径。包括嵌套对象在内，禁止 apiKey、apiKeyValue、authorization、credential、password、providerToken、secret、token 字段。可记录 keyEnvName，不可记录其值。

| 字段 | 要求 |
| --- | --- |
| 日期/时间 | 真实冒烟本地日期与时间 |
| 候选 | C 的完整 SHA |
| OpenCode 版本 | 来自 corepack pnpm --silent opencode:status |
| 服务商/模型 | double / ark-code-latest |
| 密钥处理 | 仅 ANTHROPIC_AUTH_TOKEN 名称，不含值 |
| 结果 | 全部成功后才为 passed |
| 耗时 | 近似执行时长 |
| 权限转交 | V1.4 精确 bash → edit |
| 差异 | 仅仓库相对路径摘要 |
| 测试证据 | passed/failed/timed_out |
| 清理 | 受管工作树已删除，或 cleanup_failed |
| 脱敏 | 无密钥、cwd、原始 stdout/stderr、提示词或补丁输出 |

<a id="candidate-and-signoff-commit-binding"></a>

## 候选与签署提交绑定

对干净候选 C 运行，JSON 只能来自该次观察；candidateSha 等于 C 完整 SHA，不是后续证据提交或标签目标。

直接子提交 S 仅含该 JSON、walkthrough.json、required-gates.json 和带日期电脑验收结果。对应 V1.3/V1.4 标签尚不存在时，在干净 S 运行打标签前状态检查。匹配配置通过后，才能在同一 S 创建版本标签并运行带标签状态检查。

<a id="pass-criteria"></a>

## 通过标准

全部满足才通过：

- 明确 DEVFLOW_RUN_OPENCODE_SMOKE=1，候选拥有的 V1.4 Responses 无网络配置检查通过。
- 引擎明确 DEVFLOW_CODING_ENGINE=opencode-http，opencode serve 启动并创建受管会话。
- 精确转交两次真实权限，顺序 bash → edit。
- 出站门禁只转发三段获额度请求；清理时未获额度、无效、失败、活跃请求均为零。
- 生成脱敏差异，测试证据成功，工作树删除完成；任何清理失败均使冒烟失败。
- 输出不含服务商秘密。

必需字符串和 diffEvidence 均非空，testEvidence、cleanup、redactionCheck 必须精确为 passed，记录才有效。

<a id="failure-handling"></a>

## 失败处理

- 计费/网络暂不可用时不能标为签署通过；明确外部原因且工作紧急时，记录为阻塞或明确接受的风险，不能静默换模拟证据。
- 轨迹/视频可辅助演示，但不能替代最终真实冒烟。
- 缺二进制、引擎错误、配置缺失或前置阻断均是门禁失败。
- 观察到 provider_retry_observed 即失败，不等待或发起同一候选的第二次顶层调用。
- 权限超限、无变更路径、缺 tool_call/tool_result、依赖准备失败、测试失败、清理不完整、秘密/路径泄露、未处理进程/服务商错误均失败。
- 失败可记阻塞；新候选绑定的执行满足全部条件前，real-opencode.json 不得写 status=passed。

<a id="current-historical-evidence"></a>

## 历史证据

2026-06-20：v0.9.0 发布后的真实冒烟使用火山 Ark double/ark-code-latest、OpenCode 1.17.5，通过约 1 分 38 秒执行，转交 bash → edit → bash，生成 devflow-opencode-smoke.txt，运行样例测试并清理工作树。

<a id="applies-from"></a>

## 适用范围

V1.3/V1.4 按自身契约使用该门禁；后续版本只有自身发布契约明确要求并获得新授权时才适用。历史发布说明保留事实，不追溯修改其结果。
