# Native v3：10 元以内的重点验收

## 授权与结论范围

用户授权将此前的预算方案交给 Cursor 讨论，独立判断其建议，然后实施。本轮只使用已授权的 DeepSeek API、合成数据与独立工作区；新增模型费用、失败、重试、子任务和未知费用预留合计不得超过人民币 10 元。已有费用不清零。本轮不是历史 `31 题 × Native v2 / Native v3 / OpenCode = 93 次执行` 的完整比较，不据此关闭 #239 或通过 #238 的完整质量门禁。

产品基线是 #239 修复 `40d96ee`，接续只修改验证工具的 #242 `ebd6d0b`。没有修改产品默认执行器、工具授权、记忆、聊天或 IPC。真实 Electron 的确定性验证、真实模型的宿主运行时验证分别记录，不能合并称作真实模型 Electron 端到端验收。

## Cursor 讨论与独立取舍

使用 `cursor-collab-review` 技能，Cursor `grok-4.7-xhigh`，只读 ask 模式。会话 `9138e529-6352-4dfc-b15b-9cb97bc21288`；原始意见保存在 B 工作区 `.tmp/native-v3-budget-20261025/cursor/budget-plan-20261025-092301.review.md`。没有让 Cursor 修改文件或发起模型测试。其初次意见为 fail，主要指出以下两处预算缺口；本变更修复后尚未交给 Cursor 二次签字。

| 意见 | 处理与理由 |
| --- | --- |
| 现有账本使用美元价目口径，不能把人民币 10 直接写成 USD 10 | 采纳。官方两张 token 价目表逐项比值为 0.15，因此人民币 10 对应账本 1.5；这是价目表映射，不是汇率。 |
| 各脚本独立 100 USD 账本可能绕过总预算 | 采纳。复用 #242 的 SQLite 原子账本，固定 scope；试题、交互、缓存、子任务、恢复共用一个总额。其余旧入口在本轮环境下启动即拒绝。 |
| bytes/4 不能证明输入 token 上界 | 采纳。保留模型完整 1,048,576 输入上界；只把实际输出上限降至 16,384。 |
| 原来的 8 元测试 + 2 元预留不够稳妥 | 采纳。软目标为缓存 1、交互 2、两道编码 3、一次定向重试 1、预留 3；唯一硬约束是共用总额 10 元。软目标不是另开额度，也不保证每阶段能跑完。 |
| 用小题复现历史假完成，不能再盲跑大仓库 80 步 | 采纳。恢复题来自 history-02 的时间边界语义，但明确标为新的小题；另复用深目录购物车行为。基础实现必须失败、参考实现必须通过独立测试后才能付费。 |
| 缓存前后对照容易受热缓存、模型轨迹影响 | 采纳。固定四轮只读探针，AB/BA 顺序，首轮单列，保留真实请求、system/tools hash、命中与未命中；控制组仅重建旧请求布局，不声称重跑旧产品。条件不满足就不计算“节省百分比”。 |
| 第一条未知费用后就停止所有阶段 | 不机械采用。保留完整最坏费用预留；只有剩余总额足以再预留一整次请求时才能继续。无法证明可容纳就停，绝不把未知费用视作 0。故障注入安排最后。 |
| #242 还混入产品实现变化 | 未采用该事实判断。逐文件 diff 仅含验证脚本与文档，没有产品代码变化；仍记录模型随机轨迹等实际混杂因素。 |
| 此次只改计划、不要运行 | 未采用。用户已明确要求落实；在预算保护和离线验证完成后运行。没有要求 Cursor 出具强制通过意见。 |

## 价格与硬预算

2026-10-25 核对 [DeepSeek 官方人民币价目](https://api-docs.deepseek.com/zh-cn/quick_start/pricing/)：`deepseek-flash` 对应 V4.1-Flash-1017；高峰每百万 token 输入命中 0.04 元、未命中 2 元、输出 8 元，空闲减半。账本的已知用量沿用 `estimateAgentTokenUsage` 的高峰价保守估算，再按官方两张价目表映射人民币，不是账单实扣；派发前还假定全未命中做最坏预留。实际运行再次核对了该函数的 `worstCase: true`，因此不把本轮周末费用称作按空闲价结算。

本轮单次完整预留 = `1,048,576 × 2 / 1,000,000 + 16,384 × 8 / 1,000,000 = 2.228224 元`，不是按实际小提示长度猜测上界。实际用量完整后释放多余预留；缺失用量保留 2.228224 元。超过额度的请求在网络派发前拒绝。价格版本/映射不匹配、401/402、授权过期、关闭后的账本均停止新增调用。

冻结：单轮最多 200 次模型调用，24 小时有效，输出 16,384，模型 high thinking。调用限额包含父子任务、恢复和压缩；Native 自身的连续无进展限制仍为 3。每道编码最多 24 次调用、5 分钟；不把脚本遗留 `maxSteps` 字段当作真正的产品步数设置。交互每场景 8–40 次，具体数值写入 `round.json` 并与数据库身份核对。

## 场景与停止规则

1. 四轮只读缓存探针，各四次调用：旧布局 A、修复布局 A、修复布局 B、旧布局 B。保存未经密钥污染的合成请求与原始用量。
2. 两道 Native v3 编码题：时间边界下有界恢复（6 条独立断言）、605 文件深目录购物车（5 条独立断言）。保留公共测试/配置并在独立目录验收实际交付，模型自称完成但独立失败必须记为假完成。
3. 十项交互：澄清、改需求及陈旧批准拒绝、交付中断恢复、验证进程中断、父子任务问答/重启/显式合并、文件冲突、重命名/删除/二进制交付、测试修改产物识别、人工业务条件、人工验证证据。
4. 最后两项故障：响应已到达但宿主未知的中断及一次明确重试、父任务取消时停止子任务实际测试进程。

不中途改题、改判分或增加预算。场景失败保留原始失败，后续独立场景可继续；账本不能再预留时后续场景全部标记 blocked。持久化的 running/failed 阶段不自动重跑。仅预留一个 `retry/recovery` scope，若确有修复需验证，由操作者记录理由后在同一本账中进行；默认运行器不自动使用它。没有必要就保留余额。

## 操作入口与证据

工具链 Node.js 24 / corepack pnpm 9.15.0。先测试，再提交代码；`freeze` 要求干净提交，记录提交号、固定题目 hash、scope、独立夹具资格结果。所有运行文件留在 git 忽略的专用目录中；密钥只从既有授权文件读取。

```sh
corepack pnpm typecheck:native-coding-live
corepack pnpm exec vitest run scripts/native-coding-cny-budget.test.ts scripts/native-coding-round-budget.test.ts scripts/native-coding-focused-fixtures.test.ts scripts/native-coding-cache-probe.test.ts scripts/native-coding-interactive-cli.test.ts
node --import tsx scripts/native-coding-focused-live.mts freeze .tmp/native-v3-rmb10-round
node --import tsx scripts/native-coding-focused-live.mts run .tmp/native-v3-rmb10-round /absolute/path/to/authorized-key-file
node --import tsx scripts/native-coding-focused-live.mts status .tmp/native-v3-rmb10-round
node --import tsx scripts/native-coding-focused-live.mts close .tmp/native-v3-rmb10-round
```

`budget.sqlite` 是权威账本；`summary.json` / 场景 `round-budget.json` 为只读投影，保留已知金额、未知次数、预留和总占用。不要删除账本或初始化新轮来绕开上限。最终报告列出运行时证据、独立测试、实际已知估价与未知预留，明确未覆盖项和后续门禁。

本轮已执行并封账，结果见 [验收报告](../validation/native-v3-budget10-20261025.md)。
