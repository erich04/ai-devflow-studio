<a id="v23-independent-candidate-walkthrough--2026-09-14"></a>

# V2.3 独立候选版本验收 — 2026-09-14

结果：通过，包含下文明确披露的非阻塞观察。这是历史验收，不代表当前版本已完成同等验收。

候选提交：`9cec16052149c2a11749f28458152e423bca260b`。界面验收时间为 2026-09-14T01:58:38Z 至 2026-09-14T03:08:56Z，记录时间为 2026-09-14T03:14:13.914Z。

团队 schema v28，桌面 schema v34。安装包为 2.3.0 darwin-arm64，SHA-256 为 `53a2e8f0e562d8115c7651a2d617144b24ada06c1a345f698bb5879ff5409a68`。

[Verify 34763986095](https://github.com/erich04/ai-devflow-studio/actions/runs/34763986095) 通过 workflow_dispatch 对精确候选提交运行；第 1 次尝试的五个任务全部成功。

<a id="method-and-independence"></a>

## 方法与独立性

操作者不是维护者，未编写候选实现，也未在验收中修改源码、数据库、业务 API 或正式签署记录。

产品操作与业务状态修复未接受维护者临时协助。原生控制失败后，用户明确授权使用 Playwright 驱动真实界面，并用正常 System Events 操作原生目录选择器。这些获授权的界面控制与生命周期方法，是原“仅原生控制”流程的例外。用户只协助正常 GitHub 登录与双重验证。操作者通过正常界面选择本地仓库、创建并绑定团队项目、配对桌面端及完成全部工作流动作；未模拟对话框、注入认证或直接修复业务状态。

操作者结束后，发布负责人用只读 PostgreSQL 事务及只读 SQLite 补充界面未展示的字段，核实 schema 版本、交付次数、意图标识和持久化撤销字段。这些底层数量属于另行审计的观察，不声称操作者在界面看到了它们；审计未推进或修复流程。

此前一次原生控制尝试已中断，不计为通过。本次使用全新的团队与桌面工作流状态，新建一个团队项目和工作请求；私有仓库和已保存服务商凭据为预先准备的资源。不宣称本次重新创建了空 GitHub 仓库；更早的空项目验收属于独立历史证据。

<a id="observed-flow"></a>

## 实际流程

| 检查 | 实际结果 |
| --- | --- |
| 需求录入与配对 | 一个团队项目、一条 main 分支有效仓库绑定 v1、一个配对本地项目、一个 Web 工作请求及一个规范本地 Run。 |
| 澄清 | 真实 DeepSeek 生成 v1，真实 Gate 审查推动结构化修订为 v2。调用前预算阻断后，通过正常表单保存预算；明确确认再次审查费用，再正常批准 Gate。 |
| 设计与审查 | 真实 DeepSeek 生成唯一设计产物。设计仍为 Task，审查另设 Gate。只读 Task 影响展示真实下游 Gate 及关联产物；Task 没有审批或 Override 控件。真实审查后明确正常批准。 |
| 运行时 | 一个独立 scenario.evaluate 运行时成功，检查点 v4，接受结果 1、步骤 1、工具 1。此有限诊断消耗零模型 token，不是付费模型调用。 |
| 记忆 | 一个候选记忆提升一次、修订一次，再明确删除并清除；删除 v3、head v4 持久保存。 |
| 协调 | 启动一个有限协调会话及一个只读 Specialist。部分完成时冷启动保留累计启动 1、动作 0；明确取消后会话和子执行停止，未观察到重复启动或副作用。 |
| 编码就绪 | 项目 Native 执行器使用已保存的真实 DeepSeek 配置；就绪和活跃执行权限阻止第二次并发启动。 |
| 编码取消 | 故意在精确 diff 待授权时取消一次，变更路径为 0，工作树已删除。正常明确确认重试后，在同一规范 Run 启动最终尝试。 |
| 实现 | 第二次真实 Native 编码在明确批准重新核对的 diff 后完成。仅 README 新增两行，没有删除，原有内容保留。 |
| 测试 | Native npm test 为 17 通过、0 失败；独立正式工作流测试针对交付变更同为 17 通过、0 失败。 |
| 交付 | 已认证所有者在 Web 批准一个精确意图；桌面端发布一个分支和一个 Draft PR。 |
| 验收 | 真实最终 Gate 审查仍是建议。操作者核对交付与测试事实后明确批准验收；桌面和 Web 显示 completed，Web 证据链为 100%。未执行 Lead Override。 |
| 撤销 | Web 将绑定 v1 撤销为 v2；一次正常桌面检查返回 binding_inactive，导航后仍可查看。 |
| 脱敏 | 团队运行时、记忆、协调和交付投影仅暴露有限元数据，不含本地正文或凭据。公开证据不含原始补丁、服务商输出、凭据或本地路径。 |

两次编码尝试是有意安排的一次取消和一次成功。工作请求、规范 Run 和交付尝试仍各只有一次；明确的编码重试不等于自动 GitHub 交付重试。

<a id="exact-delivery-and-recovery-evidence"></a>

## 精确交付与恢复证据

使用私有仓库 `erich04/devflow-blank-mini-agent-20260911` 和 App `devflow-v1-5-sandbox-20260812`。审批者为 owner，认证方式 session_cookie；桌面配对角色为 lead。交付尝试 1、意图修订 1、Run v10。交付精确摘要、commit、回执及固定英文解析字段在下方保留。

[Draft PR #2](https://github.com/erich04/devflow-blank-mini-agent-20260911/pull/2) 为草稿、未合并、未自动重试。工作请求、规范 Run、凭据授权、分支发布和草稿 PR 各 1 次；补充只读审计确认审批和交付请求也各 1 次。重启后凭据授权、推送和 PR 重复次数均为 0。

交付后恢复通过：界面保留同一已完成意图、尝试 1、Run v10、请求 v8、PR 和完成时间；最终审计未发现额外授权、推送或 PR 结果。独立运行时、已清除记忆、已取消协调均保留原版本和副作用计数。

两次冷启动都使用原配置。正常菜单退出命令返回成功，但进程仍存活，第二次持续观察 10.122 秒；随后 SIGTERM 在 0.210 秒内退出，未使用 SIGKILL。**不宣称正常菜单退出通过**。受控终止后的恢复通过，退出原因由 #125 跟踪。

验收完成时 PR 仍为草稿且未合并。撤销证明为状态 v2、已撤销绑定 v2、结果 binding_inactive，检查于 2026-09-14T03:05:04.761Z，持久检查次数 1。检查过的投影和公开证据脱敏通过。

清理通过，采用外部操作者且不合并的方式：2026-09-14T03:06:50Z 通过 GitHub 关闭 Draft PR #2，03:07:12Z 删除分支。GitHub 确认关闭且提交未合并；未合并、转为待审、强制推送或创建沙箱标签。

以下是发布签署程序按固定英文键、值和精确行读取的原始证据，故不翻译代码块。上文为对应中文解释；保留原始长行也避免改变已记录的操作范围：

```text
Status: Passed, with the disclosed non-blocking observations below.
Team schema v28; Desktop schema v34.
Packaged artifact: 2.3.0 darwin-arm64; SHA-256 53a2e8f0e562d8115c7651a2d617144b24ada06c1a345f698bb5879ff5409a68.
Operator role: non-maintainer. The independent operator did not author the candidate or change source, databases, business APIs, or the formal signoff records during acceptance.
Ad hoc maintainer assistance: false for product operation and business-state repair. The user explicitly authorized Playwright real-UI driving after native control failures; normal System Events operated the native directory chooser. These authorized UI transport and lifecycle methods are an exception to the original native-control-only procedure. The user assisted normal GitHub login/2FA only. The operator selected the local repository, created and bound the Team Project, paired Desktop, and performed all workflow actions through normal UI. No dialog mock, injected authentication, or direct business-state repair was used.
Sandbox/App: private erich04/devflow-blank-mini-agent-20260911 via devflow-v1-5-sandbox-20260812.
Approval role/auth: owner / session_cookie. Desktop pairing role was lead.
Delivery series: github-delivery:7f4a85a6822cd5c24386b36280734e5b35dd15d937f784c818f74b34cac306d5
Delivery attempt: 1; intent revision: 1; Run version: 10.
Intent digest: e9f08637a59e27da51077863b53f3303356b0aab695e064cf82f498cc530623a
Test evidence digest: c9d71dc16528f86ef479268d3e1cf84f760d903d967b29ec6158332340c22f6d
PR package digest: 4c9ae03f074a0a4f60c6b3b02af97a3c44a4d464c161f13227266d20f4d1fee7
Expected commit: fbd82be0c7b02e37ce6e2233f3470709d7fd8f94; remote head: fbd82be0c7b02e37ce6e2233f3470709d7fd8f94.
Draft PR: https://github.com/erich04/devflow-blank-mini-agent-20260911/pull/2
Draft state: true; merged: false; automatic retry: false.
Lifecycle counts: Work Request 1; canonical Run 1; credential grant 1; branch publication 1; Draft PR 1. The supplemental read-only audit also found exactly one approval and one delivery request.
Restart side-effect repeats: credential 0; push 0; pull request 0.
Restart recovery: passed. The post-delivery UI retained the same completed intent, attempt 1, Run version 10, request version 8, PR and completion timestamp. Final audit found no additional credential grant, branch publication or PR outcome. Standalone Runtime, purged Memory and cancelled Coordination retained their versions and effect counts.
Acceptance: completed while the PR remained Draft and not merged.
Revocation proof: state version 2; intent github-delivery-intent-fae3046a-a419-4075-8261-356b735b2a9c; revoked binding version 2; outcome binding_inactive; checked at 2026-09-14T03:05:04.761Z; durable check count 1.
Redaction: passed for inspected projections and published evidence.
Cleanup: passed, external-operator-no-merge. The operator closed Draft PR #2 through GitHub at 2026-09-14T03:06:50Z and deleted its branch at 03:07:12Z. GitHub confirmed closed with unmerged commits; no merge, ready-for-review promotion, force push or sandbox tag occurred.
```

<a id="deterministic-verification-and-known-observations"></a>

## 确定性验证与已知观察

精确候选提交通过生产依赖审计、类型检查、3,866 项测试、跨平台检查、41 项浏览器测试、Electron 与 Native 编码冒烟、PostgreSQL、三套 Agent 评估器、生产/构建产物检查和五任务 Verify 矩阵。下载的 CI 桌面包通过完整性、打包桌面与打包 GitHub 交付冒烟检查。这些自动化验证补充独立界面验收；受控服务商冒烟不能算成付费 DeepSeek 证据。

- [#124](https://github.com/erich04/ai-devflow-studio/issues/124)：肯定性的“未发现阻断问题”审查说明被显示为可选待修复警告。Gate 仍可正常审批，旧意见也正确标为被替代。
- [#125](https://github.com/erich04/ai-devflow-studio/issues/125)：自动化菜单退出后进程仍存活，直到受控 SIGTERM。尚未确定原因为界面控制还是应用关闭；不宣称普通手动退出已损坏或已验证。
- 部分新变更的记忆/运行时面板需要正常导航刷新；无需数据库或 API 修复。

以上观察继续披露。本结果不宣称零 open Issue、不宣称验证过 Override 执行、不宣称安装包已正式签名/公证，也不宣称生产部署已验收。
