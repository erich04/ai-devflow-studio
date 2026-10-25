---
title: 本地存储兼容规范
category: development_standard
stages: [clarify, design, build, test, pr, accept]
tags: todo, localStorage, persistence, 存储, 刷新
summary: 保留 tasklist.tasks.v1 和数组格式，清理立即持久化且支持存储异常退化。
---

# 本地存储兼容规范

本文件是依据基线行为整理的合成验证知识。

模块：本地存储。规则名称：原存储格式兼容。

任务保存在 localStorage 的 tasklist.tasks.v1 键下，值为任务 JSON 数组。数组顺序就是任务创建顺序。批量清理沿用该键与格式，不迁移、不新增存储键。

成功清理应立即持久化，刷新或重新创建 store 后已删除任务不能复活。幸存任务的 id、text、done、createdAt 和相对顺序与清理前一致。

存储读取或写入抛异常时，保持内存中的操作可用，不能导致页面崩溃。存储不可用时不能承诺刷新后保留；页面应沿用现有无法保存数据的提示。非法 JSON 或非数组已有容错行为应继续成立。
