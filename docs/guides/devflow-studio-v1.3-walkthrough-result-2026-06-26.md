<a id="devflow-studio-v13-walkthrough-result---2026-06-26"></a>

# DevFlow Studio v1.3 演练结果 — 2026-06-26

本报告按 `docs/guides/devflow-studio-v1.3-walkthrough.md` 和 `docs/guides/devflow-studio-full-feature-walkthrough.md` 验证真实用户路径。

本轮主要使用电脑控制操作 Electron / Web 界面；终端仅用于健康检查、API 证据和自动交叉检查。默认路径未调用真实付费服务商，知识审查与编码 Agent 均使用模拟、无模型费用的路径。

这是历史失败记录；下列问题和修复建议保留当时状态，不能作为当前版本仍存在或已经解决的独立证据。原日志与界面逐字引文保留原文供核对。

<a id="environment"></a>

## 环境

| 项目 | 结果 | 证据 |
| --- | --- | --- |
| 分支 | 通过 | `codex/airbnb-iii-pixel-port` |
| 既有工作区 | 说明 | 开始前已有 `apps/desktop/src/App.tsx`、`apps/desktop/src/useGateEnforcement.ts`、`apps/desktop/src/App.test.tsx` 未提交改动 |
| Docker 服务 | 通过 | `postgres` 健康，`api` 使用 `4310`，`web` 使用 `4311` |
| API 健康 | 通过 | `GET http://127.0.0.1:4310/health` 返回 `status: ok` |
| Web 控制台 | 通过 | `http://127.0.0.1:4311/` 返回 200，并在 Chrome 渲染 |
| 桌面 | 通过 | Electron 窗口标题 `AI DevFlow Studio`，URL 为 `127.0.0.1:5173/` |
| 导航 | 通过 | 电脑控制读取到工作台、团队、知识、Agents、技能、MCP、测试 |

<a id="desktop-walkthrough"></a>

## 桌面演练

| 步骤 | 结果 | 证据 |
| --- | --- | --- |
| 初始桌面状态 | 通过 | 选择本地仓库前，Electron 处于 `seed fallback`（种子数据回退） |
| 选择本地仓库 | 通过 | 选择 `/Users/erich/File/claude/10-showcase/ai-devflow-studio`；界面显示 `ai-devflow-studio`、`connected`、`package script`、`corepack pnpm test` |
| 创建 QA Run | 通过 | 创建 `QA 手动验收 2026-06-26`，进入本地 SQLite 持久化模式 |
| 原始请求产物 | 通过 | 节点检查面板显示与演练 webhook 重试文本一致的请求 |
| 需求澄清 | 通过 | `生成需求澄清` 创建产物；阶段 01 任务变为 `success` |
| 策略不可用门禁 | 通过 | 同步前，需求确认门禁因团队策略不可用而阻断 |
| 审批前团队同步 | 通过 | 加载 `remote_cache v1`，策略快照出现；当时本地 QA Run 仍可见 |
| 需求门禁批准 | 通过 | Run 进入 `designing`；此门禁未出现旧版写死为 `building` 的行为 |
| 设计产物 | 通过 | `生成设计方案` 创建产物；设计审查卡 ART/TRC 从 0 变为 1 |
| 设计门禁审查 | 通过 | 检查面板跳转 Agents 后目标为正确的 `方案评审 Gate`；模拟审查含 18 条知识引用、轨迹及 `$0.00` 费用 |
| 设计门禁批准 | 通过 | Run 进入 `building`，开发任务就绪 |
| 编码 Agent | 通过 | 开发任务启动模拟引擎，出现 `devflow-fake-change.txt` 的权限转发 |
| 批准权限 | 通过 | 批准一次后托管工作树运行完成，1 个变更路径，模拟差异归档并记录编码轨迹 |
| 测试页面 | 通过 | 检查面板跳转测试后目标为 `Run tests`；`corepack pnpm test` 命令安全且已保存 |
| 本地测试执行 | 通过但有问题 | 退出码 0，耗时 6786ms；本地证据数从 1 增至 2 |
| PR 草稿 | 部分通过 | 生成草稿产物，包含比较 URL、变更路径、测试证据、策略、预算和 Agent 审查；没有创建真实 GitHub PR |
| 验收证据包 | 部分通过 | 包含原始请求、PR 草稿、变更路径、测试、策略、预算和 Agent 审查 |
| 最终验收 | 部分通过 | 批准门禁后 Run 标为 `completed`，但看板和当前节点状态仍不一致 |

<a id="team--web--pairing"></a>

## 团队、Web 与配对

| 步骤 | 结果 | 证据 |
| --- | --- | --- |
| 完成后桌面同步 | 失败 | 状态栏变成 `0 local · 2 remote`；QA Run 变为 `remote`，看板退化为远端摘要节点 |
| 远端 API 中的 Run | 通过 | `GET /api/runs?organizationId=org-1` 包含状态为 `completed` 的 QA Run |
| 远端 Run 详情 | 失败 | QA Run 只有 3 个摘要节点，产物和事件数组为空 |
| 远端合并后桌面状态 | 失败 | 同步后的门禁评估显示 `Run node not found` |
| 配对码 | 通过 | API 创建符合一次性复制格式的配对码 |
| 桌面令牌交换 | 通过 | API 将配对码换取为预期格式的桌面令牌 |
| 令牌/配对码泄露 | 通过 | `GET /api/team/overview` 不含配对码或桌面令牌 |
| Chrome 中的 Web 控制台 | 部分通过 | 电脑控制加载了 Web，但主视图仍显示种子 Run `为 Payments API 增加 /health 端点`，同步的 QA Run 不可见 |

<a id="boundary--negative-checks"></a>

## 边界与反向检查

| 检查 | 结果 | 证据 |
| --- | --- | --- |
| 危险命令防护 | 由代码/测试覆盖证明 | `validateTestCommandSafety()` 阻断 `rm -rf`、`sudo`、`curl \| sh`、递归 chmod、受保护路径重定向及 Windows 破坏性命令 |
| 真实付费服务商 | 未测试 | 没有输入 API 密钥，只使用模拟服务商 |
| 真实 OpenCode 冒烟 | 未测试 | 需要明确授权和真实服务商配置 |
| 真实 GitHub PR | 未测试 | 仅 PR 草稿产物，没有推送/创建 PR |
| 真实 MCP 执行 | 未测试 | 只涉及 MCP 页面与外壳边界，没有真实执行验证 |

<a id="automated-checks"></a>

## 自动化检查

| 命令 | 结果 | 说明 |
| --- | --- | --- |
| `corepack pnpm --filter @ai-devflow/desktop typecheck` | 通过 | `tsc --noEmit` 通过 |
| `corepack pnpm test -- apps/desktop/src/App.test.tsx` | 通过 | 41 项测试通过 |
| `corepack pnpm test:electron-smoke` | 被阻塞 | 冒烟需要可用端口；人工环境占用了 `4310`、`4311`、`5173` |
| `corepack pnpm test:docker-smoke` | 通过 | 构建隔离 Compose 项目；API/Web 健康、配对、令牌交换与脱敏概览泄露检查通过 |

<a id="findings"></a>

## 发现的问题

<a id="p1---team-sync-corrupts-the-local-completed-run-view"></a>

### P1 — 团队同步破坏已完成 Run 的本地视图

QA Run 完成后点击 `同步团队`，桌面从本地持久化状态变为以下原始界面标识：

- `remote snapshot + local merge`（远端快照加本地合并）
- `Active Runs 2`（2 个活动 Run）
- `Run Sources 0 local · 2 remote`（0 本地、2 远端）
- QA Run 来源标记变为 `remote`（远端）

看板不再显示完整本地六阶段 Run，而渲染远端摘要节点。Electron 原始错误如下，表示门禁评估找不到对应节点：

```text
Error invoking remote method 'devflow:enforcement:gate:evaluate':
Error: Run node not found: run-eaaf83ba-cc08-49aa-9a91-64cb331ee488:run-eaaf83ba-cc08-49aa-9a91-64cb331ee488-test
```

这违反同步必须保留本地 Run、不得隐藏或破坏本地工作流上下文的要求。

<a id="p1---remote-summary-loses-artifactsevents-and-full-workflow-structure"></a>

### P1 — 远端摘要丢失产物、事件和完整工作流结构

同步后 API 确实含有 QA Run，但 `/api/runs?organizationId=org-1` 只返回 3 个摘要节点，没有产物与事件：

- 设计门禁的 `Knowledge Review Target`（知识审查目标）。
- 验收的 `Knowledge Review Target`。
- `Test Evidence`（测试证据）。
- `artifacts: []`。
- `events: []`。

本地曾有完整的需求/设计/开发/测试/PR/验收卡、产物、审查、编码差异、测试证据、PR 草稿和验收证据包；远端摘要往返后这些细节未能保留。

<a id="p1---test-evidence-output-leaks-full-local-path"></a>

### P1 — 测试证据输出泄露完整本地路径

测试页记录 `corepack pnpm test` 通过，但产物内容暴露了完整工作目录与标准输出路径。以下原始输出保留用于确认历史缺陷：

```text
CWD: /Users/erich/File/claude/10-showcase/ai-devflow-studio
> ai-devflow-studio@1.2.0 test /Users/erich/File/claude/10-showcase/ai-devflow-studio
RUN v3.2.6 /Users/erich/File/claude/10-showcase/ai-devflow-studio
```

界面还显示 `Redacted no`（未脱敏），不符合输出摘要应脱敏、不得暴露完整本地敏感路径的要求。

<a id="p2---run-completion-leaves-boardcurrent-node-state-inconsistent"></a>

### P2 — Run 完成后看板与当前节点状态不一致

Run 最终变为 `completed`，验收节点为 `success`，但看板仍有矛盾：

- 摘要仍为 `当前卡点: 测试证据 · Run tests`。
- 编码 Agent 完成后，开发卡仍为 `ready`。
- PR 草稿生成后，PR 卡仍为 `waiting`。
- 最终提示为 `Acceptance signoff 已通过，Run 进入本地实现阶段`，最终验收却显示错误阶段。

即使操作产生了产物，这些矛盾仍使工作流难以信任。

<a id="p2---web-console-does-not-surface-the-synced-qa-run-in-the-primary-view"></a>

### P2 — Web 主视图未呈现同步后的 QA Run

Chrome/电脑控制加载 `http://127.0.0.1:4311/`，但页面仍聚焦以下种子 Run：

```text
为 Payments API 增加 /health 端点
RUN-RUN-HEAL
```

API 概览包含两个 Run，其中有 QA Run，因此问题更可能在 Web 选择/展示行为，而非 API 中没有数据。

<a id="p2---source-labels-become-contradictory-after-sync"></a>

### P2 — 同步后来源标签相互矛盾

工作台左侧仍标记 `Local Project + Runs local only`（本地项目与本地 Run），状态栏却显示 `0 local · 2 remote`，QA Run 标记也为 `remote`。用户无法明确正在查看本地 SQLite 还是远端快照。

<a id="recommended-fix-order"></a>

## 建议修复顺序

1. 修复桌面同步合并，使远端快照刷新后，本地持久化 Run 仍保持本地来源且可见。
2. 修复远端摘要契约或桌面合并适配器，避免不完整摘要节点替代本地完整上下文。
3. 在保存/展示测试证据前，对测试输出路径和工作目录脱敏。
4. 统一编码 Agent、PR 草稿、验收证据包和最终门禁之后的节点状态迁移。
5. 修复门禁通过后的阶段提示，尤其是最终验收。
6. 更新 Web 选择/展示，使新同步的 QA Run 可以在主视图找到。
7. 为本次已完成 Run 的同步路径增加回归覆盖。

<a id="not-tested"></a>

## 未测试范围

- 真实付费知识审查服务商。
- 真实 OpenCode 服务商冒烟。
- 真实 GitHub PR 创建、推送、合并或发布。
- 真实 MCP 工具执行。
- RAG/向量检索。
- Windows 完整冒烟。
