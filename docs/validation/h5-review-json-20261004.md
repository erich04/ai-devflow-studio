# H5：门禁审查输出分类与失败恢复验证

日期：2026-10-04。对应 [#201](https://github.com/erich04/ai-devflow-studio/issues/201) 与[加固计划 H5](../plans/post-redesign-hardening-2026-09-30.zh-CN.md)。基线：`8c6a501`。

## 结论与边界

本次完成确定性的错误分类调查和最小补丁。不能由历史的 `invalid_json` 断定模型输出被截断，也没有证据可以选择一种 JSON 修补规则。真实失败的响应正文未保留；本次仅使用注入的假 fetcher 和隔离演练，不读取模型凭据、不调用付费模型，不作为 H7 的真实模型回归，也不据此关闭 #201。

历史证据有两处：[原始流程记录](real-deepseek-flow-20260930.md)的方案评审失败，以及[知识上下文记录](knowledge-context-real-deepseek-20260930.md#失败与重试)的需求确认审查失败。后者明确记录 HTTP 200、`finish_reason: stop`，手动重试后成功；这仍不足以判断失败正文是空、语法错误还是其他形态。

## 调查与处理

接续原有 14 种输入的探针，先复跑取得相同结果：2 种合法包装成功，11 种归为 `invalid_json`，缺字段的 1 种为 `invalid_review_schema`。随后将仅断言结果数量的临时探针替换为正式测试 `packages/shared/src/review-json-output.test.ts`，通过真实的共享审查入口验证分类、用量和调用次数。

| 输入或响应条件 | 现在的结果 |
| --- | --- |
| 空字符串、仅空白 | `empty_content` |
| `content` 缺失或不是字符串 | `missing_content`（原有行为） |
| 完整合法的 JSON 数组、null、字符串、数字 | `not_json_object` |
| 纯说明文字、两个对象、前后带额外花括号、未转义引号／换行、尾逗号、语法未完成但以 `stop` 结束 | `invalid_json`，不猜测是否截断 |
| 对象缺必要字段，或字段类型不符合现有报告校验 | `invalid_review_schema` |
| `finish_reason: length` | `output_length`，优先于正文解析（原有行为） |
| 内容过滤、服务资源不足、缺少正常结束标志 | 保留各自原因，优先于正文解析 |
| 普通合法对象、说明文字包裹的合法对象、Markdown 包裹的合法对象 | 继续接收 |

产品改动限于共享解析器与失败说明：

- 区分空正文和非对象值；JSON 解析失败统一为固定的内部原因，不把可能带模型正文的 `SyntaxError` 放入错误因果链。
- 将“正文格式不完整”改为“正文格式有误，无法解析”；字段错误说明同时涵盖缺字段和格式不符。
- 保持原有解析接受范围，不自动修复引号、补括号、删除逗号或从多个对象中挑选报告，不新增自动模型重试。
- 复用已有的诊断字段：原因代码、HTTP 状态、结束原因、正文／思考长度、耗时、输出上限模式及费用状态。没有新增响应正文、思考正文、字段原值、数据库字段或上云数据。

桌面主进程原有的失败持久化、状态推送和界面重试路径无需修改。本次新增测试证明：

- 格式失败不保存新审查、产物或成功轨迹，Run 与 Gate 保持原样；已有报告及证据不被覆盖。
- 已报告的用量记录一次；没有用量时仍记为未知费用。一次失败只调用模型一次。
- 失败后执行锁被释放。用户明确重试会重新进行预算检查，并记录另一笔用量；已有报告时仍需携带准确的 `previousReviewId`。
- 界面收到主进程失败状态后显示“重试门禁审查”和费用提示；手动重试成功后显示审查证据，不自动批准 Gate。

## 本次验证

- 环境：macOS，Node.js `v24.18.0`，`corepack pnpm` `9.15.0`。
- 修复前：`corepack pnpm exec vitest run packages/shared/src/review-json-output.test.ts`，30 项中 10 项失败，覆盖分类与文案差异。
- 修复后：上述文件、`review-attempt-contract.test.ts`、`agent-review.test.ts` 共 3 个文件、80 项通过。
- 主进程与 App 的针对性回归：`corepack pnpm exec vitest run apps/desktop/electron/knowledge-review-runtime.test.ts apps/desktop/src/App.test.tsx -t 'malformed|saved Gate review'`，4 项通过。
- `corepack pnpm verify`：退出码 0；全仓类型检查、347 个测试文件／4,683 项测试、跨平台静态检查通过。另 1 个 Postgres 专用测试文件的 15 项按环境条件跳过；这不代表真实 Postgres 验证。
- `corepack pnpm build`：退出码 0。
- `corepack pnpm test:e2e`：退出码 0，41 项通过、1 项按需文档截图测试跳过，使用隔离演示服务和浏览器。
- `corepack pnpm test:electron-smoke`：退出码 0，使用临时仓库、独立用户数据目录／档案注册表、隔离演示服务和模拟模型。新工作区首次运行自动取得 Electron `42.11.6` 二进制。
- `git diff --check`：通过。

H6 的结算失败／窗口关闭复现与 H7 的真实流程验证均不属于本次补丁。
