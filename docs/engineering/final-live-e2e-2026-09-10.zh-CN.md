# 2026-09-10 真实 Provider 全流程验证（进行中）

本轮从新版 Studio 新建 Project 和一句话 Work Request 开始。Web/API/Postgres 是本机 Docker QA 控制面，真实外部服务为 GitHub 和模型 Provider；不把本机 QA 称为公网生产部署。交付目标为 Draft PR 与业务验收，不包含自动合并或部署生产站点。

## 输入与环境

- 原始需求仅一句：“请把 Mini Agent 首页标题下的介绍文案改成‘让每一个小需求，都能从想法走到可验证的交付。’，保持其余功能和布局不变。” 未提前代写澄清、方案或验收清单。
- 新独立 GitHub 仓库：`erich04/devflow-mini-agent-e2e-20260910`（private，Repository ID `1364494960`）。由验证准备步骤复用 mini Agent 已有代码初始化，产品未从一句话生成仓库脚手架。
- 初始 commit：`8491ff3f20918cd4f26390fa34373b7d224aecf4`，`main`，工作树干净。
- 本地检出：`out/final-live-20260910/mini-agent`，注册为 `local-7f86cef4efdf`。
- 新 Team Project：`p-mini-agent-isolated-final-20260910`，名称 `Mini Agent Isolated Final 20260910`。
- 新 Work Request：`work-request-6ee589a7-3236-4cd6-8182-034de1a2faa2`，标题“更新 Mini Agent 首页介绍”，已领取并物化本地 Run，`v3`。
- 新 Run：`run-work-request-71376282001af0918881d23d0fea4f25`；项目预算 `$0.20 / 月`、预警 `$0.10`。
- Web 使用本轮分支的 Studio（端口 4313）；QA API（4310）已应用 schema v26，原数据和配置保留。更新前 API bundle 备份位于 `out/open-issues-20260910/qa-api-before-81`。
- Desktop 使用隔离工作分支 production build 和现有 `local-development` profile；真实 Key 只经正常 Main 安全存储使用，未读出或重新保存 Key。

## 当前步骤

| 步骤 | 证据 / 状态 |
| --- | --- |
| Studio 创建项目并自动选中 | 已通过真实 Web / API / Postgres，URL 自动选择新 Project ID |
| 一句话需求入库 | 已通过，Work Request ID 如上，内容未扩写 |
| 独立仓库准备 / 本地项目登记 | 已通过真实 GitHub 与 Desktop 文件选择框；初始代码未修改 |
| pairing | 已从 Web 生成一次性码并通过 Desktop 绑定；重启后关联和 Inbox 保留；同步时间 `2026-09-10T16:17:37.527Z` |
| Inbox 接球 / 本地 Run | 已从新请求创建新 Run，无手工注入阶段产物 |
| 真实澄清 | OpenCode `1.18.15`，`deepseek/deepseek-v4-flash`；只读扫描源码，生成 Repository Findings 和 Clarification v1；`2026-09-10T16:21:12.422Z` 完成，Run v2 停在需求 Gate |
| 需求门禁审查 | Direct DeepSeek `deepseek-v4-flash`，`2026-09-10T16:31:10.293Z`；已归档 Review / Trace / 消费，warn，置信度 0.82，未擅自批准 Gate |
| 方案 / 开发 / 测试 / Draft PR / 验收 | 待继续本轮执行 |

澄清真实遥测：输入 `32,103`（其中 cache read `25,088`），输出 `2,469`，合计 `34,572`；按本次保存的官方峰值价格快照估算 `$0.005217828`。`source=provider_reported` 表示 tokens 来自 Provider，`costStatus=estimated` 表示金额为估算。界面显示“预计 $0.005”，未把估算当作账单实扣。

剩余外部授权：新 GitHub 仓库尚需加入已有 App 安装 `153168718` 的 Selected repositories；CLI 尝试修改安装授权收到 GitHub HTTP 403，已请求用户操作。配对与原生 AX 控件操作现已恢复，继续新 Run 的上游阶段。

门禁审查 ID 为 `agent-review-review-request-ab4b6353-a9b5-462b-840a-e56b7bdf190d-electron`。输入 `5,793`（cache read `128`），输出 `738`，预计 `$0.002585868`；两次调用合计 `41,103` tokens、预计 `$0.007803696`。澄清与 Review 的用户均为实际 pairing 用户。该 Review 暴露 #93，费用尚待修复后的正常同步补传；不能宣称此时本地与云端已完全一致。

最新桌面操作再次被 Mac 锁定阻断，工具明确报告自动解锁失败。已请求手动解锁；修复与自动化检查继续，不以脚本伪造后续 Gate 操作。

## 本轮发现的问题

- [#91](https://github.com/erich04/ai-devflow-studio/issues/91)：先尝试将旧 QA 仓库绑定到新 Project 时，API 正确返回 `binding_conflict / 409`，Web 只显示笼统错误。旧仓库已经被另一 Project 绑定；未解除旧绑定或放宽唯一性。建议明确提示“此仓库已绑定其他项目，请使用独立仓库”，新增文案已向用户确认，尚未修改。
- 因上述冲突而未继续的首个 QA Project 为 `p-mini-agent-final-e2e-20260910`，其请求 `work-request-e5a15c0e-f948-49e2-90d7-b4658f5d7420` 保留为排查证据；没有生成或推进本地 Run。
- 原生控制未恢复前的输入尝试不计为产品 pairing 失败。重启并重新选择真实窗口后，AX 输入与配对持久化均已验证。
- #81 的 Electron 回归复现了 Gate Review 使用 Renderer 的 `requestedBy` 记账，导致与配对用户不一致，后续预算同步被 API 拒绝。Main 改为从已持久化 Run 和 pairing 推导用户；Smoke 显式伪造 Renderer 用户并断言本地 usage 采用配对身份。修复前本地复现失败，修复后整条 Electron Smoke 通过；没有放宽 API 的身份校验。
- [#93](https://github.com/erich04/ai-devflow-studio/issues/93)：真实 Review 上传将 Postgres 当前 Gate 从 running 改为 blocked，破坏同版本 Run 重传。保留现有节点的权威状态，只更新证据说明；测试证据上传也采用同一边界。新增真实 PostgreSQL 回归在修复前稳定 409，修复后全量通过，同时确认修改同版本状态仍 409、同 ID 改账仍 409。当前真实 Run 将通过正常 Gate 推进和同步恢复，不直接改写业务数据库。
- [#94](https://github.com/erich04/ai-devflow-studio/issues/94)：Mac 锁定期间从 Web 核对同一 Run，输入明确的验收说明后“批准并继续”仍被 Team preflight 禁用。云端保存了完整 Review manifest，但 Run request 为占位文本、Artifact 数量为 0，因此严格的 freshness 检查误把正常本地 Review 排除。未取消校验或上传本地产物；已请求用户决定云端摘要/指纹与 Desktop 最终复核的数据边界。Web 表单说明仅为未提交草稿，没有生成审批命令。

## 验收规则

真实 Provider 阶段必须逐项记录 Run/节点、Provider/Model、产物、调用用量和失败重试。核对本地与云端记账一致、计数入口对应当前节点、真实工作树 Diff、归档测试及 GitHub PR。未完成的步骤、受控 Provider 自动化和历史 Run 均不能代替本轮完整验收。
