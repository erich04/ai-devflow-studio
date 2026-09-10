# 2026-09-10 真实 Provider 全流程验证（进行中）

本轮从新版 Studio 新建 Project 和一句话 Work Request 开始。Web/API/Postgres 是本机 Docker QA 控制面，真实外部服务为 GitHub 和模型 Provider；不把本机 QA 称为公网生产部署。交付目标为 Draft PR 与业务验收，不包含自动合并或部署生产站点。

## 输入与环境

- 原始需求仅一句：“请把 Mini Agent 首页标题下的介绍文案改成‘让每一个小需求，都能从想法走到可验证的交付。’，保持其余功能和布局不变。” 未提前代写澄清、方案或验收清单。
- 新独立 GitHub 仓库：`erich04/devflow-mini-agent-e2e-20260910`（private，Repository ID `1364494960`）。由验证准备步骤复用 mini Agent 已有代码初始化，产品未从一句话生成仓库脚手架。
- 初始 commit：`8491ff3f20918cd4f26390fa34373b7d224aecf4`，`main`，工作树干净。
- 本地检出：`out/final-live-20260910/mini-agent`，注册为 `local-7f86cef4efdf`。
- 新 Team Project：`p-mini-agent-isolated-final-20260910`，名称 `Mini Agent Isolated Final 20260910`。
- 新 Work Request：`work-request-6ee589a7-3236-4cd6-8182-034de1a2faa2`，标题“更新 Mini Agent 首页介绍”，云端 `open / v1`。
- Web 使用本轮分支的 Studio（端口 4313）；QA API（4310）已应用 schema v26，原数据和配置保留。更新前 API bundle 备份位于 `out/open-issues-20260910/qa-api-before-81`。
- Desktop 使用隔离工作分支 production build 和现有 `local-development` profile；真实 Key 只经正常 Main 安全存储使用，未读出或重新保存 Key。

## 当前步骤

| 步骤 | 证据 / 状态 |
| --- | --- |
| Studio 创建项目并自动选中 | 已通过真实 Web / API / Postgres，URL 自动选择新 Project ID |
| 一句话需求入库 | 已通过，Work Request ID 如上，内容未扩写 |
| 独立仓库准备 / 本地项目登记 | 已通过真实 GitHub 与 Desktop 文件选择框；本地 0 Run，初始代码未修改 |
| pairing | 已从 Web 生成一次性码；Desktop 键盘控制失败，未确认配对成功，不记为通过 |
| 真实澄清 / 方案 / 开发 / 测试 / Draft PR / 验收 | 尚未开始本轮执行 |

当前阻塞：Desktop 原生控制返回 `noWindowsAvailable`，粘贴等待超时，已请求用户恢复可操作窗口。新 GitHub 仓库尚需加入已有 App 安装 `153168718` 的 Selected repositories；CLI 尝试修改安装授权收到 GitHub HTTP 403，已请求用户操作。两个动作均完成后从 pairing 继续，不沿用旧 Run 作为本轮结果。

## 本轮发现的问题

- [#91](https://github.com/erich04/ai-devflow-studio/issues/91)：先尝试将旧 QA 仓库绑定到新 Project 时，API 正确返回 `binding_conflict / 409`，Web 只显示笼统错误。旧仓库已经被另一 Project 绑定；未解除旧绑定或放宽唯一性。建议明确提示“此仓库已绑定其他项目，请使用独立仓库”，新增文案已向用户确认，尚未修改。
- 因上述冲突而未继续的首个 QA Project 为 `p-mini-agent-final-e2e-20260910`，其请求 `work-request-e5a15c0e-f948-49e2-90d7-b4658f5d7420` 保留为排查证据；没有生成或推进本地 Run。
- 原生控制未恢复前的输入尝试不计为产品 pairing 失败。完整定位需可操作窗口重试，不能据此认定产品绑定逻辑有缺陷。

## 验收规则

真实 Provider 阶段必须逐项记录 Run/节点、Provider/Model、产物、调用用量和失败重试。核对本地与云端记账一致、计数入口对应当前节点、真实工作树 Diff、归档测试及 GitHub PR。未完成的步骤、受控 Provider 自动化和历史 Run 均不能代替本轮完整验收。
