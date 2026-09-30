# 真实 DeepSeek 桌面流程验证 — 2026-09-30

## 结果与边界

在工作区改造（S0–S6）和知识上下文改造合入之后，用真实 DeepSeek 从需求澄清跑到 PR 交付包，检查当前 main 在真实模型下能否走完。共启动 5 次，最后一次完整通过；另有 3 次各停在一个产品问题上，已登记为 [#199](https://github.com/erich04/ai-devflow-studio/issues/199)–[#202](https://github.com/erich04/ai-devflow-studio/issues/202)。

- 代码：main `b6ca57f`，本机构建的桌面端（未打包、未签名）。
- 模型：`https://api.deepseek.com` 的 `deepseek-flash`；Provider 的思考设置保持默认（应用默认为开启 · low）。
- 范围：需求澄清 → 需求确认 Gate → 方案设计 → 方案评审 Gate → 开发实现（DevFlow Native）→ 测试证据 → PR 交付包。
- **不包括**：GitHub 分支发布与 Draft PR、业务验收、OpenCode 执行器、真实 Postgres、系统钥匙串、打包安装。PR 交付包之后没有继续。

## 环境与操作方式

- 每次运行都新建隔离环境：临时示例仓库（与工作区基线工具相同的 `health-api`，`npm test` 使用 `node --test`）、临时用户数据目录、独立数据档案注册表，以及内存版演示 Team API（未启用演示数据的桌面端）。
- 桌面端出网只允许本机回环地址和 `api.deepseek.com`；5 次运行中没有被拦截的请求。模型请求只记录路径、模型、消息条数和状态码，不记录正文。
- 模型密钥只存放在本次临时环境中，系统钥匙串未使用；结束后临时环境全部删除，并确认本记录、报告和仓库中都不含该密钥。
- 团队预算设为每月 $1.00、预警 $0.50；编码执行器为 DevFlow Native。
- 操作通过桌面端 IPC 完成，与 Electron 冒烟测试的方式相同：选择仓库这一步通过真实界面操作，其余步骤调用界面背后的同一组 IPC。精确差异审批前先读取并核对差异，只批准需求范围内的两个文件。界面状态用截图核对，没有逐项点击界面。

需求：

> 让 `src/health.js` 的 `health()` 在返回结果中增加 `checkedAt` 字段，值为调用时刻的 ISO 8601 时间字符串；保留原有 `status` 字段和值不变。在 `src/health.test.js` 中补充一条测试，验证 `checkedAt` 能被 Date 解析且与 `toISOString()` 结果一致。不引入新依赖，不修改其他文件。

## 通过的一次

| 步骤 | 结果 |
| --- | --- |
| 需求澄清 | 生成澄清 v1（5 条目标、5 个开放问题），10 秒 |
| 需求确认 Gate | 门禁审查给出 6 个风险、1 项证据缺口，仅警告，不阻断；按版本批准 |
| 方案设计 | 生成方案约 3,700 字，36 秒 |
| 方案评审 Gate | 审查给出 8 个风险、3 项证据缺口，仅警告；指出方案的测试策略没有验证 `checkedAt` 反映调用时刻，与需求验收口径有出入。按方案版本批准 |
| 开发实现 | Native 两次调用（分析 1,449 / 2,048、改码 1,409 / 4,096 输出 tokens），一次通过；1 个权限请求，精确差异只涉及 `src/health.js`、`src/health.test.js`，批准后写入受管工作树，保存的测试通过，16 秒 |
| 测试证据 | 在测试步骤单独运行 `npm test`：通过，退出码 0 |
| PR 交付包 | 生成交付包，停在「准备 GitHub 交付」 |
| 团队同步 | 团队数据中可见该任务，状态为等待 Gate |

模型的实现：

```js
export function health() { return { status: "ok", checkedAt: new Date().toISOString() } }
```

测试新增一条：断言 `checkedAt` 是字符串、能被 `Date.parse` 解析，且 `new Date(checkedAt).toISOString() === checkedAt`。

用量：桌面端「本任务用量」为 45,147 tokens、约 $0.029（阶段用量按峰时价估算，编码为已结算值）；6 次模型调用全部返回 200。

## 失败的三次

| 次序 | 停在 | 表现 | 登记 |
| --- | --- | --- | --- |
| 第 1 次 | 开发实现 · 分析阶段 | 输出达到 2,048 上限，`invalid_model_output / output_length`；思考为应用默认开启。已计费，没有改动 | [#200](https://github.com/erich04/ai-devflow-studio/issues/200) |
| 第 2 次 | 方案评审 Gate · 门禁审查 | 「模型返回的正文格式不完整，未保存本次报告」（映射为 `invalid_json`）；已计费，Run 未改动 | [#201](https://github.com/erich04/ai-devflow-studio/issues/201) |
| 第 3 次 | 方案设计 | 阶段执行按设计失败即停，原因 `settlement_sync_failed`；同时桌面页面被关闭，主进程仍在运行。原因未查明，之后加了崩溃采集，没有复现 | [#202](https://github.com/erich04/ai-devflow-studio/issues/202) |

另有两次启动因验证脚本自身的问题中止（仓库选择的菜单位置不对；清理上一次数据时误删了正在运行的这一次），没有调用模型，也不计入结论。

## 发现的问题

- **团队端重复计算 Native 编码用量**（[#199](https://github.com/erich04/ai-devflow-studio/issues/199)）：团队端项目用量为 56,537 tokens / $0.0349，比桌面端多出 11,390 tokens，正好是这次编码运行的用量。数据核实：阶段用量都带预算调用编号，编码的两次调用结算不带。读代码判断，Native v2 的决策提供方重建用量对象时丢掉了编号，团队端因此无法去重。预算扣减是否也多算，尚未核实。
- 上表中的 #200–#202。
- 未单独登记的观察：
  - 代码改动审批面板仍有英文：`EXACT CHANGE SET APPROVAL`、`Approve exact Change Set`、`Reject`、`CODING RUN`、`WORKFLOW NODE`、`RISK`、`FILES`、`DIGEST`、`DEADLINE`、`MANAGED WORKTREE`。PR 交付包正文的小标题（`Changed Paths`、`Evidence`、`Checklist`）也是英文。
  - `src/health.test.js` 的差异把未改动的 4 行显示为删除后再添加；文件中没有换行符差异，原因未查。
  - 编码失败后的摘要直接显示 Provider 内部 ID 与错误码原文（见 #200）。

## 费用

5 次运行共约 $0.08（桌面端按峰时价估算的合计；实际扣费以 DeepSeek 控制台为准）。

## 留存

截图（5 张）、运行报告、方案与交付包正文、精确差异留在执行者本机的临时目录，没有提交进仓库；截图中出现的本机路径只有验证脚本创建的临时目录。验证脚本放在仓库之外，没有提交。
