<a id="devflow-studio-near-term-opencode-signoff-implementation-plan"></a>

# DevFlow Studio 近期 OpenCode 签收实施计划

> 历史计划执行约定：原文要求执行 Agent 使用 `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans` 逐任务实施，并用复选框（`- [ ]`）追踪。保留该约定不代表当前任务触发这些技能。

**目标**：让 v0.6.1 真实 OpenCode 路径易于本地签收，同时不削弱确定性的 CI/verify。

**架构**：模拟引擎保持默认自动化路径。为手工 OpenCode 冒烟增加小型、已测试的预检层，记录精确本地演示/签收命令，真实执行仍受环境开关控制。

**技术栈**：经 `tsx` 运行的 TypeScript 脚本、Vitest、既有 `scripts/opencode-smoke.ts`、README、`corepack pnpm`。

---

<a id="near-term-scope"></a>

## 近期范围

本阶段目标是 v0.6.1 签收准备：

- `corepack pnpm test:opencode-smoke` 默认安全且确定。
- 请求真实冒烟时，缺少 `opencode`、提供方、模型或密钥配置应清晰失败并给出处理建议。
- README 解释默认模拟路径、真实冒烟路径、必需环境变量及预期结果。
- 完整手工真实签收依赖本地 OpenCode 安装及提供方凭据。

<a id="tasks"></a>

## 任务

<a id="task-1-tested-opencode-smoke-preflight"></a>

### 任务 1：经过测试的 OpenCode 冒烟预检

**文件：**
- 新建：`scripts/opencode-smoke-preflight.ts`
- 新建：`scripts/opencode-smoke-preflight.test.ts`

- [x] 为跳过、阻断、就绪三种预检模式编写测试。
- [x] 实现 `evaluateOpencodeSmokePreflight(env)`。
- [x] 验证辅助函数从不打印提供方密钥值。

<a id="task-2-wire-preflight-into-smoke-script"></a>

### 任务 2：冒烟脚本接入预检

**文件：**
- 修改：`scripts/opencode-smoke.ts`

- [x] 脚本启动时使用 `evaluateOpencodeSmokePreflight(process.env)`。
- [x] 默认跳过行为保留退出码 0。
- [x] 真实模式被阻断时，在导入运行时模块前打印缺少的配置并以退出码 1 结束。
- [x] 预检就绪后，真实模式保持不变。

<a id="task-3-readme-signoff-instructions"></a>

### 任务 3：README 签收说明

**文件：**
- 修改：`README.md`

- [x] 增加 v0.6.1 编码 Agent 章节。
- [x] 记录默认模拟验证命令。
- [x] 记录真实 OpenCode 冒烟环境变量及命令。
- [x] 解释真实冒烟为手工运行，不属于 `verify`。

<a id="task-4-verification-and-push"></a>

### 任务 4：验证与推送

**命令：**

```bash
corepack pnpm test -- scripts/opencode-smoke-preflight.test.ts
corepack pnpm test:opencode-smoke
corepack pnpm --filter @ai-devflow/desktop typecheck
corepack pnpm test
git diff --check
git push origin devflow-v0.2-final-v0.3-start
```

预期：没有 OpenCode 或提供方密钥也能通过确定性检查。

<a id="live-signoff-evidence"></a>

## 真实签收证据

以下为 2026-06-17 历史结果，命令及输出保留原文，不代表本轮重新运行。

- 2026-06-17：安装/升级 OpenCode 至 `1.17.5`。
- 2026-06-17：验证火山引擎 Ark 提供方 `double/ark-code-latest` 可用两把本地 API 密钥调用模型，密钥值未写入项目文件。
- 2026-06-17：修复 OpenCode HTTP 差异捕获：返回空差异，或应用修改后消息 HTTP 流关闭时，回退到受管工作树 Git 差异。
- 2026-06-17：修复服务关闭，`stopAll()` 等待进程退出，超时则强制终止。
- 2026-06-17：`DEVFLOW_RUN_OPENCODE_SMOKE=1 DEVFLOW_CODING_ENGINE=opencode-http
  DEVFLOW_OPENCODE_PROVIDER_ID=double DEVFLOW_OPENCODE_MODEL_ID=ark-code-latest
  corepack pnpm test:opencode-smoke` 通过，输出为 `opencode smoke passed; changed paths: devflow-opencode-smoke.txt`。
- 2026-06-17：扩展真实冒烟和 HTTP 引擎支持多步权限转交。真实冒烟按 `bash -> edit -> bash -> bash` 批准权限后通过，并产出 `devflow-opencode-smoke.txt`。
