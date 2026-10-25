---
title: Todo 工程边界与输入规范
category: development_standard
stages: [clarify, design, build, test, pr, accept]
tags: todo, javascript, dependency, unicode, 工程, 输入
summary: 使用现有原生 JavaScript 和零依赖测试，保留 Unicode 码点输入限制。
---

# Todo 工程边界与输入规范

本文件是依据基线实现整理的合成验证知识。

模块：应用工程。规则名称：零依赖与输入兼容。

应用采用原生 HTML、CSS 和 JavaScript。任务逻辑位于 src/store.js，界面位于 src/dom.js，由 src/app.js 连接。新增清理能力保持这些职责，不引入框架或运行、测试依赖。

输入先 trim，再按 Unicode 码点计数；上限为 200 个字符。200 个允许，201 个拒绝，单个 emoji 计一个码点。全空白输入不得新建任务。

npm test 运行 Node 内置测试，npm start 启动本地静态页面；无第三方依赖，因此不需要安装包。更新 README，说明新增能力及测试方法。不要把“测试命令存在”写成“测试已经通过”。
