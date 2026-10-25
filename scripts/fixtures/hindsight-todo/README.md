# Hindsight Todo 验证语料与基线

这是一份可以反复创建的隔离测试项目，不使用原 Electron 用户数据库或实际任务数据。

`baseline/` 是原 Todo 仓库 `erich04/devflow-blank-mini-agent-20260911` 在提交
`c2be68d6c4a03fc219c483acc79a90fdf6e11ab6` 的 11 个 tracked 文件原始字节。
来源树及逐文件 SHA-256 见 `source.json`。导出来自已确认的本地仓库，通过
`git show <commit>:<path>` 获取，不是复制可能已修改的工作区。没有复制 `.git`、
凭据、用户数据或历史模型输出。

基线有新增、勾选、单条删除、localStorage 持久化，**尚未实现清除已完成**。
`acceptance.json` 定义待开发目标与验收期待，不能把测试执行器预置的实现算作 Agent 编码成果。
基线 README 的历史环境要求保持原样，运行本仓库验证仍使用 Node.js 24。

`knowledge/` 含六篇合成知识和声明式抽取模型。夹具导出时仅这七份文件进入
`docs/knowledge/`；原应用文件保持原字节。知识文档声明各阶段适用，既有 L1
本地阶段上下文仍然有效，所以“最终功能实现正确”本身不能证明 Hindsight 有增益。
Hindsight 的独立检索测量与每个阶段的来源回执应另行保留。

`questions.json` 的 30 题包含中文直接/同义 10 题、跨文档 6 题、英文 4 题、
无答案 4 题、版本变化 3 题、范围边界 3 题。它与 `acceptance.json` 保留在执行器侧，
不导出到测试工程，不发送给 Hindsight 或开发 Agent。`expectedAnswerTerms` 仅供另外的
回答评审，纯检索评分不评估答案，也不能用字符串出现代替实际业务验收。

## 导出 API

`createHindsightTodoFixture(destination)` 只接受不存在的目录，父目录应已存在。
它创建独立 Git 仓库并提交基线和知识；返回：

- `repositoryPath`、`sourceCommit`、`selectedPaths`、`modelPath`；
- 可直接交给 Agent 的 `request`；
- 仅供执行器评分的 `corpus` 和 `acceptance`。

也可使用 `loadHindsightTodoEvaluation()` 单独读取评分资料。
此过程不启动应用、Hindsight 或模型，不接触原 Todo checkout。

## 阶段与问题执行条件

同一次比较必须使用相同文档、问题和启用范围。阶段有明确前置条件：

| phase | 前置条件 |
|---|---|
| baseline | 六篇文档选中、当前版本已可用 |
| rule-revised | 将交互规范的 `ui-v1` 改为 `ui-v2`、`已清除 N 项` 改为 `已移除 N 项`，刷新投影并等待当前版本就绪 |
| unselected | 取消选择全部六篇文档后再查，选中来源为空；这不是普通本地知识目录的 list/read 测试 |
| revoked | 停用 Hindsight 后再查选中投影路径；普通本地知识访问可以继续存在 |
| wrong-project | 对没有该语料授权的独立项目查同一问题，不能伪造有效作用域 |

版本变化题必须传入新文档的实际 digest；仅命中同一个路径不能算版本验证成功。
另外检查旧来源句柄回读失败，纯排名评分不替代这项生命周期验证。
没有执行某 phase 就保留 missing，不能填空数组伪装成功。

## 评分与三类基线

`scoreHindsightTodoRetrieval` 只评分调用者提供的实际结果，不发 HTTP，也不生成结果。

- `local-lexical`：同授权语料的本地词法排名。
- `hindsight-hybrid`：同授权语料的实际混合排名；受控假服务与真实服务应由执行报告明确区分。
- 原有 `list/read + repo_search` 调查：需要独立的模型工具调用与回答证据，纯评分器始终标为未评估，不能用词法排名冒充。

Top1 与 Top5 分开；跨文档题同时统计所有预期来源是否齐全以及来源级 Recall@5。
同来源重复结果不增加分数，错误的第一个结果不会被隐藏或提升第二名。无答案题中的
任何候选被计为检索误召回，不代表回答模型必然产生错误答案。缺失记录或请求失败不算
正确拒答；零样本指标为 `null`。`complete` 只表示选定题目均有成功请求记录，不表示质量验收通过。

通过 `allowedSourcesByPhase` 传入当前获准路径和实际 SHA-256 时，过期摘要、缺失摘要和
未授权路径不计为命中，仍保留原排名并单独报告。没有传入时明确标记当前性未核验。
延迟采用包含已记录失败请求的 nearest-rank p50/p95；没有用量账单输入，不声称费用已测量。

完整测试还需真实阶段输入、Native/OpenCode 编码、实际 npm test、浏览器业务验收，以及
独立的模型费用与数据清理记录。此资产自身不能证明这些都已执行。
