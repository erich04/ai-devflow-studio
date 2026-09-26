<a id="v15-walkthrough-result"></a>

# V1.5 演练结果

这是 2026-08-12 对记录中精确候选提交和安装包的历史验收结果：通过。该次业务验收、重启恢复、脱敏与清理均通过；只发布了一条分支和一个草稿 PR，未合并。重启未重复签发凭据、推送或创建 PR；撤销检查取得持久化的 `binding_inactive` 结果。

下面是发布验收程序按固定字段解析的原始记录，逐字保留英文键、数值、哈希和状态，不把它改写为当前候选版本已通过的证明。字段含义如下：

| 原始字段 | 中文含义 |
| --- | --- |
| Status / Candidate / Packaged artifact | 验证状态、候选提交、安装包版本/平台/哈希 |
| Team schema / Desktop schema / Verify | 团队与桌面数据库结构版本，以及 CI 运行链接 |
| Delivery series / Delivery attempt / intent revision | 交付系列、尝试次数、意图修订号 |
| Intent digest / Test evidence digest / PR package digest | 交付意图、测试证据和 PR 交付包的摘要 |
| Expected commit / remote head / Draft PR | 预期提交、远端分支提交和草稿 PR |
| Acceptance / Restart recovery / Redaction check / Cleanup | 业务验收、重启恢复、脱敏检查和清理结果 |
| Operator role / Ad hoc maintainer assistance / Approval role/auth | 操作者角色、是否接受临时维护者协助、审批角色与认证方式 |
| Lifecycle counts / Sandbox/App | 各生命周期动作的数量，以及测试仓库和 App 身份 |
| Draft state / merged / automatic retry | 是否为草稿、是否合并、是否自动重试 |
| Restart side-effect repeats | 重启后的重复外部操作次数 |
| Revocation proof | 撤销证明的状态版本、意图、绑定版本、结果、检查时间和持久化检查次数 |

```text
Status: Passed
Candidate: f461f9d9de300b8e4a15fe31be8f518bde37b2b8
Packaged artifact: 1.5.0 darwin-arm64 3e44cdfe6d07aa355c259821e2b36f857cbd3ac239bde2ea7c3cdc34abfc449b
Team schema v15; Desktop schema v17.
Verify: https://github.com/erich04/ai-devflow-studio/actions/runs/31633025574
Delivery series: github-delivery:90a999c3ae97e920e73c053cc8f7a3bd56b9cc38ccdeea9034ff4a8b71f73f74
Delivery attempt: 1; intent revision: 1.
Intent digest: 20dca0dc2da4e81c8bf9c74f07e28f3f44a251fe52b39402f01c900c77f039f6
Test evidence digest: dadca78bae76a6771c684ec62b4f2f5fe898197358766091f85de1ed3457a2e0
PR package digest: 0d0735c8eb76823236248b8687d52403073742d8137decac2c4cb980398fd264
Expected commit: b82224c114bed17c5934ec8d540267fd871f2e86; remote head: b82224c114bed17c5934ec8d540267fd871f2e86.
Draft PR: https://github.com/erich04/ai-devflow-studio-v15-sandbox/pull/1
Acceptance: completed. Restart recovery: passed.
Redaction check: passed. Cleanup: passed. The Draft PR was not merged.
Operator role: non-maintainer. Ad hoc maintainer assistance: false.
Approval role/auth: owner/session_cookie.
Lifecycle counts: Work Request 1, canonical Run 1, credential grant 1, branch publication 1, Draft PR 1.
Sandbox/App: private erich04/ai-devflow-studio-v15-sandbox via devflow-v1-5-sandbox-20260812.
Draft state: true; merged: false; automatic retry: false.
Restart side-effect repeats: credential 0, push 0, pull request 0.
Revocation proof: state version 2; intent github-delivery-intent-39d3135e-768c-46c9-93f7-5231a17bd565; revoked binding version 2; outcome binding_inactive; checked at 2026-08-12T19:56:57.720Z; durable check count 1.
```
