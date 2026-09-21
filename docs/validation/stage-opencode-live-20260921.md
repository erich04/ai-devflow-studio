# OpenCode 只读需求澄清验收 — 2026-09-21

Issue #134 的成功链路已在隔离 Electron 中实际操作完成。实现基线为
`a0b574688d1e297c67b68ae8eeb48068f921ab6f`，OpenCode CLI 1.18.15，Provider 为
`https://api.deepseek.com` / `deepseek-flash`。这是实际模型调用，不是模拟 Provider。

## 操作与结果

- 使用 To Do 项目的独立副本，仓库基线 `c2be68d6c4a03fc219c483acc79a90fdf6e11ab6`。
- 在 UI 创建「OpenCode 验收：增加清除已完成按钮」，明确确认弹窗与撤销尚待决定。
- 在 Agents 选择 OpenCode 与已保存的 DeepSeek 配置，确认项目；在节点选择只读 Local Agent，点击生成需求澄清。
- Run：`run-c32e935c-4d3a-4e52-aa5b-68f147f41a44`。
- 执行时间：04:30:50–04:31:30 UTC，约 40.3 秒；记录执行器为
  `managed-opencode-read-only-stage-agent`，实际返回 23,651 tokens。
- 保存完整澄清正文（8,649 UTF-8 bytes）、revision 1 / `review_requested`，包含
  5 个目标、9 条验收标准、5 项非目标、11 项事实及 12 处代码引用。
- 12 处引用逐一核对文件哈希和行范围均有效；原有实现与待确认业务决定分开记录。
- UI 产物与轨迹可见；Run v2 停在需求确认 Gate。未批准 Gate，仓库前后均无修改。
- 使用应用菜单正常退出并重开，产物、版本、轨迹及待确认状态恢复。

原用户的项目、Run 和聊天未用于此测试。完整本地证据保存在隔离测试输出目录的
`stage-opencode-live-evidence.json`；凭据和完整私有路径不进入此记录。

## 已知边界

这次证明的是需求澄清的真实 OpenCode 读取、模型执行、证据校验、落库和重启恢复，
不代表本次重新执行了开发与发布。模型仍对已给定的按钮位置和文案提出了一些重复问题；
用户仍需审阅草稿。CLI 失败、超时、取消、证据错误的分类与恢复由阶段执行器的自动化
测试覆盖，真实成功调用与模拟失败测试分别计入证据。
