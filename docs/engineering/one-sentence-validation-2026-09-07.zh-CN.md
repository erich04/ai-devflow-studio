# 一句原始需求的端到端补验 · 2026-09-07

状态：**进行中，尚未配对或执行 Provider，不计为端到端通过。**

## 验收口径

在已有 mini Agent 测试仓库上，通过真实 Team Web 新建 Project 和一句原始 Work Request，再按产品正常界面完成本地仓库选择、pairing、Inbox 承接、澄清、设计、实施、测试、GitHub Draft PR 交付与验收。需要模型的阶段调用真实 Provider；项目创建、配对、审批和交付则调用产品真实服务。

允许正常的项目配置、权限审批和产品内需求澄清。不在产品外代写设计、补充实现答案、修改目标代码、安装执行工作区依赖、推进数据库状态或手工发布交付 PR。已有测试仓库的干净 clone 是本地环境准备，并非产品自动建仓的证明；自动建仓和脚手架生成不另行加入本次小需求验收范围。

## 已执行

- 通过真实登录的 Team Web 创建 `Mini Agent One Sentence QA 20260907`，Project ID `p-mini-agent-one-sentence-20260907`。
- 在尚未生成配对码、尚未配对 Desktop 时，经 Web 创建 Work Request `work-request-9e8069f4-255d-429c-ae74-3f59d9a58048`，标题 `修改 README 主标题`，状态 `open`；Postgres 只读核验创建时间为 `2026-09-07T11:53:22.179Z`。原始输入只有：

  > 请把这个 mini Agent 项目的 README 主标题改为“Mini Agent — Ready for DevFlow”，其余内容保持不变。

- 使用已授权的隔离测试仓库 `erich04/devflow-mini-agent-live-20260906` 的 main 干净 clone，路径为 `out/one-sentence-20260907/mini-agent`，基线 `8491ff3f20918cd4f26390fa34373b7d224aecf4`；未编辑目标内容或安装依赖。没有复用已完成 Run、设计或测试结果。
- Team 服务使用既有 API/Postgres，修复后的 Web 副本运行于 4313；重新启动当前构建的真实 Electron Desktop。

## 当前阻塞与待验证项

- Desktop 原生控制通道只返回空的内容树，截图显示应用内容，但点击持续返回 `noWindowsAvailable`。已尝试 Raise、重新连接工具和按运行应用名定位；Chrome 控制正常。不能确认这是锁屏，更不能据此判定产品业务故障。已请求用户将本次 Desktop 窗口置于前台并保持可操作。
- 新 Project 的 GitHub Delivery 尚未配置。现有隔离仓库已绑定另一测试 Project；产品限制组织内同一仓库只能有一个 active binding。继续交付前必须通过正常产品路径明确处理测试绑定，不能把已有 PR 当作新 Run 的交付证据，也不能绕过约束改库。
- 尚无本次配对、本地 Run、Provider 调用、测试、Delivery 或 Acceptance 结果。此前两轮成功及其自动化测试记录保持独立，不用于填补本次缺失阶段。
