---
title: Todo 任务领域与身份
category: onboarding
stages: [clarify, design, build, test, pr, accept]
tags: todo, task, identity, 任务, 完成
summary: 任务身份与完成判据，明确创建时间不是完成时间。
---

# Todo 任务领域与身份

本文件是 Hindsight 验证的合成知识，不是已有功能完成证明。

模块：任务领域。规则名称：任务身份与完成判据。

任务对象包含 id、text、done、createdAt。id 是任务身份；done 为 true 表示已完成，false 表示未完成。createdAt 是创建时间，不是完成时间，不能据此判断任务已完成多久。

当前任务清单只有一份本地数组，没有账户、多个列表、完成时间、云同步或归档功能。本轮新增批量清理，不新增这些能力，也不要求等待若干天再清理。

“未完成任务”“待办项”和“待处理事项”在本项目中指 done 为 false 的任务。清理后幸存任务仍代表同一个对象，不能重新分配 id。
