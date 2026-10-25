# Hindsight 独立本地服务部署验证

日期：2026-10-20。接续[首期实现验证](hindsight-integration-20261020.md)。本次范围是部署独立本地服务并验证存储协议，不代表完整智能抽取或生产启用验收。

本文记录无计费部署阶段；后续获得人民币 5 元授权后的真实 DeepSeek 结果见[真实模型验证](hindsight-deepseek-validation-20261020.md)。

## 部署结果

- macOS arm64，Docker Desktop 4.79.0，Docker Engine 29.5.3，Compose 5.1.4，Node 24.18.0。
- API：`http://127.0.0.1:8890`；管理界面：`http://127.0.0.1:9990`。
- Compose 项目：`devflow-hindsight`；容器：`devflow-hindsight-hindsight-1`；持久化卷：`devflow-hindsight_data`。
- 复用本机已有官方镜像，未操作另一项目的 Hindsight 容器、数据卷、凭据或预算网关。
- 官方 1.0.0 多架构索引摘要：`sha256:a88678c038b0e4340822b02a5efc566c56d8176b5bffa731bc433fd37f978e4c`，由 `docker buildx imagetools inspect ghcr.io/vectorize-io/hindsight:1.0.0` 核对。运行镜像 revision 为 `39c65ffe2f140d0c84cee58566cad8900c5b9908`。
- 默认模型地址为容器内不可用的 `http://127.0.0.1:9/v1`，使用非机密占位值；embedding 与 reranker 使用镜像内本地模型。没有调用收费模型。
- `.env` 位于 Git 忽略的 `deploy/hindsight/.env`，本机权限 0600。Compose 固定 worker ID、仅绑定回环端口，并设置健康检查和日志轮换。

首次启动失败原因：总 worker 槽位设为 1，但上游默认给 consolidation 预留 2 个槽位，即使关闭自动 consolidation 也会进行此配置校验。显式设 `HINDSIGHT_API_WORKER_CONSOLIDATION_RESERVED_SLOTS=0` 后正常启动；没有通过放宽健康超时掩盖错误。

## 实测结果

| 检查 | 结果 |
|---|---|
| `corepack pnpm hindsight:up` | 通过，服务 healthy |
| `corepack pnpm test:hindsight-local` | 通过：镜像提交、独立卷、API/数据库健康、正式客户端 bank 配置、停止/启动后的配置持久化、空测试 bank 清理 |
| `corepack pnpm test:hindsight-protocol`，`HINDSIGHT_SMOKE_EXTRACTION_MODE=chunks` | 通过：固定版本、bank 配置、异步 retain、同 operation 重放、来源 metadata 召回、文档删除后不再召回 |
| 服务端清理复核 | 测试 bank 的 document、node、link 均为 0；pending/failed operations 均为 0，LLM 请求统计为空 |
| 管理界面 | 根地址跳转 `/dashboard`，最终 HTTP 200 |
| `corepack pnpm typecheck:hindsight-smoke` | 通过 |
| 已配置模型时的生命周期检查保护 | 使用合成凭据值验证，提前拒绝重启，错误输出不包含该值 |
| HTTP 适配器与模型契约回归 | 2 个文件 / 7 项通过 |
| `corepack pnpm test:cross-platform`、`git diff --check` | 通过 |

合成测试 bank 为 `df-protocol-248b5417-f989-476e-980c-07cdca2bcbca`。保留空 bank 及其操作记录用于核验；测试文档已删除。服务端记录包含一个 `batch_retain`、一个对应的子 `retain` 和一个 `graph_maintenance`，均已完成，不把父子任务的数量误判为重复模型调用。

宿主 Python `urllib` 的本机请求曾经由系统代理返回 502；改用与 DevFlow 一致的 Node `fetch` 直连回环地址后全部返回 200。该现象不是 Hindsight 服务健康失败，也没有改动系统代理设置。

原始日志保存在开发机 `/private/tmp/devflow-hindsight-deployment-91qfc6lv/`，包括启动失败/修正、生命周期检查、chunks 协议结果与服务端清理数据；不是 CI 或长期归档证明。

## 尚未验证

`chunks` 跳过 LLM 文本抽取。本次没有证明 `concise` / `verbatim` 抽取、业务实体和标签质量、计费幂等、取消后的迟到写入清理、约 30 题的检索价值或真实桌面项目的端到端效果。仍需明确模型提供方和预算后继续。

Electron 的 `DEVFLOW_HINDSIGHT_PROTOCOL_VERIFIED` 未设置，业务文档和正式记忆未上传，团队共享仍未启用。本次只修改部署配置、检查脚本与文档，未修改桌面运行时业务代码；首期全量验证结果仍以此前记录为准。
