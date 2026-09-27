# 分支与未提交修改整合核对（2026-09-27）

## 范围与基线

本次只整理 `erich04/ai-devflow-studio`。真实案例仓库、应用数据库、运行目录和已有交付记录不属于待合并的产品源码。

核对起点：`origin/main = f215fde92d7bd9fd9b381046ab21ffcf30829165`。当时共 33 个本地分支、31 个远端分支（均包含 `main`）和 14 个工作目录。原始目录有 6 个已跟踪文档修改、4 个未跟踪研究文档/来源文件，另有一份旧 stash。其余工作目录没有已跟踪文件修改。

## 已有功能分支

不能只根据分支名称或 PR 状态判断是否可清理。祖先提交表示已经进入主干历史；squash 补丁一致表示分支累计差异与主干合并提交差异具有相同的 `git patch-id --stable`，且合并提交是主干祖先。

| Branch | Original head | Inclusion proof |
| --- | --- | --- |
| `codex/architecture-micro-refactor-20260906` | `b7903c3ebaa1` | Ancestor of main |
| `codex/blank-bootstrap-20260912` | `d743ea3c2279` | Ancestor of main |
| `codex/blank-project-e2e-20260911` | `019fa2f5cc94` | PR #105; exact aggregate squash patch |
| `codex/blank-project-live-fixes-20260912` | `d83e41406e73` | PR #109; exact aggregate squash patch |
| `codex/chat-context-recovery-20260921` | `ad063409ad4c` | PR #155; exact aggregate squash patch |
| `codex/conversation-details-161` | `fb072a1968be` | PR #163; exact aggregate squash patch |
| `codex/conversation-help-160` | `d5fa9af40039` | PR #162; exact aggregate squash patch |
| `codex/delivery-path-collation-20260912` | `6699cbbe028c` | Ancestor of main |
| `codex/execution-tools-design-20260922` | `509447c29511` | PR #159; exact aggregate squash patch |
| `codex/fix-124-remediation-20260914` | `1c6c32ac9442` | Ancestor of main |
| `codex/fix-completed-stage-number` | `30817316b1e4` | Ancestor of main |
| `codex/gate-review-grounding-20260920` | `cd4bb35661f5` | Ancestor of main |
| `codex/gate-workbench-open-issues` | `1c4c3eabf356` | PR #168; exact aggregate squash patch |
| `codex/issue-ci-smoke-labels-20260920` | `d15b1f5c2a1d` | Ancestor of main |
| `codex/memory-context-execution-20260915` | `f11246c1c6b2` | Ancestor of main |
| `codex/multi-organization-tenancy-20260921` | `bec4af2549dd` | Ancestor of main |
| `codex/open-issues-20260910` | `a4c43af9e430` | Ancestor of main |
| `codex/opencode-blank-project-recovery-20260912` | `947fe857d936` | PR #112; exact aggregate squash patch |
| `codex/opencode-permission-recovery-20260911` | `ebf31fa389cc` | Ancestor of stage-agent-cost-81; exact aggregate squash patch in PR #90 |
| `codex/opencode-saved-provider-56` | `db152e153af3` | PR #83; exact aggregate squash patch |
| `codex/provider-removal-55` | `c1baec3486e5` | PR #85; exact aggregate squash patch |
| `codex/readme-current-product-20260924` | `658c511658da` | Ancestor of main |
| `codex/release-v2.3.0-20260913` | `3b50144b4735` | Ancestor of main |
| `codex/resolve-open-issues-20260926` | `aa9367bf413a` | Ancestor of main |
| `codex/saved-opencode-provider-20260912` | `6384c5b94de0` | Ancestor of main |
| `codex/stage-agent-cost-81` | `71d059421151` | PR #90; exact aggregate squash patch |
| `codex/studio-policy-52-57` | `e033566d91bf` | PR #87; exact aggregate squash patch |
| `codex/unified-workbench-conversations-20260916` | `f520e68cc87b` | Ancestor of main |
| `codex/web-ux-batch-20260910` | `607c3049371a` | PR #84; exact aggregate squash patch |
| `codex/workbench-opencode-harness-20260920` | `a0b574688d1e` | Ancestor of main |
| `codex/workflow-evidence-64` | `c2b359aee71e` | PR #88; exact aggregate squash patch |
| `codex/workflow-stage-navigation` | `0ce74e765fe4` | PR #170; exact aggregate squash patch |

远端同名分支也按实际分支头核对；三个本地分支落后于远端的情况已纳入检查。仅有远端的 `cursor/setup-dev-environment-057b` 对应未合并 PR #20，按下节整合。

## 本轮补齐与冲突处理

- 保存未提交内容为独立提交，再与当前主干合并，保留修改历史。
- `CONTEXT.md`：统一外部适配器、原生执行器和 Coding Agent 的契约、配置及职责边界。
- `README.md`：保留主干中文结构及较新的能力说明，补充协作结果校验、SDLC 分析与研究索引。
- 产品目录及流程说明：补充六阶段八节点、Draft PR/业务验收与生产部署的职责区分。
- 项目简介：补充本地优先、限定范围的 Supervisor/Specialist 协作、执行器配置与基于实际贡献的简历表述。
- 保存四份此前未跟踪的研究文档/来源文件；历史版本与建议加上日期和基线提示，并新增研究索引。
- 合入 PR #20 的原始提交，更新根目录 `AGENTS.md`：采用当前 Node.js 24/pnpm 配置和本地浏览器认证入口，将旧 VM 的 Node/PATH、Postgres、OverlayFS、虚拟显示与 sandbox 情况限定为环境差异。

六处正文冲突均按“当前主干结构 + 未提交内容中的有效补充”处理，没有把已更新的中文文档整体退回旧英文版本。产品实现、锁文件和运行配置相对于起点主干没有改动。

## 旧 stash 与本地产物

旧 stash 的指南路径修正、项目简介、历史研究归类已经在主干历史中存在相同文件版本。其 README/产品入口、阶段 Agent 与演示中的 Agent 分工，在当前中文文档中保留并更新。未跟踪的 `module.yaml` 与本地文件逐字一致，仍按原有 `.git/info/exclude` 规则作为工作区元数据保留。没有把旧 stash 整体覆盖到当前主干。

图谱缓存、浏览器记录、截图、调试输出和运行数据保留在本地，不作为产品源码提交。清理前保存全部 Git 引用的 bundle，以及每个工作目录的差异和未跟踪文件备份；备份可用于恢复原分支头和本地文件。

## 验证与清理顺序

本地已完成差异检查、研究来源 JSON 解析和文档链接存在性检查。合并 PR 还需通过仓库 Verify CI。只有远端主干包含本轮合并、分支头未发生变化且证据已核对，才删除旧分支。

有工作目录占用的历史分支先切换为相同提交的 detached HEAD，保留其文件和运行进程。当前项目根目录最终切换至更新后的 `main`，仅进行快进更新及普通推送，不改写远端主干历史。具体执行回执保存在本地 `out/branch-consolidation-20260927/`。
