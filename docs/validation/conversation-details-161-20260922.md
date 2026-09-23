# Issue #161：独立会话详情与聊天区域

## 实现范围

聊天主区只保留 Tab、消息和输入框。右键 Tab、Shift+F10 / 菜单键或 Tab 的「…」
打开会话菜单，再进入独立详情弹窗；不切换当前会话。详情展示所属项目、执行方式、
下次发送的当前模型、历史实际模型、上下文统计、归档备注和有记录的用量/调用诊断。
名称修改需要明确保存，关闭不提交；帮助说明仍由小问号按需打开。

详情以项目 ID 和会话 ID 定位，项目切换清理旧入口。打开/关闭详情不卸载当前消息区，
不发送消息、不取消请求、不发布提案。保持现有上下文组装和 SQLite 合同，未添加迁移。
旧版备注明确停用；统计不假装是完整模型输入追踪。下次模型与历史调用模型分别呈现。

## 本地自动化

- `corepack pnpm verify`：类型检查、4,088 个测试、跨平台检查通过；15 个需要独立
  Postgres 环境的用例按默认配置跳过。
- `corepack pnpm exec vitest run apps/desktop/src/WorkbenchWorkspace.test.tsx`：14 个组件
  用例通过，包含未激活 Tab 的详情、项目隔离、草稿/滚动 DOM 保持、键盘菜单、明确重命名、
  失败重试、实时请求更新、取消、历史恢复以及新会话执行方式隔离。
- `corepack pnpm --filter @ai-devflow/desktop build` 与 `node scripts/build-desktop-pilot.mjs`：
  macOS ARM64 Electron 42.11.6 本地构建/打包通过。本变更不进行 Developer ID 分发验收。
- `node scripts/workbench-conversation-electron-smoke.mjs`：真实 Electron、IPC、SQLite、
  本地受控 SSE 模型端点的完整会话回归通过，22 次本地调用；不使用用户凭据或付费模型。

最终 Electron 检查覆盖：流式调查时打开详情仍继续原请求；未激活 Tab 的详情和长标题
重命名作用于正确记录；关闭恢复当前聊天的草稿与滚动位置；Shift+F10、Escape、嵌套帮助
焦点；480×600 弹窗滚动与关闭；1280×600 的消息区和输入框可见；1280/1366/1920 宽度；
重启后 Direct Provider/OpenCode 选择和草稿保留；提案保存、失败恢复、停止及关闭/重开历史。

在长标题保存测试中发现禁用保存按钮可能让键盘焦点离开弹窗，已在保存期间将焦点留在
弹窗，随后通过真实 Escape 关闭检查。最终脚本明确断言详情已关闭再进行后续操作。

截图与报告在本地 `out/workbench-conversation-qa/`：`report.json`、
`03-restored-tabs.png`、`11-inactive-conversation-details.png`、
`12-conversation-details-narrow.png`、`13-short-window.png`。这些都是隔离测试数据。

## 用户环境切换约束

切换前对本地 SQLite 做一致性备份，并保存 Postgres dump、旧应用和原启动配置。
原工作流、提案、聊天、Provider 与配对数据保留；只在会话无进行中请求时正常退出再更换应用。
API/Web 源码没有变化，重新启动已验证的同一服务构建与数据库。替换前检查应用身份、
Main 和 preload 与现有版本一致，避免因这次界面更新引入新的凭据身份。

重启后需比较 SQLite 与 Postgres 全部表的计数及内容摘要。仅忽略会话正常保存产生的
版本/更新时间差异；配对 token 若更新使用时间，须验证其余字段完全一致。实际比对报告
随本机发布目录保存；这份代码验证记录不代替重启后的最终数据核对。
