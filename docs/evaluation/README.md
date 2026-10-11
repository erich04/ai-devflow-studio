# Native v3：真实任务对照与证据

当前状态：**已检查题目有效性，尚未运行真实模型对照**。资格检查使用历史真实代码和验收测试，不能当作 Native 的成功率。

## 固定输入与资格

- [任务候选集 v2](native-coding-v3-tasks.json)：35 项，固定仓库、基线 SHA、参考修复 SHA、验收文件和开发/保留划分。
- [行为任务说明](native-coding-v3-task-briefs.json)：逐题写明现象、期望行为和不可破坏的边界。真实模型输入使用这里的 `prompt`，不再只给提交标题；运行前同时冻结本文件与候选清单的摘要。模型看不到资格报告、参考提交或验收测试。
- [实际资格结果](native-coding-v3-qualification-20261011.json)：31 项合格，4 项保留为不合格；合格要求参考修复全部断言通过，基线至少一个断言失败。编译/收集错误、超时不能冒充成功复现。
- [最初 30 项清单](native-coding-v3-tasks-v1.json)保留。尚未进行任何模型实验时，因资格检查发现问题追加了 5 项；没有按模型输赢筛题。
- 不合格原因：01 的基线也通过；16、18 同时依赖 Playwright，当前 Vitest 资格工具没有覆盖；33 的参考修复仍有一项断言失败。它们不算解题成功，也不从报告抹掉。

原始资格输出在忽略目录 `out/native-v3-evaluation/qualification-20261011-r2/`，包括每题基线/参考测试 JSON、安装日志、验收文件与报告摘要。前 30 项的结果沿用相同任务定义的首次实际执行，保留 `sourceManifestDigest`；新增 5 项另外执行。每一份参考断言都有固定 SHA，不能从候选的测试结果反推通过。

## 复验题目

```sh
node scripts/native-coding-evaluation.mjs qualify docs/evaluation/native-coding-v3-tasks.json out/native-v3-evaluation/new-qualification
```

也可以在最后追加一个或多个任务 ID。脚本在独立临时目录导出精确基线及参考版本，将参考验收测试放入验证副本，按各自 lockfile 安装依赖后实际运行。没有挂载开发仓库的 node_modules，也不向历史测试传递模型密钥等环境变量。目录是新建的；失败事实保留，不能覆盖旧输出假装首次通过。

这一步只验证题目的基线/参考测试。行为任务说明根据相应提交的公开问题和新增行为断言整理，不改变已有资格结果，也不把资格通过解释为提示已完成实测。历史回归题之外的[交互与故障实验规程](native-coding-v3-interactive-protocol.md)单独覆盖深层调查、澄清、插话、恢复、子任务、文件变更和证据失效；不能用一个总通过率遮盖未测类别。

## 三执行器运行规则

真实调用只使用用户指定的项目、模型提供方、金额上限。尚无这些授权信息，因此没有启动 Native v2/v3/OpenCode 的付费实验。

实验前记录并冻结：候选代码提交、31 项合格任务的输入、各执行器及模型版本、每题/总费用或 token 上限、环境、工具/网络范围、重试与人工介入规则、重复次数和验收阈值。同模型优先；不同模型分组报告，不把模型差异归于 Harness。保留任务不能参与提示或默认阈值调参。

候选仓库只得到基线和任务说明，不能得到参考 SHA、参考补丁或隐藏验收文件。真实调用必须经过 DevFlow 的预算和执行入口。独立验证副本由评价程序/操作者持有，覆盖参考验收及保护测试配置；不能让模型删改测试或配置后仅用退出码判成功。发生不确定请求时保留原收费事实，额外 attempt 同样计入预算。

每个 trial 保存 Coding Run、最终内容摘要、原始模型/工具日志引用、独立验收输出、费用账本及环境摘要。`independentPassed` 必须来自独立验收，不能复制模型的完成声明或宿主批准状态。

## 评分数据

`runs.json` 是观测记录数组，每行至少包含：

```json
{
  "taskId": "devflow-history-02",
  "engine": "native-v3",
  "trial": 1,
  "provider": "实际提供方",
  "model": "实际模型版本",
  "claimedCompleted": false,
  "independentPassed": false,
  "costUsd": null,
  "durationMs": 1000,
  "metrics": {
    "humanInterventions": 0,
    "inputTokens": null,
    "outputTokens": null,
    "peakContextTokens": null,
    "effectiveInvestigationSteps": 0,
    "repairAttempts": 0,
    "recoveryAttempts": 0,
    "recoverySuccesses": 0
  }
}
```

上面仅是格式示例，不是本次观测。未知费用和指标写 null；未执行不能填 0 或通过。实际记录另保留证据引用。三个执行器使用相同 trial 编号；不完整重复、重复记录和不同模型比较都必须可见。

```sh
node scripts/native-coding-evaluation.mjs score docs/evaluation/native-coding-v3-tasks.json runs.json docs/evaluation/native-coding-v3-qualification-20261011.json new-score.json
```

评分包含观察/缺失数量、独立通过率与区间、误报成功、父子合计费用、未知费用、用时、人工介入、上下文/调查/修复/恢复指标，以及同模型的 v2/v3 配对结果。全部候选都保留在报告；未执行/不合格项不伪造完成率。需要只对合格题计算比较时，先冻结一个明确的合格子集输入及其摘要，同时保留全量资格报告。

`releaseReady` 始终不由这份统计工具自动变成 true：它无法单独证明观测来源、预授权费用、真实端点兼容或跨平台行为。发布评审须核对原始工件与预先冻结的门槛。少量任务零误报不代表现实错误率为零。
