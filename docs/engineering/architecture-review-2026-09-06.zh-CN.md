# 整体方案评估与微重构记录 · 2026-09-06

**结论：保留现有产品架构，优先收敛持久化与入口编排的复杂度。** Desktop 本地执行、API/Postgres 团队治理、共享领域规则这一分工符合项目目标；本轮发现的实际缺陷来自写操作接入规则依赖人工维护。建议继续沿已有架构做小步重构。

本次依据 README、CONTEXT、Roadmap、相关 ADR、测试策略，以及 Desktop、API、Web、shared 的关键实现和测试进行评估。文件规模用于定位检查重点，不直接作为重构理由。本次没有开展全仓逐行安全审计或生产负载性能测试。

**值得保留的设计**

- 确定性 Workflow 管理 Run、Gate、Evidence，Agent Runtime 负责有界执行。模型能力升级后，身份、预算、人类批准和重试幂等仍应由确定性代码维护。依据：[ADR 0014](../adr/0014-bounded-agent-runtime.md)、[workflow-transition.ts](../../packages/shared/src/workflow-transition.ts)。
- Electron main 持有本地源码、凭据、完整证据；团队端使用受控投影。这个分工能承载本地优先和团队协作两个目标。依据：[ADR 0003](../adr/0003-postgres-sqlite-data-boundary.md)、[agent-runtime-team-projection.ts](../../packages/shared/src/agent-runtime-team-projection.ts)。
- 已有合适的内部拆分范例：LocalStore 的 schema、privacy、workflow、persistence 已分离；Memory human actions、Coordination commands 和 Coding Executor 也有独立接口。后续可沿这些真实调用关系继续拆分。
- 验证基础较完整。修改前 `corepack pnpm verify` 通过：254 个测试文件、3598 个测试，以及类型检查和跨平台静态检查。它为渐进式重构提供了可靠起点。

**重构优先级**

| 优先级 | 代码证据与实际成本 | 建议的重构单元 | 验收要求 |
| --- | --- | --- | --- |
| 最高，本轮已处理 | `local-store.ts` 的写入名单遗漏 MCP 安装/修改和删除，绕过串行与失败恢复。6 个新增测试复现了内存/磁盘不一致。 | 将遗漏操作接入现有队列；把部分方法名单改成覆盖完整 Interface 的执行策略。 | 安装、修改、删除分别验证写盘失败回滚、精确重试、并发写入和重新打开后的状态。 |
| 高 | [local-store.ts](../../apps/desktop/electron/local-store.ts) 修改前 13,746 行，Interface 有 151 个方法；Workflow、Memory、Coordination、Delivery、Outbox 同处一个实现，调用者和维护者需要了解大量无关事实。 | 先抽取 Local MCP 存储实现，再逐步抽取 Outbox、Delivery、Memory/Coordination。对外保留现有 facade，内部按事务用途划分 Module。 | 同一 Database、同一写队列、同一原子持久化出口；跨领域操作和 Outbox 必须一起提交、一起回滚。 |
| 高 | [main.ts](../../apps/desktop/electron/main.ts) 3,627 行，包含 IPC 注册、runtime 装配、GitHub Delivery 恢复、Gate 评估与工作流推进；[coding-runtime.ts](../../apps/desktop/electron/coding-runtime.ts) 3,639 行。 | 先把一组完整的业务命令移入 main-owned Module，如 Gate 操作或 Delivery 编排；入口只负责装配、解析输入和调用。沿用现有窄依赖接口。 | 使用真实 main-owned 执行路径验证权限、取消、超时和重启；renderer 继续只提交受约束的标识及版本。 |
| 中 | [postgres-team-repository.ts](../../apps/api/src/repositories/postgres-team-repository.ts) 4,230 行；Runtime、Memory、Coordination 的接受规则分别写在 Seed 分支和 Postgres 条件更新中。 | 按身份/配对、团队概览、运行投影拆分内部实现；优先复用跨 Adapter 的行为测试案例，约束两种实现的结果一致。 | 保留 SQL 中的版本、作用域、终态和单调性条件；不能用一次 JavaScript 预检查替代并发安全的条件更新。 |
| 中 | [useDesktopWorkspace.ts](../../apps/desktop/src/app/useDesktopWorkspace.ts) 集中维护大量独立 state/setter；[useDesktopActions.ts](../../apps/desktop/src/app/useDesktopActions.ts) 1,456 行，同时处理多类业务操作。 | 按 Run 选择、Coding、Delivery、配对等真实交互拆分状态与动作；重复的批量状态更新使用领域事件或 reducer。 | 保留现有行为；组件测试和浏览器 E2E 验证异步刷新不会把其他 Run 的结果写入当前选择。无需先更换状态管理库。 |
| 数据量增长前规划 | `getTeamOverview` 并行读取多个组织级集合，之后在 [team-routes.ts](../../apps/api/src/routes/team-routes.ts) 依据会话过滤；当前查询未按页面做分页。 | 为概览建立专用汇总查询，为 Run、Trace、Evidence 提供按授权项目限定的分页读取。 | 先测量代表性数据下的扫描行数、响应体积和延迟，再选择切分点。当前没有足够证据声称它已是性能瓶颈。 |

**本轮改动与原因**

原先 `MUTATING_LOCAL_STORE_METHODS` 是一个只列出部分方法的 `Set<keyof LocalStore>`。类型系统能阻止拼错方法名，却不会要求新增方法声明执行方式。`commitLocalMcpInstallation` 和 `deleteLocalMcpInstallation` 因此直接写入 SQLite 和落盘，未经过 `runDurableMutation` 的快照恢复。

问题存在两种可复现表现：

1. 将数据库文件路径暂时替换成目录以制造真实落盘失败，MCP 操作虽然返回异常，内存里的安装记录却已经新增、修改或删除；下一次成功持久化可能带入这次失败变更。
2. 暂停一次 Settings 持久化，启动 MCP 操作，再使 Settings 写入失败；Settings 的旧快照恢复可能抹掉 MCP 的内存变更，而 MCP 仍报告成功。

现在使用 `LOCAL_STORE_METHOD_EXECUTION satisfies Record<keyof LocalStore, 'direct' | 'durable'>`，显式覆盖 151 个方法。MCP 的两个写入口进入现有 durable 队列，读操作及临时 authority/lifecycle 操作保留 direct 执行。Memory retrieval 会更新过期状态与审计，所以仍按 durable 执行。移除了 Proxy 返回值上不必要的双重类型断言。

这项微重构增加了显式声明，但把“记得更新写名单”变成了类型检查要求。它不能自动判断一个方法是否被错误标记为 direct；有副作用的方法仍需代码审查及行为测试。

新增 [local-mcp-durable-mutations.test.ts](../../apps/desktop/electron/local-mcp-durable-mutations.test.ts)，保留原有 MCP 存储测试。测试通过公开 LocalStore Interface 验证安装、修改和删除三种操作，覆盖失败后的状态恢复、精确重试、其他写入成功后不残留失败变更，以及重新打开数据库后的内存/磁盘一致性。

**后续实施顺序**

1. 先完成并验证本轮执行策略修复。
2. 已在后续微重构中抽取 [local-mcp-store.ts](../../apps/desktop/electron/local-mcp-store.ts)，承载读取和 CAS 写入；facade 继续持有动态 Database 引用和 durable 执行权。回滚会替换 Database 实例，内部 Module 不得缓存已经关闭的旧实例。原公开 Interface、SQL 条件、写入顺序和失败恢复行为保持一致。
3. 每次选择一个 Outbox、Delivery 或 Memory 用例，收窄它所需的 Interface，再移动实现。跨领域原子操作继续由同一事务协调者负责。
4. 再处理 main 的业务编排、Seed/Postgres 的契约一致性和前端状态组织。每个改动单独验证，避免把结构迁移、规则修改和新功能混在一起。

各层的严格解析、脱敏、版本检查和 SQL 并发条件具有不同职责，不能仅凭代码相似就删掉其中一层。首次拆分也不需要引入通用 Repository 基类、额外微服务、全新 ORM 或新的 Agent 框架。

**本轮验证记录**

- 修改前：`corepack pnpm verify` 通过，254 个测试文件、3598 个测试。
- 缺陷复现：新增的 6 个失败恢复/并发场景在原实现下全部失败。
- 修复后：`corepack pnpm verify` 通过，255 个测试文件、3604 个测试；包含类型检查和跨平台静态检查。
- `corepack pnpm build` 通过。
- `corepack pnpm test:electron-smoke` 通过，覆盖真实 Electron main/preload、SQLite 和工作流路径。
- `corepack pnpm test:build-output-smoke` 顺序执行通过，确认 API、Web、Worker 产物可脱离源码运行。首次与 Electron smoke 并行执行时出现 Web `/_document` 缺失；两项检查都会使用同一 `apps/web/.next` 目录，后续在同一 checkout 内应顺序运行。
- 打包构建和 `corepack pnpm test:desktop-pilot-smoke` 通过；Agent Runtime、Native Coding、Memory 的重启重复副作用计数均为 0。原有 `out/desktop-pilot` 已恢复，本轮产物单独保存在 `out/architecture-review-20260906-fpjxtspw/desktop-pilot`。

此次变更不涉及数据库 schema、迁移、IPC 契约、团队权限或远程发布；它不会修复既往失败写入可能已经留下的状态。测试结果属于本次局部重构验证，不替代 Roadmap 规定的正式发布证据。

**真实流程驱动的后续微重构**

- 从 main 提取 [workflow-test-command.ts](../../apps/desktop/electron/workflow-test-command.ts)，让“执行当前 Test”负责选择当前 Build 的最新 Coding worktree、核实仓库身份与 HEAD、持有工作区锁直至证据提交。入口继续装配原有原子 Workflow 命令。它修复了实际测试错误使用源 checkout 的问题。
- 从 main 提取 [stage-agent-failure.ts](../../apps/desktop/electron/stage-agent-failure.ts)，集中处理失败诊断、Trace/Event 和可信 Provider usage 的原子审计。模型输出不合法仍不推进流程，但不会丢失已经返回的用量。
- 验收 bundle 将实际 Delivery、精确 commit 测试、diff 和执行来源绑定在一起；Review Context 使用正确的 Local/Team policy 映射，并区分历史失败与最终交付状态。
- Native repair 增加“无法在原范围内安全修复”的出口，先保存失败测试再调用 repair；生产 worktree 根目录由 main 装配到当前 profile 的持久目录。原工作区按记录继续读取，没有批量迁移历史路径。

这些边界均由真实流程暴露的问题确定，没有继续按文件行数扩大拆分。具体环境、真实调用、Draft PR、失败样本和验证结果见[真实 Provider 流程记录](live-provider-validation-2026-09-06.zh-CN.md)。
