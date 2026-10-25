# Hindsight / DeepSeek 真实合成验证

日期：2026-10-20。用户授权：使用现有 DeepSeek，仅合成文本，本次总费用上限人民币 5 元。接续[本地部署验证](hindsight-local-deployment-20261020.md)；沿用固定 Hindsight 1.0.0 镜像与提交。

## 结论

真实抽取、宿主投影与清理链路通过。中文模块名、枚举标签及 map 字段可按示例模型抽取；但英文问句检索中文资料的排序出现错误，本轮不能作为检索价值验收或业务项目上线许可。

测试结束后关闭本次计费授权、停止测试网关，Hindsight 恢复不计费待机配置。Electron 的网络闸门仍关闭，没有上传业务资料，没有开启正式记忆的主动语义注入。

## 模型和预算

- 请求模型：`deepseek-flash`，关闭思考，单请求最多 128 KiB，输出最多 8,192 tokens；embedding 与 reranker 继续在本机运行。
- 单独的测试网关和账本，未修改另一项目的服务或人民币 10 元账本。现有 DeepSeek 凭据只读挂载，没有复制或写入仓库。
- 发出前按请求字节数、输出上限和保守余量预留费用；失败或未知结果保留全部预留。账本先持久化再请求上游，重启不重置额度；测试结束持久关闭授权。
- 采用核对当日官方高峰价格：每百万输入 tokens，缓存命中 0.04 元、未命中 2 元；每百万输出 tokens 8 元。[DeepSeek 官方价格](https://api-docs.deepseek.com/zh-cn/quick_start/pricing/)

| 实测用量 | 结果 |
|---|---:|
| 本次授权上限 | ¥5 |
| API 请求 | 7，全部完成 |
| 输入 / 输出 tokens | 21,941 / 840 |
| 未命中缓存高峰价的保守记账 | ¥0.050602 |
| 按返回缓存用量计算的高峰价估计 | ¥0.022757 |
| 未知计费请求 | 0 |
| 结束后授权 | `closed=true`；实测后续请求返回 HTTP 402，调用数保持 7 |

7 次调用包括 1 次服务启动探测、`concise` 和 `verbatim` 协议检查各 1 次，以及宿主中文项目的 4 次抽取。以上为根据 API 用量和已核对价格计算的记录，不是提供方最终账单。账本 SHA-256：`be1fe80f44376df3f0a8342c8221074181f6648005d9bf323379e443cb8ecf54`。

## 通过的检查

| 检查 | 实际结果 |
|---|---|
| `concise` / `verbatim` 基础协议 | 两种模式均通过固定版本、bank 配置、异步写入、同 operation 重放、来源 metadata 召回、删除后不再召回 |
| 两个基础用例的重放 | 每个 bank 的模型日志只有 1 次抽取调用；本例中同 operation 重放未再次调用模型，不外推为所有超时竞态的计费保证 |
| 真实 Git → SQLite → HindsightService → HTTP | 两份中文合成知识文档均由真实持久投影队列提交、结算为 ready；没有用伪造远端响应替代 |
| 重启本地存储 | 关闭并重新打开专用 SQLite 后，配置及 ready 投影保留 |
| 中文抽取 | 抽取到 `sem_module:售后模块`、`sem_module:仓储模块`、`sem_kind:business_rule`，以及 `sem_rule:name:*`、`sem_rule:statement:*` |
| 原文回读与范围 | 召回返回当前本地原文；伪造其他用户身份的回读被拒绝 |
| 原文版本变化 | 七天修改为九天，旧引用返回 `source_changed`，旧远端文档被清理，新召回原文包含九天 |
| 提交后撤销 | 服务端操作实测处于 `processing` 时停用；本地立即隐藏来源，等待远端完成后清理 |
| 最终清理 | 三个测试 bank 的文档、事实节点、关系、实体及 pending operations 全部为 0 |
| 预算网关 HTTP 边界 | 5 项通过：额度耗尽拒绝、关闭授权、未知结果保留预留并跨重启、账本缺失/其他模型拒绝、输出上限与保守结算 |
| 接入回归 | 6 个测试文件 / 21 项通过 |
| 工作区类型检查、跨平台检查、`git diff --check` | 通过 |

`map` 实测形成独立的字段标签路径，不是具有稳定 ID、约束和审批状态的业务规则对象；本轮未把这些抽取结果变成正式本体关系。

## 检索观察

仅有两份中文合成文档，以下是基础观察，不能当作完整评测：

| 查询 | 相关文档排名 | 宿主耗时 | 回退 |
|---|---:|---:|---|
| 退款需要什么凭证？ | 1 | 320 ms | 无 |
| 货物没有供应商批号，可以入库吗？ | 1 | 160 ms | 无 |
| What is required to return money to a customer? | 2，库存文档排在退款文档前 | 146 ms | 无 |

当前本地 embedding 为 `BAAI/bge-small-en-v1.5`，reranker 为 `cross-encoder/ms-marco-MiniLM-L-6-v2`。观察到的跨语言排序问题需要用同一份约 30 题固定语料评估，再对比多语言模型和召回过滤策略；本轮没有为让结果通过而临时替换模型、忽略错误排名或开启业务同步。

尚未覆盖：完整 30 题词法/融合检索对比、所有取消/重试竞态、提供方账单核对、完整本体推理、真实 Electron 界面的付费端到端流程。本轮验证的是实际宿主服务类和持久化路径；之前的 Electron 界面验证仍为确定性测试。

## 证据位置

- `concise` bank：`df-protocol-25d2919b-21d6-4241-8fba-cd17351d2bcf`。
- `verbatim` bank：`df-protocol-1d34e0cf-8536-493d-9fe4-e0df38503591`。
- 中文宿主 bank：`df-k-31f53d20-3498-40bc-a558-645f2ec85b6d`。
- 保留空 bank 及操作/模型日志，不保留测试文档、实体或图关系。
- 本机关闭的账本：`.tmp/hindsight-deepseek-validation/budget/ledger.json`；该目录被 Git 忽略。
- 原始运行日志：`/private/tmp/devflow-hindsight-live-5dvhupex/`；中文夹具及证据：`/var/folders/pn/2vxnd83n1hxbtqhx6szfgcp80000gn/T/devflow-hindsight-live-fixture-T0i1i9/evidence.json`。这些本机临时路径不是 CI 或长期存储保证。

本次新增测试网关、独立测试部署覆盖和真实宿主验证脚本，未修改桌面业务实现。未重复执行不相关的全量构建/E2E；此前全量结果保留在[首期开发记录](hindsight-integration-20261020.md)。
