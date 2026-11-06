# Native Coding v3 harness 评审资料（2026-11）

2026-11-01 对 Native Coding v3 harness 的只读评审，以及评审用到的调研报告；评审没有运行测试、应用或模型。用户据此批准的执行计划见[路线图](../../plans/native-coding-harness-roadmap.zh-CN.md)。这些文件是当时的快照：v3 的事实对应提交 `1108087`，外部项目对应各报告记录的版本和提交，之后的变化不回写到这里。

## 文件

| 文件 | 简称 | 内容 |
| --- | --- | --- |
| [review.md](review.md) | — | 评审正文：33 个方面的评分（0–4 分，平均 2.06）、强项、任务管理与权限控制的现状和目标设计、15 条改进计划、路线图、面试讲法、分歧与未核实项。 |
| [internal-v3.md](internal-v3.md) | iv | v3 自身的事实审计：架构、自写与复用的代码、逐项现状、工具清单、限额与默认值、模型与 Provider、评测数据、已知问题。 |
| [claude-code.md](claude-code.md) | cc | Claude Code：learn.shareai.run 教程的 20 个方面加 13 个补充方面，依据教程的源码分析、官方文档和 Anthropic 工程博客。 |
| [opencode-pi.md](opencode-pi.md) | op | OpenCode 1.18.15、2.2.5 与 Pi 1.4.0 的源码调研。 |
| [codex-others.md](codex-others.md) | cx | Codex rust-v0.166.0、Gemini CLI、Kimi 的源码调研，以及 DeepSeek 官方 harness 和 API 对 harness 的要求。 |
| [deepseek-harness.md](deepseek-harness.md) | ds | DeepSeek Harness（dsh）`dsh-v0.2.2-alpha.2` 的源码调研，附 Qwen Code、Trae Agent、DeerFlow。 |
| [aider-openhands-more.md](aider-openhands-more.md) | oh | Aider、OpenHands SDK、SWE-agent 与 mini-SWE-agent、Cline v4、Goose 的源码调研，附 Crush、Letta Code。 |
| [mechanics.md](mechanics.md) | ma | 多 Agent 编排机制：lead 如何计划、委派、并行、检查和调整（2026-10 下旬的多 Agent 调研）。 |
| [devflow-assets.md](devflow-assets.md) | da | DevFlow 做多 Agent 编排器时已有的积木与阻碍（2026-10-30）。 |

## 引用记法

review.md 用 `[简称:编号]` 引用报告，编号沿用各报告自己的来源编号。例如 `[cc:D3]` 是 claude-code.md 的来源 D3，`[ma:S100]` 是 mechanics.md 的来源 S100；只写简称（如 `[da]`）时指整份报告。简称见上表。

## 入库说明

- 调研时，评审和 6 份报告放在 Git 忽略的 `.tmp/research/harness-review/`，mechanics.md 和 devflow-assets.md 放在 `.tmp/research/multi-agent/`。文中出现的这两个位置，以及 `multi-agent/`、`../multi-agent/`，入库后都对应本目录。
- 报告提到的 `landscape.md`、`current-devflow.md` 是更早的多 Agent 调研，没有入库。mechanics.md 的来源列表自带完整链接，不依赖它们；原文指向 landscape.md 的链接改成了纯文本。
- 入库前删去了本机环境细节：参考项目的本地克隆位置、本机工作树名，以及 deepseek-harness.md 里描述本机 DeepSeek Harness 安装的一节（profile、Docker 容器和数据卷、挂载的密钥文件）。原处写“本机环境细节未入库”，或改成简短描述。结论和数字没有改动。
