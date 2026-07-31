# DevFlow Studio v1.3 Walkthrough Result - 2026-07-25

本报告用于回答三个问题：

1. 项目当前进展到哪里；
2. 功能是否已经完整；
3. 下一步应按什么顺序演进。

本轮以文档更新前的 `main` 代码基线为对象，结合代码审计、测试/CI/发布审计、文档审计和
Computer Use 操作 Electron / Web UI。除本报告及相关进展文档外，没有修改仓库代码或配置
文件；流程验证只向隔离的临时 `userData` / SQLite 写入 app state 和临时 provider 配置。
临时服务在验收结束后已全部停止。

## Executive Summary

结论：**项目已经具备较宽的产品骨架和可演示的团队试点能力，但端到端交付状态机不可信，
目前不能称为功能完整，也不满足 v1.3 发布条件。**

- 最后正式发布仍是 `v1.2.0`。
- v1.3 Delivery Flow 的主要代码已经合入 `main`，但版本仍是 `1.2.0`，没有 v1.3 tag，
  也没有完成当前主干的 release signoff。
- Request、Clarification、Design、Gate、Knowledge Review、Tests、PR Draft、
  Acceptance Bundle 等入口已经可见，部分动作可以真实落库。
- 核心阻塞不是“页面还少几个按钮”，而是 workflow、sync、project mapping 和 write-path
  之间没有形成单一、可靠的状态机。
- 本轮复现了两个状态完整性问题：
  - 测试失败、没有 Coding Diff、PR 仍等待时，Acceptance Bundle 仍可生成，Final Gate
    仍能把 Run 标成 `completed`；
  - 完成后的本地 Run 一经 Team Sync，会被远端摘要覆盖成无完整节点的 remote Run。
- 当前更适合定义为：**开发预览 / 内部演示版本**。修复关键阻塞并重新验收前，不宜作为
  可发布或外部团队可依赖的完整产品。

从能力覆盖面看，产品骨架已经较广；从“真实请求能可靠走完并交付”的标准看，仍处于
v1.3 hardening 阶段，而不是 finished 状态。后文使用逐能力矩阵表达完成度，不给出缺少
统一权重的百分比。

## Baseline

| Item | Result | Evidence |
| --- | --- | --- |
| Audited code baseline | note | 文档更新前的 `main` / `81cf03f` |
| Package version | note | root/workspace package 仍为 `1.2.0` |
| Last release | note | `v1.2.0`；上述 audited baseline 比该 tag 前进 21 个提交 |
| v1.3 status | partial | Delivery Flow 代码已合入 `main`，未版本对齐、未打 tag、未完成发布签核 |
| Existing worktree | preserved | 验收开始前已有 README、guides、knowledge/research 文档改动及未跟踪文件，本轮未覆盖或清理 |
| Review provider | isolated stub | `fake-local-walkthrough` / `http://127.0.0.1:4399/v1` / model `fake`；placeholder key 只写入临时 SQLite，无外部/付费调用 |
| Paid provider | not tested | 未调用真实付费 Knowledge Review provider |
| Real opencode | not tested | 本机 `opencode:status` 失败；按本轮“不要修改代码”约束未运行 Coding Agent |
| Desktop data | isolated | 使用临时 `userData` / SQLite，不复用日常 Electron 数据 |

## Computer Use Walkthrough

### Desktop / workflow

| Step | Result | Evidence |
| --- | --- | --- |
| Launch Desktop | pass | Electron 标题为 `AI DevFlow Studio`；Workbench、Team、Knowledge、Agents、Skills、MCP、Tests 均可导航 |
| Select repository | pass | 选择当前仓库后显示项目名与 `main` 分支 |
| Create Run | pass | 创建 `项目全流程验收 2026-07-25`，生成六阶段 workflow 和 raw request artifact |
| Default no-cost provider | fail | `DEVFLOW_ENABLE_FAKE_RUNTIME=true` 不会自动提供 Workflow/Review Agent provider；生成澄清前仍要求配置 Provider ID、Base URL、Model 和 API Key |
| Clarification | pass with setup | 在隔离 SQLite 中配置本地 OpenAI-compatible stub 后，澄清 artifact、trace 和节点状态成功落库 |
| Demand Gate | pass with UX issue | Gate 推进到 Design；toast 却错误提示“进入本地实现阶段” |
| Design | pass | 设计 artifact 和 trace 成功落库 |
| Knowledge Review | partial | Review history、artifact、trace 和 advisory 成功生成；当前 repo knowledge 未索引，因此没有真实知识引用 |
| Design Gate | pass | Gate 推进到 Build |
| Coding Agent | not run | 启动 fake Coding Agent 会创建 managed git worktree 和 marker diff；为遵守“不修改代码和配置”，本轮没有执行该动作 |
| Tests | fail | `corepack pnpm test` 生成失败 Evidence；60 个测试文件中 59 个通过，443 个用例中 442 个通过 |
| Build state after Tests | fail | 没有运行 Coding Agent、Build 产物/证据/trace 均为 0，但运行 Tests 后 Build 仍被标成 `已完成` |
| PR Draft | blocked | PR 节点正确拒绝生成，提示缺少项目仓库映射 |
| Acceptance Bundle | fail | Test 节点失败、PR 节点等待时，Acceptance 节点仍允许生成证据包 |
| Final Acceptance | fail | Final Gate 仍将 Run 标成 `已完成`；同时当前卡点仍是失败的 Test，PR 仍等待 |
| Final toast | fail | 显示 `Acceptance signoff 已通过，Run 进入本地实现阶段`，阶段文案错误 |

完成后的矛盾状态如下：

| Surface | Observed state |
| --- | --- |
| Run | `已完成` |
| Current position | `测试证据 · Run tests` |
| Build | `已完成`，但 artifacts/evidence/trace 均为 0 |
| Test | `失败`，2 份失败 Evidence |
| PR | `等待中`，无 PR Draft |
| Acceptance | `已完成`，有 Acceptance Bundle |

这说明当前完成态由局部按钮动作拼接而成，并不是由一条统一、受前置条件保护的 workflow
state machine 推导出来。

### Test Evidence / redaction

本地测试失败原因是验收前已经存在的文档/fixture 不一致：

- `docs/knowledge/prompts/opendesign-design-prompts.md` 已改为相对链接；
- `packages/shared/src/fixtures.ts` 仍内嵌旧内容；
- `packages/shared/src/fixtures.test.ts` 因此失败。

Tests UI 正确归档了 `failed`、exit code `1` 和 duration，但仍显示 `Redacted no`，stdout 和
artifact 内容包含完整本地 cwd。2026-06-26 walkthrough 中报告的路径泄漏问题仍然存在。

Computer Use 的异步 focus/click 重试使同一安全测试命令执行了两次，因此最终 UI 有两份内容
一致的失败 Evidence；本报告不把“双份 Evidence”本身归因为产品自动重复执行。

### Team pairing / sync

| Step | Result | Evidence |
| --- | --- | --- |
| Sync before pairing | expected block | Desktop 提示先 Pair Team Project |
| Pairing from primary Web shell | fail | 当前 `/` 主 Web 壳没有创建 pairing code 的交互 |
| Legacy Web shell | fail | `/legacy-shell` 在 demo 环境请求 `/api/team/overview` 返回 401 |
| API pairing fallback | pass | 通过本地 API 创建一次性 code 并在 Desktop 完成 pairing；报告不记录 code/token |
| Sync before completion | partial | 本地 Run 当时仍可见，但 UI 仍显示 `Team Project 未绑定`、`1 local · 0 remote` |
| Project mapping | fail | Pairing 只建立 Desktop token，未建立 Local Project ↔ Team Project / repository mapping |
| Sync after completion | fail | 状态变成 `0 local · 1 remote`；本地六阶段 Run 被同 id 的 remote summary 覆盖 |
| Remote detail | fail | Desktop 显示“当前 Run 尚未定位到节点”，六阶段节点全部退化为等待/无节点 |
| Sync toast | misleading | toast 声称“本地 Run 已保留”，与实际 `0 local · 1 remote` 相反 |

这证明 2026-06-26 报告的 completed-run sync P1 仍未修复。早期阶段的本地可见性有所改善，
但同 id remote summary 仍会在完成后覆盖本地完整状态。

### Web / management surfaces

| Surface | Result | Evidence |
| --- | --- | --- |
| New Web shell | partial | 能显示团队 metrics、evidence、budget、policy 卡片 |
| Active Run selection | fail | 页面固定展示之前 E2E 写入的 run；虽显示 2 个 Active Runs，但没有 run selector，刚同步的验收 Run 不可发现 |
| New request | shell only | `新建工作请求` 是锚点，没有可完成的 request intake 写路径 |
| Human Gate actions | partial | 当前按钮没有完整交互处理；页面主要是 read/dashboard shell |
| Pairing | fail | 新 Web shell 不提供 pairing code 创建入口 |
| Legacy shell | fail in demo | 未携带 demo session headers，加载即 401 |
| Budget | partial | UI 存在，但本轮显示 `not configured`；没有验证真实付费调用的 fail-closed 行为 |

### Knowledge / Skills / MCP / Team

| Surface | Result | Evidence |
| --- | --- | --- |
| Knowledge | partial | UI 和治理模型存在；当前 Electron 明确显示 `NOT INDEXED`，Run 没有知识引用 |
| Skills | shell only | 显示“未加载真实团队 Skills” |
| MCP | shell only | 显示“未加载本地 MCP 连接器”；没有真实进程执行 |
| Team Overview | partial | 已 pairing 仍显示未加载 Team Project、成员、policy 和 budget |

## Automated Quality Snapshot - Audited Working Tree

以下本地结果基于验收前已经 dirty 的 working tree，不等同于 clean `81cf03f`。其中唯一单测
失败来自验收前已有、尚未提交的 knowledge Markdown 与内嵌 fixture 不一致；最新 clean-main
证据另列为 GitHub Actions 结果。

| Check | Result | Notes |
| --- | --- | --- |
| `corepack pnpm typecheck` | pass | 全 workspace 通过 |
| `corepack pnpm build` | pass | Desktop、Electron、Web、API、Worker 均生成构建目录 |
| `corepack pnpm test` | fail | 59/60 files、442/443 tests 通过；失败为 knowledge prompt fixture 不一致 |
| `corepack pnpm test:e2e` | fail | 2/3 通过；测试仍查找旧的 `Run Knowledge Review` 路径 |
| `corepack pnpm test:cross-platform` | pass | 仅静态兼容性脚本，不等于 Windows 实机 |
| `corepack pnpm test:electron-smoke` | not run | 本轮用 Computer Use 走真实 Electron，但未执行独立 scripted smoke |
| `corepack pnpm verify:demo` | not run / currently blocked | 其组成项中的 unit 和 E2E 已失败 |
| `corepack pnpm test:postgres-smoke` | not run locally | 最新 clean-main CI 的 Postgres integration 通过 |
| `corepack pnpm test:docker-smoke` | blocked locally | 本机 Docker daemon 未运行；远端 CI 也有 compose env 传递问题 |
| `corepack pnpm opencode:status` | fail | 本机未安装/未发现 opencode |
| `corepack pnpm release:status` | fail | exit 1 原因是 working tree dirty；manual walkthrough 为 pending，只有 strict 模式才因此阻断 |
| Fresh API dist start | fail | 构建后直接 `node dist/server.js` 因 ESM extensionless import 报错 |
| Fresh Worker dist start | fail | shared package/runtime import 边界导致产物不能直接运行 |

截至 2026-07-25，最新一次 `main` Verify 仍是 2026-07-02 的 commit `81cf03f`：
macOS verify 和 Postgres integration 通过，Windows compatibility 与 Docker smoke
失败；最近连续四次 main Verify（包含上述最新一次）均未全绿。对应工作流：
[Verify run 28594719147](https://github.com/erich04/ai-devflow-studio/actions/runs/28594719147)。

当前 release artifacts 仍是构建中间目录，不是可直接安装/部署的完整产品包：

- Electron 没有 DMG/ZIP/installer、签名或公证；
- API/Web/Worker 产物没有完整运行时打包；
- Release workflow 也没有把浏览器 E2E、Electron smoke、Docker smoke 和严格 signoff
  统一设为发布门禁。

## Functional Completeness

| Capability | Status | Current judgment |
| --- | --- | --- |
| Shared domain / six-stage model | mostly implemented | 类型、模板、artifact/evidence 模型较完整 |
| Desktop request intake | implemented baseline | 可从 raw request 建 Run，但默认 provider 路径不自洽 |
| Clarify / Design / Gate | partial | 正常路径可推进；toast、current-node 和 write-path 仍有一致性问题 |
| Knowledge Review | partial | Provider 调用、artifact/trace 可用；repo indexing 没有接入当前 Electron 路径 |
| Coding Agent | partial | fake/real adapter 基础存在；本轮未运行，且完成结果没有统一推进主 workflow |
| Test Evidence | partial | 可执行/归档；失败证据可见，但完整本地路径仍泄漏 |
| PR handoff | incomplete | artifact helper/按钮存在；真实项目映射缺失，无法形成可靠交付 |
| Acceptance | unsafe/incomplete | 可绕过失败 Test、缺失 Diff/PR，错误完成 Run |
| Team sync | unsafe/incomplete | merged Desktop view 中的 lossy summary 会替代同 id 本地完整 Run |
| Web console | partial shell | 新壳可展示摘要，但 intake、Gate、pairing、run selection 未闭环 |
| Auth / budget | partial/unsafe for public exposure | 静态审计发现 server 仍信任未签名身份 headers，预算 fallback 返回 `blocksRun: false`；真实付费 fail-closed 行为未做端到端验证 |
| Skills / MCP | shell only | 没有真实能力目录或 MCP runtime |
| GitHub delivery | not implemented | 仅 PR Draft 概念，无真实 push/PR |
| Packaging / release | incomplete | 版本、tag、可运行产物、CI/signoff 均未闭环 |

## Priority Findings

### P0 - Final Acceptance can bypass the delivery chain

Acceptance action 没有验证 Build diff、passing Test、PR Draft 和当前节点顺序。结果是失败的交付
仍可被标成 `completed`。这是下一轮必须优先修复的状态完整性问题。

### P0 - Completed-run sync replaces local truth with a lossy remote summary

Team Sync 后，Desktop merged view 用同 id remote summary 替代本地完整 Run，六阶段节点、
artifacts 和 events 不再可见。Desktop 还错误声称本地 Run 已保留。必须先明确
local/remote source-of-truth 与 merge contract。

### P1 - Local Project 与 Team Project 没有显式映射

Pairing 成功不等于 repository mapping 成功。PR Draft 依赖映射，却没有正常 UI 完成该步骤；
其他代码路径还存在回退到第一个 Team Project 的风险。

### P1 - “默认 fake/no-cost walkthrough”并不成立

fake Coding Runtime 可显式开启，但 Clarification/Design/Knowledge Review 仍需要手动 Agent
Provider。文档和实际启动路径必须一致，或提供真正的内置 deterministic provider。

### P1 - Redaction boundary is incomplete

Test Evidence 仍会存储并显示 cwd 和 stdout 中的完整本地路径，违反产品定义中的 local/private
边界。

### P1 - Auth and budget are not fail closed

静态代码审计显示，`DEVFLOW_REQUIRE_AUTH` 已进入配置模型，但当前 server 仍可从未签名的
`x-devflow-*` headers 构造身份/角色；远端预算服务异常时 Desktop budget guard fallback
返回 `blocksRun: false`。本轮没有用真实付费 provider 做端到端 fail-closed 验证。在收紧并
验证这些写路径前，不应把当前 self-hosted stack 暴露到不可信网络，也不应依赖它保护真实
付费调用。

### P1 - Current CI/build artifacts are not release-ready

验收时 dirty working tree 的单测/E2E，以及 clean-main 的 Windows/Docker CI 都有明确失败；
API/Worker fresh dist 不能直接启动，release assets 也不可直接安装或部署。

### P2 - Web and management surfaces are ahead of their write paths

新 Web shell、Knowledge、Skills、MCP、Team Overview 已有完整视觉入口，但当前真实数据和动作
仍是部分或空状态，容易造成“已完成”的错觉。

## Recommended Evolution

### Phase A - v1.3 state integrity and release hardening

1. 建立唯一 workflow transition/write model：
   - 每个节点的完成条件由同一 shared transition evaluator 决定；
   - Coding、Test、PR、Acceptance 结果都必须回写同一 Run；
   - 非当前节点动作、缺失上游证据、失败 Test 必须在写路径拒绝。
2. 修复 sync contract：
   - local persisted Run 不被 remote summary 覆盖；
   - remote contract 要么携带可恢复的完整结构，要么只作为并列 summary；
   - 增加 completed-run round-trip regression。
3. 增加显式 Local Project ↔ Team Project ↔ repository mapping。
4. 修复 Test Evidence 的 cwd/path redaction。
5. 让 deterministic fake provider 与文档中的 no-cost 启动方式真正一致。
6. 修复当前单测/E2E/Windows/Docker CI，重新执行完整 Computer Use walkthrough。
7. 让 API/Worker 等 release outputs 在 fresh 环境通过最小启动 smoke。

### Phase B - v1.4 pilot trust boundary

1. 把 repository knowledge indexing 接入真实 Electron/API 路径。
2. 收紧 auth 和 budget：外部/付费路径必须 fail closed，demo mode 必须显式隔离。
3. 补齐 Web request intake、Gate actions、pairing 和 run selection。
4. 把 v1.3 的最小可运行输出加固为可重复的 Electron/Web/API pilot packages，并增加
   deploy、upgrade 和 rollback smoke。

### Phase C - v1.5+ delivery and operations expansion

只有 Phase A/B 验收通过后，再推进：

- GitHub App / scoped-token 的真实 PR 创建；
- MCP runtime、tool permission 和 telemetry；
- 多 Desktop 协作、冲突和 audit；
- Windows Electron 实机、installer、签名、公证和 auto-update；
- 更完整的 self-hosted backup/restore 与运营能力。

## v1.3 Signoff Exit Criteria

v1.3 重新签核前，至少应满足：

- Run 不能在 Build/Test/PR 任一前置条件失败时完成 Acceptance；
- Coding/Test/PR/Acceptance 都通过同一状态机推进当前节点；
- completed local Run 同步后仍保留完整 workflow/artifacts/events；
- Local ↔ Team ↔ repository mapping 有显式、可验证的 UI/API；
- Test Evidence 不包含完整 cwd 或本地敏感路径；
- no-cost walkthrough 不需要临时 stub 或隐式凭据；
- `test`、`test:e2e`、Windows、Docker 和 release smoke 全绿；
- `verify:demo` / `test:electron-smoke` 在当前 release candidate 上通过；
- 按 release-only policy 在 tag 前完成并记录真实
  `DEVFLOW_RUN_OPENCODE_SMOKE=1 ... corepack pnpm test:opencode-smoke`；
- fresh API/Worker/Electron/Web 产物可实际启动；
- 新的 dated Computer Use walkthrough 通过，并由 release status 明确绑定当前 HEAD/tag。

## Not Tested

- 真实付费 Knowledge Review provider。
- 真实 opencode Coding Agent。
- 真实 GitHub push / PR / merge。
- 真实 MCP process/tool execution。
- RAG/vector provider。
- Postgres/Docker 的本轮 UI 全流程。
- Windows Electron 实机与安装器。
