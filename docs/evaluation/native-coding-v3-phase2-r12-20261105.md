# Native Coding v3：R12 中断记录（2026-11-05）

R12 未完成全部十题，不能作为完整验收轮次。固定反馈模式、原 r8 题目和外部断言不变；模型仍为 DeepSeek Flash/high，原每题 15 分钟、80 步、192 次调用和全轮 2.70 美元上限不变。

运行目录：`~/.codex/evaluations/native-v3-phase2-fixed-20261105-r12`。冻结提交：`4782f2f9103e3cbd5ff7f448ef253cfba2bddbc8`。

| 题目 | 实际交付 D | 候选 C | 观察 |
| --- | --- | --- | --- |
| 02 | 81/81 | 81/81 | 正常交付通过 |
| 03 | 323/339 | 323/339 | 原外部安装因 npm 域名解析失败而无效；网络恢复后，仅用原验收器复查原始 D/C，源文件未变 |
| 04 | 无完整结果 | 无完整结果 | 用户暂停时中断，未生成 `trial.json`，不补造结果、不自动补发请求 |
| 05–11 | 未运行 | 未运行 | 未派题 |

03 的原始失败仍保留在 `runs.json` 和原安装日志。补查记录单列为 `oracle-recheck-summary.json`、`rechecked-initial-runs.json` 和 `rechecked-initial-score.json`。初次停止的汇总文件另存为 `initial-*.json`；没有覆盖原题输出或把不同模型运行的成绩拼在一起。

04 的 21 条账本记录中，已知费用合计 0.031904376 美元，另有一笔未最终确认的请求，保留 0.151729800 美元上界。全轮停止时账本计入 0.292529690 美元；该数字含未确认预留，不等于确认消费。证据见 `user-pause-20261105.json`、`runner-failure.json`、`interruption-audit-04.json` 和原 `ledger.json`。

R12 的 03 在首个固定验收反馈返回前即因依赖准备失败暂停。原始安装错误是 `getaddrinfo ENOTFOUND registry.npmjs.org`。源码核对发现每条 OS 沙箱命令使用新的临时 HOME，导致 pnpm 本体也被重复下载；已有依赖 seed 仅保存包存储，没有保存 Corepack 的包管理器缓存。后续修复针对这一共用执行问题，不修改题目、参考断言或模型限额。

用户随后授权磁盘清理。R12 全目录保留；旧轮次只移除已验证可重建的依赖、源码包和完成的 V 副本，保留账本、对话、报告、补丁、C/D、修订、事务及内容 blobs。验证副本已实测可恢复相同源码摘要和 Git 提交。清理记录位于当前工作区的 `out/phase2-fixed/disk-cleanup-20261105/`。
