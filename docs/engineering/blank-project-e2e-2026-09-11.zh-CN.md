# 空白项目连续端到端验证

本轮从全新空仓库、空本地目录、全新 Desktop 数据档案和首次创建的 Project / Work Request 开始，已完成真实需求承接、澄清、设计、代码生成、测试、GitHub Draft PR、业务验收和合并。最终 Workflow 为 completed / v15，8 个节点全部 success；Web 证据链为 100%。没有复用旧测试项目、旧需求、旧 pairing 或旧应用代码。

服务端运行在本机 Docker API/Postgres（4310）和生产构建 Web（4313），真实外部云服务是 DeepSeek 与 GitHub。本记录证明这套 Web/服务端与 Desktop 的完整工作流及真实 GitHub 上库；不代表已经验证远端 DevFlow 部署或公网网站托管。

## 最终交付

- [应用仓库](https://github.com/erich04/devflow-blank-mini-agent-20260911)，private。
- [PR #1](https://github.com/erich04/devflow-blank-mini-agent-20260911/pull/1)：由产品创建 Draft PR；业务验收通过后，操作者于 2026-09-12T06:09:39Z 将其转为 ready 并合并。
- 产品交付提交：`38b3efbe5c8b6232c157dd7f78bec51cb19ee075`。
- main 合并提交：`c2be68d6c4a03fc219c483acc79a90fdf6e11ab6`。
- 两者代码树均为 `cb370a0b02a14df0b69e733d61c5bee122effadf`。本地 main 已从 GitHub fast-forward 更新，重新执行 `npm test`，17 项全部通过，工作区干净。
- 本地应用目录：`out/blank-project-e2e-20260911/blank-mini-agent`。零第三方依赖，直接 `npm start`，访问 `http://127.0.0.1:5173`；`npm test` 使用 Node 内置测试运行器。

GitHub 合并由操作者通过 CLI 完成。DevFlow 本次受控交付能力的终点仍是 Draft PR 与业务验收，不能据此宣称产品会自动合并或发布公网网站。

## 从零起点与首次接入

| 对象 | 本轮首次创建的记录 |
| --- | --- |
| Team Project | `p-blank-mini-agent-e2e-20260911` / Blank Mini Agent E2E 20260911 |
| Work Request | `work-request-bce761e3-69f3-4c8d-a42b-43734b313437` |
| 唯一 Workflow Run | `run-work-request-b88e91b724aaffc72b522a4932abd2b4` |
| Local Project | `local-6e83099daa26` |
| Desktop 档案 | `blank-project-e2e-20260911`，首次启动为 0 Run、未配对 |
| GitHub repository | `erich04/devflow-blank-mini-agent-20260911` / ID `1366921281` |
| Repository binding | `github-binding-5a4a566f-ce27-4aa9-909b-63c0eba6297d` / v1 |
| GitHub App installation | `153168718`，用户为这个新仓库单独授权 |

原始一句话需求：

> 从空白仓库创建一个中文任务清单网页，支持新增、完成、删除任务，刷新后保留内容，并提供自动化测试和运行说明。

仓库创建于 2026-09-12T03:53:36Z。初始 GitHub refs 查询返回空仓库，本地目录也是空的。操作者通过 GitHub CLI 建仓，并建立初始空提交 `4bda12d72b085db4777e5b7b2918c464fa2dc9aa`，其树为 Git 空树 `4b825dc642cb6eb9a060e54bf8d69288fbee4904`。没有 README、脚手架、应用代码或测试文件。这一步提供受管 worktree 和 PR 所需的 Git 基线，不是 DevFlow 自动建 GitHub 仓库或自动初始化 Git 的证明。

之后通过实际 Web 创建 Project、绑定仓库、提交一句话 Work Request、生成首次 pairing code，再在全新 Desktop 档案消费该 code，从 Inbox 承接为上述唯一 Run。用户完成了 GitHub CLI 重新登录、新仓库 GitHub App 授权，以及正常 Provider 表单中保存 DeepSeek Key；没有把密码或 Key 写入聊天和证据文档。

## 实际执行链

| 阶段 | 实际执行与证据 |
| --- | --- |
| 澄清 | Direct DeepSeek 生成 v1，依据实际结构化反馈生成 v2、v3。v3 无开放问题；真实审查后，Web 需求 Gate 于 05:04:28Z 得到 Desktop 回执。 |
| 设计 | Direct DeepSeek 于 05:05:31Z 生成原生 HTML/CSS/JS、localStorage、Node 内置测试和运行说明的方案，并实际运行方案审查。Web 方案 Gate 于 05:15:44Z 得到 Desktop 回执。 |
| 开发 | 真实 OpenCode 1.18.15 调用 DeepSeek；所有应用、README 和测试文件由它在本轮空基线的受管 worktree 中生成。执行授权、工具权限和最终变更接收均走实际 Desktop UI。 |
| 代码接收 | 最终 Coding Run `coding-run-aa76be40-3f7c-462a-8758-3c2cae827260` completed。11 个文件；独立重新计算 Git diff SHA-256 与保存的 Diff Artifact 一致，才批准接收。 |
| 测试 | Coding canonical tests、Workflow Test 节点、GitHub 交付提交复验均实际执行 `npm test`，各 17 项通过。没有只凭 Agent 自述标记成功。 |
| 浏览器验收 | 实际 Chrome 执行新增、回车提交、trim、完成/撤销、删除、刷新持久化、200/201 Unicode 字符边界、文本安全显示、坏存储及禁用存储退化；另核对 HTTP MIME、404、路径穿越和 PORT 覆盖。全部通过。 |
| GitHub 交付 | 产品生成提交及 Intent；Web 对精确提交、版本、路径、摘要指纹审批；Desktop 使用受控 GitHub 凭据 push，API 创建真实 Draft PR #1。Delivery Request v8 / completed。 |
| 最终验收 | 先生成验收包，再调用真实 Direct DeepSeek 审查。结果为 warn，0 missing evidence，无阻塞知识缺口。操作者核对完整差异及浏览器证据后，从 Web 提交最终批准；Desktop 执行并返回回执。 |
| 合并与回读 | 操作者合并 PR，本地从 GitHub 更新 main；17 项测试再通过，代码树与产品交付提交一致。 |

3 次 Coding attempt 属于同一条原始需求。首个失败、第二个取消的记录保留；修复后第三次从同一个空 Git 基线重新生成。第二次生成的补丁仅保存在外部诊断目录，没有复制进最终 worktree。

最终 diff 指纹：`c060cbf83cd9b12370273089fa3609f75cf0e888a43aec348d6cb15a6542a225`。

| 验证记录 | ID |
| --- | --- |
| Coding test evidence | `evidence-7842280d-eda4-4e60-9775-aa95363086ab` |
| Workflow Test evidence | `evidence-5324f162-2e7d-4f45-978d-11f524a075a7` |
| 精确交付提交复验 | `github-delivery-test-79440920-92dc-4c03-bb70-5072d132c51a` |
| Delivery Intent | `github-delivery-intent-a674a6f7-83df-4f7f-a52e-778362025922` |
| Delivery Request | `github-delivery-0d826fa2-2809-4bc8-9526-1fb70ca91a71` |
| 最终验收审查 | `agent-review-review-request-255f09e8-b906-4030-a9d8-c16849aaefd5-electron` |
| Web 最终审批 Command | `gate-command-cf743760-c013-493f-8d1f-50f250d67d39`，06:08:41.789Z acknowledged |

重启实际 Electron 后，同一 Run 仍为 completed；正常同步后显示“已绑定 · 已同步”。本轮未直接修改业务 SQLite、伪造审批回执或用 REST 写入代替这些 UI 操作。

## 本轮发现及修复

| Issue | 复现与修复 | 修复 PR |
| --- | --- | --- |
| [#104](https://github.com/erich04/ai-devflow-studio/issues/104) | 空目录错误继承祖先 Git 仓库。统一真实 Git 根目录校验；原生目录选择与隔离 Git 回归通过。 | [#105](https://github.com/erich04/ai-devflow-studio/pull/105) |
| [#106](https://github.com/erich04/ai-devflow-studio/issues/106) | Windows 真实 Git 集成测试超出默认 5 秒。延迟 Git 复现后只调整外层测试时限，Provider 超时规则不变。 | [#105](https://github.com/erich04/ai-devflow-studio/pull/105) |
| [#107](https://github.com/erich04/ai-devflow-studio/issues/107) | 同步团队未刷新独立预算 hook。修复成功同步回调，在 Web 修改预算、Desktop 仅点击同步即可显示新值。 | [#109](https://github.com/erich04/ai-devflow-studio/pull/109) |
| [#108](https://github.com/erich04/ai-devflow-studio/issues/108) | 阶段 Provider 失败只保留通用错误。真实 HTTP fixture 覆盖 401/429/503/坏响应/断连，保留安全错误分类；同一真实需求重试成功。原首次失败原因无法追溯，未擅自归因。 | [#109](https://github.com/erich04/ai-devflow-studio/pull/109) |
| [#111](https://github.com/erich04/ai-devflow-studio/issues/111) | OpenCode 健康 busy 仍被短审批发现窗口终止。延长健康 busy 的发现窗口，但固定总执行期限、失联与拒绝规则不变。 | [#112](https://github.com/erich04/ai-devflow-studio/pull/112) |
| [#113](https://github.com/erich04/ai-devflow-studio/issues/113) | 零依赖新项目不必要地等待 install，完成后又缺少审批请求。精确识别无安装工作的独立项目；有安装工作的情况走既有一次性审批及恢复机制。 | [#115](https://github.com/erich04/ai-devflow-studio/pull/115) |
| [#114](https://github.com/erich04/ai-devflow-studio/issues/114) | 消息返回与 session idle 不一致时可能过早采集差异。最小测试先失败，再等待真实 idle 后采集最终 Git diff；本轮最终指纹独立核对一致。原第二次会话的底层传输结果不可追溯，不宣称已确定其原始成因。 | [#115](https://github.com/erich04/ai-devflow-studio/pull/115) |
| [#110](https://github.com/erich04/ai-devflow-studio/issues/110) | Provider 名称 deepseek 与安全保存的内部 ID 不同，手填易错。用户批准后改为默认选择已保存 Provider，展示名称/模型，自动提交真实 ID；手填保留在高级选项。实际 Electron 选择、检测、保存 v4 成功，认证可用；高级开关启用/禁用字段正常。 | [#116](https://github.com/erich04/ai-devflow-studio/pull/116) |
| [#117](https://github.com/erich04/ai-devflow-studio/issues/117) | README.md 与小写路径在 JS 和 Postgres 排序不同，导致 Delivery INSERT 失败。增量迁移 28 验证路径界限、去重及防穿越，不对签名数组另施数据库排序；API 仍验证规范顺序与摘要。原 Intent 不改写即恢复，完成真实 push 和 PR。 | [#118](https://github.com/erich04/ai-devflow-studio/pull/118) |
| [#119](https://github.com/erich04/ai-devflow-studio/issues/119) | 收尾 CI 发现 pairing code 偶发不出现；进一步确定性复现首次 passive effect 会丢弃已发出的有效请求。仅在项目/账号/角色实际变化时重置，保留旧响应隔离。20 项相关测试及 41 项浏览器回归通过。 | [#118](https://github.com/erich04/ai-devflow-studio/pull/118) |
| [#120](https://github.com/erich04/ai-devflow-studio/issues/120) | Desktop 用例误把 IPC 已调用或加载中可用的按钮当成界面已就绪。统一 76 处初始等待，核对可见的 local persisted 状态；用受控 Promise 验证延迟加载与预算 pending→blocked，145 项 App 回归通过。产品代码与时限不变。 | [#118](https://github.com/erich04/ai-devflow-studio/pull/118) |
| [#121](https://github.com/erich04/ai-devflow-studio/issues/121) | Windows 真实 Git/npm 集成在测试专用 20 秒预算下超时。仅对 Windows fixture 调整 bootstrap/整体测试预算为 60/120 秒，并为临时目录增加有限清理重试；生产 Provider、审批和测试执行时限未改动。 | [#118](https://github.com/erich04/ai-devflow-studio/pull/118) |

修复按各 PR 的云端检查结果合并并关闭关联 Issue。#117 的完整 Postgres 集成先在旧函数上复现失败，再在新增迁移后通过，覆盖混合大小写、中文、非相邻重复、非法类型、数量/长度上限与越界路径；既有迁移文件未改写，保留数据迁移检查通过。3855 项全量测试通过；新增路径反例与跨平台静态规则的冲突已用等价抽象绝对路径修正，静态检查通过。

#119 的初始 CI 故障没有归档浏览器 Trace；10 次普通本地重复均通过，因此未宣称确定该次 CI 的唯一原因。独立最小测试在父组件 layout effect 内触发真实点击处理器，确认请求成功返回却被 mount effect 的版本递增丢弃；修复前失败，修复后通过。测试还覆盖已显示的码和在途响应在项目、账号或角色变化后的清理。没有添加等待时间、自动重试发码或调整既有操作界面。

## 费用与范围

成功归档的 8 次 Direct DeepSeek 调用合计 input 42,758 / output 12,760 tokens，依据产品定价快照估算 $0.026897544。它不包含 OpenCode 的不透明费用；OpenCode usage/cost 仍明确显示 opaque/unknown，不能把这次总花费说成 $0.027 或 $0。

最终审查仍标注上下文截断、旧失败记录和历史快照等限制。操作者已查看完整代码与测试，并补做实际浏览器验证；没有删除失败记录来制造一次通过的表象。本次验证的浏览器目标是桌面 Chrome，未宣称 Safari/手机适配、跨设备同步、后台服务或公网部署已完成。

本地证据目录：`out/blank-project-e2e-20260911/evidence/`。其中 `final-workflow-ledger.json` 是只读数据库导出的脱敏状态摘要，`31-generated-app-browser-qa.json` 与 `generated-app-browser-qa.mjs` 记录独立真实浏览器验证。日志、诊断 fixture 与失败 attempt 不作为成功交付替身。
