<a id="stabilization-v03-acceptance-result"></a>

# 稳定性 V0.3 验收结果

日期：2026-08-17。记录时间：2026-08-18T04:24:59Z。状态：**通过**。

实现候选：`1cb0482a9afe157c4e1dcdd7ae4e8026939f2b9d`。本文保留当时的历史验收。

<a id="outcome"></a>

## 结果

稳定性 V0.3 计划完成。候选修复已确认的编码差异及出站发布泄露边界，收敛活跃源码线，加固配对和租户作用域，并拆分 LocalStore，同时保留单一原子持久化出口。验收基线为团队 schema 19、桌面 schema 32。

标准安全扫描完成全部覆盖，审查八个面，无延后或未解决项，可报告问题为零。精确扫描标识与不可变产物摘要见 [security-report.md](security-report.md)。

<a id="verification-matrix"></a>

## 验证矩阵

以下命令均针对该实现候选成功完成：

| 边界 | 命令 | 结果 |
| --- | --- | --- |
| 工作区类型、测试、跨平台 | `corepack pnpm verify` | 222 个测试文件、3108 项通过 |
| 生产包 | `corepack pnpm build` | API、桌面、Electron、preload、Web、Worker 通过 |
| V1.5 确定性交付 | `corepack pnpm test:v15-github-delivery` | 5/5 通过 |
| V2.0 评估器 | `corepack pnpm test:v20-agent-runtime-evaluator` | 通过 |
| V2.0 不可变完成记录 | `corepack pnpm v20:completion-status` | 通过 |
| V2.1 评估器 | `corepack pnpm test:v21-retrieval-memory-evaluator` | 通过 |
| V2.1 不可变完成记录 | `corepack pnpm v21:completion-status` | 通过 |
| V2.2 评估器 | `corepack pnpm test:v22-multi-agent-evaluator` | 通过 |
| V2.2 不可变完成记录 | `corepack pnpm v22:completion-status` | 通过 |
| 真实 PostgreSQL 16 | `corepack pnpm test:postgres-smoke` | 团队 schema 19，通过 |
| 生产 Compose 栈 | `corepack pnpm test:docker-smoke` | 通过 |
| 迁移/回滚生命周期 | `corepack pnpm test:docker-lifecycle-smoke` | v10 至 v19 及回滚通过 |
| 桌面候选 | `corepack pnpm build:desktop-pilot` | 通过 |
| 桌面运行时 | `corepack pnpm test:desktop-pilot-smoke` | 通过，重启重复 0 |
| 离线打包 GitHub 交付 | `DEVFLOW_PACKAGED_SMOKE_NETWORK_MODE=offline corepack pnpm test:v15-github-delivery-packaged-smoke` | 通过 |
| 产物完整性 | `node scripts/desktop-artifact-trio.mjs verify <exclusive-index> --exclusive` | 通过 |

打包交付门禁观察到恰好一次非强制分支发布和一个草稿 PR，重启无重复副作用，验收与绑定撤销成功，无持久秘密泄露，清理成功。使用新建临时 Postgres 和离线模拟 GitHub 边界，未用付费服务商或生产 GitHub 写入替代确定性发布契约。

<a id="desktop-artifact"></a>

## 桌面产物

- 产品：AI DevFlow Studio 1.5.0。
- 平台：`darwin/arm64`；Electron 33.4.11。
- 归档：`ai-devflow-studio-desktop-1.5.0-darwin-arm64.tar.gz`。
- 大小：103,961,220 字节。
- SHA-256：`893d13f0d6b8f9ea38b38df56adefaf27b40b226e9490f5d465e692d9898d038`。
- 已签名/安装器：否/否。
- 独占产物三件套校验：通过。

<a id="cleanup-and-handoff"></a>

## 清理与交接

临时 Postgres 容器、Docker 冒烟容器、网络、卷、候选专用镜像、打包冒烟数据库、桌面冒烟进程和临时独占产物目录均已删除。所有门禁后实现候选仍干净且未改变。

结构化记录见 [verification.json](verification.json)。本结果对应实现候选的仅证据直接子提交；封存安全扫描和完整运行时矩阵后未修改生产源码。
