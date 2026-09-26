# AI DevFlow Studio v2.3.0

V2.3 汇集自 V2.2 以来的需求到交付流程改进。本文对应该历史版本，后续变更以当前产品文档与路线图为准。

<a id="changes"></a>

## 变更

- Native 编码执行器 v2 与受治理的 OpenCode 集成，包含项目级就绪检查、保存服务商选择、安全移除凭据和明确权限处理。
- 改进 Web 入门、项目创建、本地认证、仓库选择、配对、团队同步、预算配置及主题持久化。
- 统一澄清、设计、Gate 审查、实现、测试、PR 和验收证据。Web 审批通过摘要和指纹绑定桌面持有的产物。
- 改进 DeepSeek 结构化响应、服务商诊断、原子用量记录、审查并发控制和未知费用展示。
- 改善空仓库执行、依赖准备、OpenCode 空闲检测，以及 JavaScript/Postgres 不同排序规则下的 GitHub 交付。
- 加固跨平台 Git/npm 测试样例、打包桌面隔离和生产依赖。

<a id="verification-and-scope"></a>

## 验证与范围

发布候选需运行完整 Verify 矩阵，包括 Windows 兼容、macOS、浏览器与 Electron、Postgres、Docker 安装/升级、打包桌面以及现有有限运行时、记忆、协调评估器。最终结果必须绑定精确候选 commit；计划检查清单不等于通过结果。

更早的[空项目真实验收](../../engineering/blank-project-e2e-2026-09-11.zh-CN.md)使用真实 DeepSeek/OpenCode 和 GitHub，生成中文任务清单，通过 17 项应用测试及真实浏览器检查，并交付已合并 PR。它属于历史证据，不能替代绑定 V2.3 候选的正式签署。

分发仍为自托管源码、Web/API/Worker 构建归档及未签名的 macOS Apple Silicon 便携桌面归档。已测试 Windows 兼容，但该包不包含 Windows 安装器、正式签名/公证的 macOS 安装器、公共托管服务或自动部署。

多 Agent 协调仍是可选、有限且采用固定任务图的高级能力，不宣称能自动交付任意项目。产品 GitHub 交付止于受治理的 Draft PR 和验收；合并与公开部署仍由操作者完成。

<a id="upgrade"></a>

## 升级

升级前备份自托管 Postgres 和桌面配置。该版本团队 schema v28、桌面 schema v34，应按文档迁移路径启动 API，保留已有身份与 GitHub App 配置。安装和配置见[自托管指南](../../guides/devflow-studio-self-hosted-pilot.md)。

桌面归档须与完整性清单及 `artifact-index.json` 一起下载，解压运行。API、Web 和 Worker 归档仅为构建输出；完整可复现部署使用带版本标签的源码和锁文件。
