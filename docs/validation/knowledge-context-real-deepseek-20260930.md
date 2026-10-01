# 知识上下文真实 DeepSeek 验证 — 2026-09-30

## 结果与边界

本次验证对应[知识上下文改造方案](../plans/knowledge-context-redesign-2026-09-29.zh-CN.md)的待定事项 3，用真实模型检查 ADR 0025 的知识上下文：项目说明（L0）和按阶段放入的知识目录（L1）有没有真的发给模型，模型有没有按它们做事。

结论：下文列出的路径全部跑通，覆盖 Direct Provider、DevFlow Native 和 OpenCode 三种执行方式。

- 每次调用记下的上下文清单，和请求里实际带的内容一致。
- 模型的产出遵守了只写在 `AGENTS.md` 和 `docs/knowledge` 里的约定。需求原文没有提到这些约定。

共运行 6 次，发出 69 个请求，按峰时价上限估算约 $0.19。重试 5 次，失败原因如下：

- 3 次由产品问题或本机网络引起。新登记 [#207](https://github.com/erich04/ai-devflow-studio/issues/207)–[#209](https://github.com/erich04/ai-devflow-studio/issues/209)，[#201](https://github.com/erich04/ai-devflow-studio/issues/201) 又复现一次。
- 1 次失败原因被兜底错误码掩盖，没有查明。
- 1 次是 OpenCode 返回的仓库引用校验不通过，按设计拒收。

环境：

- 代码：main `a61fc28`，包含 K0–K4、知识审查 local-agent、#204 和 #205。桌面端在本机构建，未打包、未签名。
- 模型：`https://api.deepseek.com` 的 `deepseek-flash`。Provider 的思考设置保持默认（应用默认为开启 · low）。
- OpenCode：本机 Homebrew 安装的 1.18.15。

覆盖：

- Direct Provider：需求澄清、方案设计、两个门禁审查。
- DevFlow Native 编码，以及随后的测试证据。
- OpenCode 只读阶段 Agent：需求澄清、方案设计。
- OpenCode 门禁审查（local-agent）。
- OpenCode 编码。
- 讨论栏的两种执行方式，即 Direct Provider 和 OpenCode。

**不包括**：

- PR 交付包、GitHub 发布、业务验收。
- 知识页的界面走查。
- Web 端、真实 Postgres、系统钥匙串、打包安装。

## 环境与操作方式

隔离方式与 [#203 的真实流程验证](real-deepseek-flow-20260930.md)相同：

- 每次运行都新建临时示例仓库、临时用户数据目录和独立的数据档案注册表。
- Team API 用内存版演示实例；桌面端没有启用演示数据。
- 团队预算为每月 $1.00，预警 $0.50。

密钥：

- 取自本机开发档案（`local-development`）里已保存的 DeepSeek 凭据。系统钥匙串只在这一步用于解密一次，结果写入权限为 0600 的临时文件。
- 运行时，密钥只保存在当次的临时用户数据里。
- 所有临时环境和密钥文件在记录完成后已删除。本记录和仓库中都不含密钥。

出网：

- 桌面主进程的 `fetch` 只放行本机回环地址和 `api.deepseek.com`，6 次运行中没有被拦截的请求。
- OpenCode 子进程自己发起的网络请求不在这个控制之内，见 #209。

请求记录：

- 每个发往 DeepSeek 的请求正文（不含请求头）存放在执行者本机的临时目录，只用于核对，已随临时目录删除。
- 本记录只写各类标记是否出现、token 用量和状态码。

操作方式与 Electron 冒烟测试相同，通过桌面端 IPC 完成：选择仓库、配对、保存 Provider、预算、执行器配置、阶段生成、审查、审批、编码、精确差异审批、测试和讨论。没有截图，也没有逐项点击界面。

## 示例仓库

仓库是一个无依赖的 `health-api`，测试命令为 `npm test`（`node --test`）。

除了源码，仓库里有：

- `src/clock.js`：导出 `now()`、`setNow()`、`resetNow()`。
- `AGENTS.md`（355 字节）。
- `docs/knowledge/` 下的 4 篇规范，见下表。

每个说明文件里都放了一个唯一的 HTML 注释标记（如 `<!-- kcv:clock -->`），用来判断哪份内容进了请求。

| 文件 | 标记 | 适用阶段 | Gate 依据 | 内容要点 |
| --- | --- | --- | --- | --- |
| `AGENTS.md` | `kcv:L0` | — | — | 不引入依赖；新增测试名称以 `[health-api] ` 开头；注释用中文 |
| `docs/knowledge/time-and-clock.md` | `kcv:clock` | clarify、design、build | — | 业务代码必须用 `now()` 取时间；测试用 `setNow()` 固定时间 |
| `docs/knowledge/api-response.md` | `kcv:api` | design、build | design | camelCase；时间点字段以 `At` 结尾，值为 UTC ISO 8601 |
| `docs/knowledge/testing-evidence.md` | `kcv:testing` | design、test | test | 时间断言必须比较固定时钟下的精确 ISO 字符串 |
| `docs/knowledge/release-checklist.md` | `kcv:release` | pr | — | 更新 `CHANGELOG.md`；版本号只由维护者在发布当天修改 |

需求原文没有提到时钟、字段名和测试名前缀：

> 给 src/health.js 的 health() 返回结果增加一个表示本次检查时间的字段，字段名和取值方式按项目约定；保留原有 status 字段和值不变。在 src/health.test.js 中补充一条测试覆盖这个字段。不引入新依赖，只改这两个文件。

讨论栏的问题只能从 `release-checklist.md` 找到答案。这篇规范只适用于 pr 阶段，因此不会常驻在任何提示里：

> 只读提问……按这个项目知识目录里的规范：发布前需要检查哪些事项？版本号由谁、在什么时候修改？请写明依据的文件路径。

## 结果

### 阶段生成与门禁审查

| 路径 | 结果 | 上下文清单 | 请求中出现的标记 |
| --- | --- | --- | --- |
| Direct 需求澄清 | 通过 | L0 由 DevFlow 注入；整篇放入 time-and-clock；另外 3 篇只列目录（其他阶段） | L0、clock |
| Direct 方案设计 | 通过 | L0 由 DevFlow 注入；整篇放入 api-response（Gate 依据）、testing-evidence、time-and-clock；release-checklist 只列目录；1,007 / 24,576 字节 | L0、clock、api、testing |
| Direct 需求确认审查 | 重试后通过（#201） | 审查记录 `knowledgeReferences` | L0、clock |
| Direct 方案评审审查 | 通过 | 同上 | L0、clock、api、testing |
| OpenCode 需求澄清 | 重试后通过 | L0 由执行器加载；知识部分与 Direct 相同 | 首轮：L0、clock；之后按需读取其余规范 |
| OpenCode 方案设计 | 通过 | L0 由执行器加载；知识部分与 Direct 相同 | 首轮：L0、clock、api、testing |
| OpenCode 需求确认审查、方案评审审查 | 需求确认审查重试后通过；方案评审审查一次通过 | 仓库引用 9 个文件，包括 4 篇规范和 `AGENTS.md` | 首轮带 L0，之后按需读取 |

- **清单与请求一致**：
  - Direct 路径中，请求里出现的标记正好是清单里 L0 和整篇放入的文档。只列目录的文档，标记没有出现在首个请求里。
  - OpenCode 路径中，L0 的标记出现在 OpenCode 自己的系统提示里（`Instructions from: <临时仓库>/AGENTS.md`），DevFlow 没有重复注入。这与清单里 `loadedBy: executor` 一致。
- **没有泄漏用户全局配置**：执行者本机 `~/.config/opencode` 下有自己的配置和插件。所有 OpenCode 请求里，“Instructions from” 只出现过仓库或工作树的 `AGENTS.md`，也没有出现用户主目录下的路径。
- **模型产出遵守了约定**：
  - Direct 和 OpenCode 的方案都把字段定为 `checkedAt`，取值用 `now().toISOString()`，测试用 `setNow()` 固定时间并以 `[health-api] ` 开头。
  - Direct 方案评审审查逐条对照 `api-response.md`、`time-and-clock.md` 和 `testing-evidence.md` 给出意见。
- **按阶段筛选生效**：`api-response.md` 只适用于 design 和 build，所以需求确认阶段看不到它。两次 Direct 需求确认审查都据此指出“字段名尚未按项目约定确定”，把定名留到方案设计阶段。这是示例仓库的配置结果，不是缺陷。

### 编码

| 执行器 | 结果 | 编码回执中的上下文清单 | 请求中出现的标记 |
| --- | --- | --- | --- |
| DevFlow Native | 通过：2 次调用，1 次精确差异审批，测试通过 | L0 由 DevFlow 注入（放在简报中）；整篇放入 api-response、time-and-clock；另外 2 篇只列目录；696 / 8,192 字节 | 分析阶段：L0、clock、api。改码阶段还出现 testing，因为分析阶段在目录中选择读取了 `testing-evidence.md` |
| OpenCode | 通过：4 次权限审批（执行授权、2 次命令、最终改动），测试通过 | L0 由执行器加载；知识部分与 Native 相同 | 5 轮都带 L0（OpenCode 加载工作树的 `AGENTS.md`）、clock、api |

两个执行器都只改了 `src/health.js` 和 `src/health.test.js`，结果几乎一样。Native 的实现：

```js
import { now } from "./clock.js"
export function health() { return { status: "ok", checkedAt: now().toISOString() } }
```

新增的测试名为 `[health-api] health() 返回本次检查时间 checkedAt`。测试先 `setNow(new Date("2026-01-02T03:04:05.000Z"))`，断言 `checkedAt` 等于该 ISO 字符串，最后在 `finally` 中 `resetNow()`。OpenCode 的版本多一行中文注释。实现代码里没有直接调用 `new Date()` 或 `Date.now()` 取时间。

### 讨论栏

| 执行方式 | 结果 | 工具调用 | 回答 |
| --- | --- | --- | --- |
| Direct Provider | 通过，6 次模型调用 | `knowledge_list` → `knowledge_read` 读 `release-checklist.md` → `AGENTS.md` → `testing-evidence.md` | 列出 3 项检查；写明版本号由维护者在发布当天修改；给出依据路径 |
| OpenCode | 通过，4 轮上游请求 | `knowledge_list` → `knowledge_read` 读 `release-checklist.md` → `AGENTS.md`，再用 `repo_search` 在 `docs/knowledge` 内搜“版本” | 同上，并说明搜索只命中这一处 |

两种执行方式的前几轮请求里都没有任何标记。`release` 标记只在 `knowledge_read` 之后出现。也就是说，讨论栏不常驻 L0 和 L1，知识靠工具按需读取，与 K3 的设计一致。

## 失败与重试

| 运行 | 停在 | 表现 | 登记 |
| --- | --- | --- | --- |
| 第 1 次 | Direct 需求确认审查 | 第一次请求返回 200、`stop`，输出 2,766 tokens，报「模型返回的正文格式不完整」；重试通过 | [#201](https://github.com/erich04/ai-devflow-studio/issues/201) 补充了这次复现 |
| 第 2 次 | OpenCode 需求确认审查 | 经预算中继的一次请求失败：`ECONNRESET`，TLS 建立前连接断开，属于本机网络偶发问题。之后同一项目的全部模型调用都被预算检查拒绝（「有模型调用的实际费用尚未确认」），包括重试的审查、方案设计（报 `cli_unavailable`）和两个讨论会话 | [#208](https://github.com/erich04/ai-devflow-studio/issues/208) |
| 第 3 次 | OpenCode 方案评审审查 | 同第 2 次：TLS 建立前断开，随后被预算检查拒绝。这一次需求澄清、需求确认审查和方案设计都已通过 | #208 |
| 第 5 次 | OpenCode 需求澄清 | 第一次：模型最后一轮正常结束（`stop`），执行器却报 `cli_unavailable`，真实原因被兜底错误码掩盖；重试通过 | 未单独登记 |
| 第 5 次 | OpenCode 需求确认审查 | 第一次：OpenCode 返回的仓库引用校验不通过（路径越界、文件不存在或行号超出范围），按设计拒收，没有保存报告；重试通过 | 属于预期行为 |

第 4 次运行只跑讨论栏，第 6 次运行 Direct 阶段加 OpenCode 编码，两次都一次通过。

## 发现的问题

- **OpenCode 步骤的费用记为未知**（[#207](https://github.com/erich04/ai-devflow-studio/issues/207)）。OpenCode 阶段 Agent 和 OpenCode 门禁审查的用量记录共 10 条，都是 `costStatus: unknown`、`costUsd: null`，但 token 数齐全。Direct 路径的记录则是 `estimated`。读代码判断，原因是执行器拿到的是预算中继的回环地址，因此没有识别出官方 DeepSeek。OpenCode 编码运行的记录里也没有 `runtimeCostSummary`，是否是同一原因尚未核实。
- **TLS 建立前的失败会阻断整个项目**（#208）。见上表第 2、3 次运行。
- **只读 OpenCode 会话每次重新下载 ripgrep**（[#209](https://github.com/erich04/ai-devflow-studio/issues/209)）：
  - OpenCode 阶段 Agent 和审查中，有 8 处相邻两轮请求之间停顿了 57–108 秒，都出现在 `glob`/`grep` 轮次之后。有一次 `grep` 的结果是 `ripgrep execution failed`。
  - 本机没有安装 `rg`，而这些会话每次都使用新建的隔离配置目录。
  - OpenCode 编码运行和 OpenCode 讨论会话没有出现这种停顿。
  - 上述停顿原因是推断，没有抓包确认。
- 未单独登记的观察：
  - 阶段 Agent 的兜底错误码 `cli_unavailable` 会掩盖真实原因。第 2 次运行中，方案设计在预算检查拒绝之后失败，没有发出上游请求，也显示为这个错误码。
  - Native 分析阶段又读取了已在简报里的 `AGENTS.md`、`api-response.md` 和 `time-and-clock.md`，约 800 字节重复，不影响结果。
  - OpenCode 会话的请求中含有临时仓库的绝对路径，与 11.1 已记录的限制相同。
  - [#200](https://github.com/erich04/ai-devflow-studio/issues/200) 没有复现：Native 分析阶段输出 816 / 2,048 tokens，思考为默认开启。本次代码在修复 #200 的 #206 合入之前。

## 费用

6 次运行共发出 69 个请求：

- 输入 531,579 tokens，其中缓存命中 407,552。
- 输出 97,447 tokens。

费用：

- 按 DeepSeek Flash 峰时价计算的上限约 $0.19。
- 桌面端有金额的记录合计 $0.058：Direct 阶段与审查 $0.0557（估算），Native 编码 $0.0025（已结算）。OpenCode 步骤没有金额，见 #207。
- 实际扣费以 DeepSeek 控制台为准。

## 留存

没有提交进仓库的内容：

- 验证脚本、运行报告、请求正文、生成的澄清稿和方案、精确差异、工作树文件，都放在执行者本机的临时目录，记录完成后已删除。
- 验证脚本放在仓库之外。它基于 #203 的脚本，复用了 `scripts/workspace-baseline/environment.mts` 中的隔离环境工具。

## 后记：#207、#208 的修复（2026-09-30 补记，正文不改）

两个问题已在同一个 PR 中修复。修复后没有再用真实模型复跑，只用本地假模型验证。

**#207 的原因与修复**：

- 原因与正文的推断一致。OpenCode 的每一轮请求都经过受预算治理的本机中继，执行器只看到中继的回环地址，所以认不出官方 DeepSeek。
- 修复：
  - 阶段 Agent 改按保存的 Provider binding 判断计价方。
  - 中继汇总的用量带上计价方和完整的缓存拆分，门禁审查因此也能计价。只要有一轮缺少缓存拆分，整次会话仍记为未知。

**#208 的原因与修复**：

- 原因：中继把上游 fetch 的异常原样抛出，预算记账一律按“可能已送达、费用未知”处理。
- 修复：中继改用直连路径的传输错误分类，以下几种情况都按“未发出”结算，费用为 0：
  - TLS 握手完成前连接被关闭。Node 对这种情况固定报这一条 `ECONNRESET` 信息。
  - 连接被拒绝、主机或网络不可达、连接超时。
- 不变：连接建立之后的 `ECONNRESET` 仍按“可能已送达”处理。
- 这个分类同时作用于 Direct Provider 路径。

**验证**（隔离数据，本地假模型，没有调用真实模型）：

- 场景：
  - 真实的桌面主进程、本机 OpenCode 1.18.15、预算中继和启用预算的内存版 Team API。
  - `api.deepseek.com` 由本地假模型应答，返回 DeepSeek 格式的用量。
  - 先跑 OpenCode 需求澄清，再跑 OpenCode 门禁审查。审查的第一个上游请求被注入“TLS 握手前断开”，随后重试审查。
- 修复前的构建：
  - 澄清的用量为 `unknown`。
  - 重试的审查被拒绝（「有模型调用的实际费用尚未确认」）。
  - 团队端 `unknownCostCount: 1`。
  - 与正文第 2、3 次运行的表现一致。
- 修复后的构建：
  - 澄清和审查的用量都为 `estimated`，每次调用 $0.0006612，与团队端的结算金额相同。
  - 被注入失败的那次审查记为 0 费用。
  - 重试的审查通过。
  - 团队端没有未知费用。
- 单元测试：
  - 用一个立即关闭连接的本地 TCP 服务，复现了真实的 TLS 握手前断开。
  - 中继的计价方与缓存拆分。
  - 阶段 Agent 与审查的计价。
- `corepack pnpm verify` 通过。

**补充**：正文提到 OpenCode 编码运行没有 `runtimeCostSummary`。这一点与 #207 无关：OpenCode 编码执行器的计费方式是 `opaque`，本来就不生成费用摘要。它的每一轮调用照样经过中继，在团队端逐次结算。
