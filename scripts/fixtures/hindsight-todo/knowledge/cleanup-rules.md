---
title: 批量清理已完成任务规则
category: development_standard
stages: [clarify, design, build, test, pr, accept]
tags: todo, cleanup, clear, 清理, 已完成
summary: 删除全部已完成项，精确保留未完成项并返回实际删除数量。
---

# 批量清理已完成任务规则

本文件是 Hindsight 验证的合成需求规范；基线应用尚未实现此功能。

模块：任务清理。规则名称：只清理已完成项。

用户执行“清除已完成”时，删除当前任务数组中所有 done 为 true 的项。任何 done 为 false 的项必须保留。不要根据 text、createdAt 或数组位置推断完成状态。

未完成任务的 id、text、done、createdAt 与相对顺序必须保持不变；不得重建任务或按文字去重。操作返回实际删除数量，无可清理项时数量为 0，数据不变。

清理后的持久化必须遵守《本地存储兼容规范》；按钮状态和反馈遵守《清理交互与反馈规范》。需求、设计、编码和评审都需要分别核对这些约束。本文不代表任何 Gate 已批准。
