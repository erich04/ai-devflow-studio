<a id="v22-walkthrough-result"></a>

# V2.2 演练结果

这是 2026-08-27 对记录中精确候选提交和安装包的历史验收结果：通过。该次业务验收、重启恢复、脱敏与清理均通过；只发布了一条分支和一个草稿 PR，未合并。重启未重复签发凭据、推送或创建 PR；撤销检查取得持久化的 `binding_inactive` 结果。

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
Candidate: e7ba425c4c57e736a40d3231bdfe3e70ee33a5a9
Packaged artifact: 2.2.0 darwin-arm64 70672c5c4a6b560e33a9a163fb1038bff9c028d5a667509dcbf645293b48368d
Team schema v19; Desktop schema v32.
Verify: https://github.com/erich04/ai-devflow-studio/actions/runs/33057209702
Delivery series: github-delivery:5dada9da0fc8e65e6f0c8b3c314061ef5d0e60b240cd1637ed5aa7cff99741b0
Delivery attempt: 1; intent revision: 1.
Intent digest: 73a049cdb46066c2e4bc94942894a290dd17af3c7d0c8fa3e8db03d74ce0d00d
Test evidence digest: 6c7bc75c868cae7161bfdf2330967f552096b5ff642a9a835d8d7668d148a3aa
PR package digest: cb33d4a91f398bb243f17ada2270a18ca60e13151f20f13d0d387190581f0d26
Expected commit: 8ebdcb559e8d740fffccbedbed9290a3af8dd8ee; remote head: 8ebdcb559e8d740fffccbedbed9290a3af8dd8ee.
Draft PR: https://github.com/erich04/ai-devflow-studio-v15-sandbox/pull/3
Acceptance: completed. Restart recovery: passed.
Redaction check: passed. Cleanup: passed. The Draft PR was not merged.
Operator role: non-maintainer. Ad hoc maintainer assistance: false.
Approval role/auth: lead/session_cookie.
Lifecycle counts: Work Request 1, canonical Run 1, credential grant 1, branch publication 1, Draft PR 1.
Sandbox/App: private erich04/ai-devflow-studio-v15-sandbox via devflow-v1-5-sandbox-20260812.
Draft state: true; merged: false; automatic retry: false.
Restart side-effect repeats: credential 0, push 0, pull request 0.
Revocation proof: state version 2; intent github-delivery-intent-9f37bf9b-0c14-41b5-871c-b5fc463cc6a9; revoked binding version 2; outcome binding_inactive; checked at 2026-08-27T03:36:47.708Z; durable check count 1.
```
