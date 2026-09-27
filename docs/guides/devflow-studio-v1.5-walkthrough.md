<a id="devflow-studio-v15-github-delivery-walkthrough"></a>

# DevFlow Studio V1.5 GitHub 交付演练

状态：稳定的操作规程；不代表任何候选已经通过验证。

本演练针对冻结的候选提交 `C`，验证 1.x 最终计划的交付边界：一条经过身份验证的工作请求，成为一个经过本地测试的提交和一个经人工批准的 GitHub Draft PR，且 Web、渲染器和持久化存储均不持有仓库凭据。只有全部步骤通过后，才能写入带日期的结果记录。

<a id="preconditions"></a>

## 前置条件

- 使用完整 SHA 为 `C` 的干净检出，以及全新且隔离的 Web/API/Postgres/桌面状态。
- 使用非敏感测试仓库和专用的私有 GitHub 沙箱仓库。不得使用 DevFlow 产品仓库或其他生产仓库作为沙箱。
- V1.5 GitHub App 仅安装到该沙箱。只授予仓库 Metadata 读取、Contents 写入和 Pull requests 写入；不得启用管理、合并、工作流、Issue 或组织权限。
- API 查询和创建 Draft PR 时，将短期令牌收窄为精确权限组合 `Contents: read + Pull requests: write`，以读取已批准的引用；不得扩大安装权限或把 PR 权限交给桌面端。
- App 私钥只放在 API 进程配置中。证据和命令行历史中不得出现私钥、安装令牌、OAuth 令牌、配对码、Cookie、Bearer 值或凭据 URL。
- 浏览器使用正常 GitHub OAuth 身份、一个签名 Web 会话、一个明确选择的团队项目和一个短期项目配对码。禁止使用开发身份请求头。
- 开始前记录候选 SHA、安装包摘要、非敏感沙箱标识和隔离服务名称；结果中不得保留原始本地路径。
- 对精确候选引用触发 `Verify` 工作流。其 `macOS verify` 作业上传 `ai-devflow-studio-v15-candidate-desktop` 产物；签收和发布使用这一带索引的归档包，不能使用后续运行器重新构建的包。
- 私有沙箱演练前，下载并校验该次工作流的精确产物；演练必须使用这一下载的归档包。本地重建不能替代将要发布的桌面端字节内容。
- 签收只接受 `run_attempt: 1`。任一 Verify 作业失败时，不得重跑同一次工作流；仅在允许时修正 `C` 以外的环境准备，然后为同一精确候选重新触发一次 Verify。
- 本完成门禁的**非维护者操作员**是独立人员，不编写或修改 `C`；冻结演练开始后，不修改发布证据、数据库或服务配置。只使用文档规定的正常 Web 与打包桌面界面，不使用命令行、直接 HTTP、SQL 或 GitHub CLI 完成或修复产品流程。另一位环境准备人员可以在演练开始前创建/安装沙箱 App 并注入密钥，但必须单独记录这些准备动作及完成时间，不能计作操作员步骤。演练开始后，若维护者提供未写入文档的命令、数据修复、API 调用或状态修改，`adHocMaintainerAssistance` 必须为 true，本次演练失败。

<a id="operator-path"></a>

## 操作路径

1. 启动与候选绑定的自托管服务，以及从精确 Verify 下载产物中解压的桌面应用。确认 API/Web 已就绪、团队数据库版本正确、桌面状态全新、产物 SHA-256 与记录一致，且没有先前的交付记录。
2. 通过仅用于身份验证的 GitHub OAuth 登录。在 Web 选择目标团队项目，使用沙箱安装 ID 和仓库 ID 配置仓库绑定；确认 API 解析出正式的私有仓库和 `main` 基础分支。
3. 创建一个项目配对码，配对桌面端，选择受控本地项目并同步有效仓库绑定。不得保留配对码。
4. 在 Web 创建一条范围明确的工作请求。在桌面端认领，并生成且仅生成一个正式 Run；确认团队端没有在桌面确认创建之前伪造 Run。
5. 完成澄清和设计，并由人通过相应 Gate。在受管工作树中实现，保留正式差异，对精确源提交运行测试。
6. 在 PR 节点创建脱敏 PR 交付包，执行 Prepare GitHub Delivery（准备 GitHub 交付），核对完整仓库、基础/发布分支、预期提交、Run 版本、变更路径、证据摘要、交付包摘要、标题和正文投影。
7. 在 Web 使用有效的 lead 或 owner 签名会话批准这一精确请求。桌面 Bearer 权限必须无法批准。提交、证据、交付包、绑定或 Run 版本任一变化，都必须执行 **Revise（修订）** 并重新批准。
   发布前，Electron 主进程扫描确切的出站 Git 对象，并在请求任何 GitHub 凭据前持久化不含秘密的扫描回执。API 在取得 PR 写入权限前，单独扫描 PR 标题和正文。任一扫描返回 `content_scan_blocked`，均不得恢复（Resume）或覆盖阻断；必须创建新的 Work Request/Run，让编码 Agent 在干净的 Coding Agent 工作空间重新构建和测试。Git 内容阻断发生在推送之前；PR 文本阻断可能发生在分支已发布并核验之后，但被阻断的请求不会再产生远端写入。
8. 由 Electron 主进程获取一个短期、限于该仓库的 Contents 凭据，把已批准 SHA 发布到已批准的 `devflow/` 分支，禁止强制推送，并报告结果。
9. API 独立核对远端分支头，创建或对账且仅保留一个 Draft PR。只有分支与 Draft 证据持久化后，PR 节点才可推进。若 GitHub 返回 `403` 或 `422`，且附带合法、有界的 `Retry-After`，产品必须报告 `github_rate_limited`，仅持久化由该头推导的最早重试时间。只能使用文档中的 Resume 操作：先按精确标记对账，在服务商退避期结束前不得再次创建。
10. 远端效果持久化后退出桌面应用，再以同一隔离状态冷启动。确认恢复对账没有重复授予凭据、推送或创建 PR。
11. 在业务验收核对精确远端提交、Draft URL、通过的测试证据和已完成交付证据。批准验收，确认正式 Run 变为 `completed`，PR 仍为 Draft 且未合并。
12. 在 Web 撤销仓库绑定，回到打包桌面端的已完成交付，执行 **Verify credential revocation**（验证凭据撤销）。这一有界主进程探测从已完成的本地证据推导精确远端请求，使用加密保存的配对权限；其命令/结果不会把额外的远端请求或仓库字段加入精确本地 CAS 信封，渲染器始终收不到桌面 Bearer 或凭据响应。只有精确的 `binding_inactive` 拒绝才算通过。
    若撤销前已预留的签发仍有未解决的非敏感隔离标记，探测返回 `credential_revocation_pending`，不记录通过。时间流逝不会清除此标记。只有产品持久确认服务商撤销后，操作员才可等待并重试 **Verify credential revocation**。不得通过直接 HTTP、SQL、证据编辑或其他手工状态修改绕过隔离。`200` 或其他 `2xx` 响应按 `credential_unexpectedly_issued` 处理：桌面取消尚未读取的响应体，不执行 Git/发布器/PR 操作，本轮失败，必须从全新隔离状态重新演练。
13. 如有需要，验证一条安全恢复路径：**Stop（停止）** 将活动本地尝试转入人工恢复；**Resume（恢复）** 继续同一个 `recovery_required` 尝试；**Revise（修订）** 在同一交付系列/尝试内替换发布前已变更的材料；**Retry（重试）** 只在 `failed` 或 `revoked` 后创建下一次尝试。所有动作均不得复用旧批准。
14. 检查团队/桌面持久化投影及操作员可见输出，确认没有密钥、Git 原始输出、补丁正文、仓库内容和本地绝对路径。清理隔离服务和本地状态。保留沙箱 Draft 未合并以供证据审查；不得通过 DevFlow 删除或重写该分支。

<a id="acceptance-criteria"></a>

## 验收标准

只有所有观察都绑定同一个 `C`，且满足以下条件，演练才通过：

- 一条工作请求、一个正式 Run、一个受管工作树源提交和一次交付尝试；
- 一次签名 Web 批准，绑定精确仓库、提交、Run/证据版本及交付包；
- 一次短期凭据授予、一次精确分支发布和一个 Draft PR；
- 远端分支头 SHA 等于已批准的预期提交 SHA；
- PR 与业务验收节点为 `success`，正式 Run 为 `completed`；
- 重启恢复没有重复凭据授予、推送或 PR 副作用；
- 撤销绑定后，通过打包桌面端 **Verify credential revocation** 为已完成请求记录且仅记录一条脱敏持久化检查，包含更新的已撤销绑定版本、规范检查时间和 `binding_inactive`。所有重叠标记必须先有持久化的 POST 前凭据不存在确认或精确 `204` 撤销确认，且不得产生第二次 Git 或 PR 效果；
- 不合并、不强制推送、不发布标签、不删除远端分支、不扩大权限；
- 持久化/发布证据中没有 App 私钥、安装令牌、配对值、Cookie、Bearer 值、原始补丁/输出、仓库内容、凭据 URL 或本地绝对路径。

产品、测试、工作流、配置或普通文档的变更都会使 `C` 失效，必须冻结新候选并重跑完整矩阵。仅环境准备失败可以在不改变 `C` 的前提下修正，但带日期结果必须披露不含敏感信息的修正内容。

<a id="candidate-bound-result"></a>

## 与候选绑定的结果记录

全部通过后，在 `C` 的直接子提交 `S` 中仅新增以下四个文件：

- `docs/releases/v1.5.0/walkthrough.json`
- `docs/releases/v1.5.0/required-gates.json`
- `docs/releases/v1.5.0/github-sandbox.json`
- `docs/guides/devflow-studio-v1.5-walkthrough-result-YYYY-MM-DD.md`

JSON 与日期结果只记录有界、非敏感元数据，不得包含截图、原始 HTTP/Git/服务商输出、源码、提示词、补丁、本地路径或任何凭据值。V1.5 不授权或要求再次运行付费 OpenCode 服务商冒烟；V1.4 的付费冒烟记录保持不可变，仍只绑定 V1.4 候选。

必须使用下面的精确记录格式。将示例身份、数字版本/计数、角色、URL 和尖括号占位符替换为实测的非敏感值，保留精确键名和固定生命周期结果。不得为了方便加入本地诊断或凭据字段。

撤销记录的 `intentId` 必须为生产格式 `github-delivery-intent-<lowercase RFC4122 v4 UUID>`，UUID 版本位为 `4`，变体位为 `8`、`9`、`a` 或 `b`。

V1.5 的 `walkthrough.json.date`、`evidencePath` 中的日期、`required-gates.json.recordedAt`、`github-sandbox.json.recordedAt` 和 `revocationProof.checkedAt` 必须处于同一 UTC 日历日期。日期结果必须包含且仅包含一行 `Revocation proof:`，并精确编码沙箱记录值。`revocationProof.proofStateVersion` 必须等于 `2`；版本 `1` 的证明行会被主动丢弃，必须重新执行打包端远程检查。

这一结果证明：跨过有效绑定 CAS（比较并交换）的线性化边界后，没有撤销后的新签发。它不声称撤销前的所有凭据都已失效：撤销前正常签发或消费的令牌，可能在使用、服务商撤销或到期前仍有效；令牌值从不持久化。`credential_revocation_pending` 不是签收证据，也不会仅因时间过去而清除。只有产品持久确认 POST 前服务商凭据不存在，或收到精确 `204` 服务商撤销确认后，操作员才可等待并重试打包端操作，以记录精确通过结果。

`docs/releases/v1.5.0/walkthrough.json`：

```json
{
  "targetVersion": "1.5.0",
  "candidateSha": "<C-full-40-hex-SHA>",
  "status": "passed",
  "date": "YYYY-MM-DD",
  "method": "computer-use",
  "evidencePath": "docs/guides/devflow-studio-v1.5-walkthrough-result-YYYY-MM-DD.md"
}
```

`docs/releases/v1.5.0/required-gates.json`：

```json
{
  "targetVersion": "1.5.0",
  "candidateSha": "<C-full-40-hex-SHA>",
  "status": "passed",
  "recordedAt": "<ISO-8601 timestamp>",
  "gates": {
    "verify": "passed",
    "windows-compatibility": "passed",
    "v15-github-delivery-deterministic": "passed",
    "e2e": "passed",
    "electron-smoke": "passed",
    "postgres-smoke": "passed",
    "docker-smoke": "passed",
    "docker-lifecycle-smoke": "passed",
    "build": "passed",
    "build-output-smoke": "passed",
    "desktop-pilot-build": "passed",
    "desktop-pilot-smoke": "passed",
    "v15-github-delivery-packaged-smoke": "passed",
    "github-sandbox-draft-pr": "passed"
  },
  "localMatrix": {
    "candidateSha": "<C-full-40-hex-SHA>",
    "result": "passed",
    "worktreeCleanAfter": true
  },
  "verifyRun": {
    "workflow": "Verify",
    "event": "workflow_dispatch",
    "runId": 123456789,
    "runAttempt": 1,
    "url": "https://github.com/erich04/ai-devflow-studio/actions/runs/123456789",
    "headSha": "<C-full-40-hex-SHA>",
    "conclusion": "success",
    "jobs": {
      "macOS verify": "success",
      "Windows compatibility": "success",
      "Postgres integration": "success",
      "Docker smoke": "success",
      "Docker lifecycle smoke": "success"
    }
  },
  "desktopArtifact": {
    "version": "1.5.0",
    "platform": "darwin-arm64",
    "sha256": "<64-hex packaged-artifact SHA-256>"
  }
}
```

`docs/releases/v1.5.0/github-sandbox.json`：

```json
{
  "targetVersion": "1.5.0",
  "candidateSha": "<C-full-40-hex-SHA>",
  "status": "passed",
  "recordedAt": "<ISO-8601 timestamp>",
  "repository": "erich04/ai-devflow-studio-v15-sandbox",
  "repositoryVisibility": "private",
  "appSlug": "<lowercase-hyphenated-app-slug>",
  "installationIdSuffix": "<exactly-4-digits>",
  "repositoryIdSuffix": "<exactly-4-digits>",
  "bindingVersion": 2,
  "deliverySeriesKey": "github-delivery:<64-hex>",
  "deliveryAttempt": 1,
  "intentRevision": 1,
  "intentDigest": "<64-hex>",
  "runVersion": 7,
  "testEvidenceDigest": "<64-hex>",
  "prPackageDigest": "<64-hex>",
  "expectedCommitSha": "<40-hex sandbox source commit>",
  "remoteHeadSha": "<same-40-hex sandbox source commit>",
  "baseBranch": "main",
  "headBranch": "devflow/<safe-branch-name>",
  "pullRequestNumber": 17,
  "pullRequestUrl": "https://github.com/erich04/ai-devflow-studio-v15-sandbox/pull/17",
  "draft": true,
  "merged": false,
  "approvalRole": "lead",
  "approvalAuthKind": "session_cookie",
  "workRequestCount": 1,
  "canonicalRunCount": 1,
  "credentialGrantCount": 1,
  "branchPublicationCount": 1,
  "draftPullRequestCount": 1,
  "automaticRetry": false,
  "acceptanceStatus": "completed",
  "restartRecovery": "passed",
  "revocationProof": {
    "proofStateVersion": 2,
    "intentId": "github-delivery-intent-<lowercase-RFC4122-v4-UUID>",
    "revokedBindingVersion": 3,
    "outcomeCode": "binding_inactive",
    "checkedAt": "<canonical-ISO-8601-check-timestamp>",
    "durableCheckCount": 1
  },
  "redactionCheck": "passed",
  "cleanup": "passed",
  "cleanupMethod": "external-operator-no-merge",
  "operatorRole": "non-maintainer",
  "adHocMaintainerAssistance": false
}
```

日期结果必须写明 `Status: Passed`，记录 `C`、打包产物的平台与 SHA-256、Team schema v15、Desktop schema v17、精确 SHA 的 Verify URL、非敏感沙箱/App 标识、系列/尝试/修订及摘要、生命周期计数、批准角色/认证种类、预期/远端 SHA、Draft URL 和状态、已完成业务验收、重启无重复副作用观察，以及精确撤销证明值（`intentId`、更新的撤销绑定版本、`binding_inactive`、规范 `checkedAt` 和持久化检查数 `1`）。还需记录脱敏扫描、清理、非维护者操作员角色、没有临时维护者介入，以及非敏感的环境准备修正。不得记录 `S`，因为日期结果自身参与计算 `S`。

下面的英文标签骨架由发布程序解析，必须逐字保留；其字段对应上段列出的中文说明，以同时支持人工审计和机器检查：

```markdown
# V1.5 walkthrough result

Status: Passed
Candidate: <C-full-40-hex-SHA>
Packaged artifact: 1.5.0 <platform-arch> <64-hex-SHA-256>
Team schema v15; Desktop schema v17.
Verify: <exact-first-attempt-workflow_dispatch-run-URL>
Delivery series: <github-delivery:64-hex>
Delivery attempt: 1; intent revision: 1.
Intent digest: <64-hex>
Test evidence digest: <64-hex>
PR package digest: <64-hex>
Expected commit: <40-hex>; remote head: <same-40-hex>.
Draft PR: <canonical-GitHub-Draft-PR-URL>
Acceptance: completed. Restart recovery: passed.
Redaction check: passed. Cleanup: passed. The Draft PR was not merged.
Operator role: non-maintainer. Ad hoc maintainer assistance: false.
Approval role/auth: <owner-or-lead>/<session_cookie>.
Lifecycle counts: Work Request 1, canonical Run 1, credential grant 1, branch publication 1, Draft PR 1.
Sandbox/App: private <owner/repository> via <app-slug>.
Draft state: true; merged: false; automatic retry: false.
Restart side-effect repeats: credential 0, push 0, pull request 0.
Revocation proof: state version 2; intent github-delivery-intent-<lowercase-RFC4122-v4-UUID>; revoked binding version <positive-integer-newer-than-delivery-binding>; outcome binding_inactive; checked at <canonical-ISO-8601-check-timestamp>; durable check count 1.
```

<a id="candidate-signoff-and-tag-sequence"></a>

## 候选、签收与标签的顺序

1. 提交全部普通产品、测试、工作流、版本和文档变更。在干净工作树上把提交记为 `C`；推送后完成本地矩阵和精确 SHA 的 Verify，期间不得修改 `C`。从该次首次执行的 `workflow_dispatch` 下载 `ai-devflow-studio-v15-candidate-desktop` 到临时目录，确认索引只引用同目录清单/归档，清单的归档 SHA-256 等于实际字节。解压并使用这一精确归档执行私有沙箱演练。全部通过后，把相同平台/版本/SHA 写入 `required-gates.json`，不记录临时路径。
2. 仅加入上述四份证据，创建一个提交 `S`。要求 `git rev-parse S^1` 等于 `C`，且 `git diff --name-only C..S` 恰好列出这四个路径。
3. 在 `S` 上令 `DEVFLOW_RELEASE_DESKTOP_ARTIFACT_INDEX` 指向下载的候选 `artifact-index.json`，运行 `corepack pnpm release:status -- --mode=pre-tag`。评估器独立计算归档摘要，并与清单和 `required-gates.json` 比较。通过后不得移动 `C`、修改 `S` 或再添加证据提交。
4. 集成发布分支时保留两个原始提交，禁止 squash 或 rebase。使用 `git tag -a v1.5.0 S -m "AI DevFlow Studio v1.5.0"` 创建附注标签。
5. 推送标签前检出 `S`，令 `DEVFLOW_RELEASE_DESKTOP_ARTIFACT_INDEX` 指向同一个下载索引，运行 `corepack pnpm release:status -- --mode=tagged`；通过后才推送附注标签。Release 工作流独立通过 GitHub API 读取记录的工作流运行，核对精确 `workflow_dispatch` 事件、候选 SHA、URL、仓库、结论和五个成功作业，再下载并复验同一产物。发布的是该归档，而非当前运行器重建内容。
   等待精确标签触发的 `Release` 成功，确认 `Publish GitHub Release` 作业成功。独立查询 `git/ref/tags/v1.5.0`，要求对象类型为 `tag`，再查询 `git/tags/<tag-object-SHA>`，要求提交目标等于 `S`。将 Release 附件下载到新临时目录，要求恰好七个普通文件，并运行 `node scripts/desktop-artifact-trio.mjs inspect <temporary-directory>/artifact-index.json`。
   七个文件必须恰好是索引绑定的桌面归档及清单、`artifact-index.json`、`manifest.txt`，以及 `ai-devflow-studio-v1.5.0-{web-next-build,api-build,worker-build}.tar.gz` 三个包。可使用以下命令：

   ```bash
   TAG_OBJECT_SHA="$(gh api repos/erich04/ai-devflow-studio/git/ref/tags/v1.5.0 \
     --jq 'select(.object.type == "tag") | .object.sha')"
   test -n "${TAG_OBJECT_SHA}"
   test "$(gh api repos/erich04/ai-devflow-studio/git/tags/${TAG_OBJECT_SHA} \
     --jq 'select(.object.type == "commit") | .object.sha')" = "$(git rev-parse S)"
   RELEASE_CHECK_DIR="$(mktemp -d)"
   gh release download v1.5.0 --repo erich04/ai-devflow-studio --dir "${RELEASE_CHECK_DIR}"
   test "$(find "${RELEASE_CHECK_DIR}" -mindepth 1 -maxdepth 1 -type f | wc -l | tr -d ' ')" = 7
   test "$(find "${RELEASE_CHECK_DIR}" -mindepth 1 -maxdepth 1 | wc -l | tr -d ' ')" = 7
   node scripts/desktop-artifact-trio.mjs inspect "${RELEASE_CHECK_DIR}/artifact-index.json"
   test -f "${RELEASE_CHECK_DIR}/manifest.txt"
   for kind in web-next-build api-build worker-build; do
     test -f "${RELEASE_CHECK_DIR}/ai-devflow-studio-v1.5.0-${kind}.tar.gz"
   done
   ```

   检查通过后，只清理刚创建的临时目录，然后才修改发布状态说明。
6. 创建首个发布后文档提交，不移动标签：将当前发布设为 `v1.5.0`，标记 1.x 完成，并将 V2.0 契约/ADR 设为下一步。
