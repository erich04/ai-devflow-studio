# 参与 DevFlow Studio 开发

DevFlow Studio 是面向作品展示与实际验证的多运行时应用。每次变更应范围清楚、经过测试，并易于复现。

<a id="working-rules"></a>

## 工作规则

- 使用功能分支，不直接在 `main`/`master` 上开发。
- 验收或加固补丁不混入新的产品范围。
- API 与 Electron 共用的领域规则优先实现为共享纯函数。
- 渲染进程不能直接访问文件系统、Shell、凭据或 SQLite。
- 团队策略以 API/Postgres 为准；桌面端负责使用、缓存、解释和执行。

<a id="tdd-style-flow"></a>

## 测试驱动流程

- 改变行为之前先编写能够失败的测试。
- 选择能够证明契约的最小测试层。
- 写入路径必须测试主进程/API 的权限约束，不能只依赖界面按钮禁用。
- 针对性测试通过后再重构。

<a id="signoff-checklist"></a>

## 验收检查清单

宣称里程碑或加固补丁完成前，应确认：

- `git status --short` 仅包含有意保留的变更。
- 新文件已纳入 Git 跟踪。
- 修改范围的针对性测试通过。
- `corepack pnpm typecheck` 通过。
- `corepack pnpm test` 通过。
- 修改界面/运行时路径时，`corepack pnpm test:e2e` 和 `corepack pnpm test:electron-smoke` 通过。
- 修改 API/Postgres 策略或同步行为时，`corepack pnpm test:postgres-smoke` 通过。
- `corepack pnpm build` 和 `corepack pnpm verify` 通过。
- 完成里程碑时，在路线图或计划文档记录实际验收情况。
