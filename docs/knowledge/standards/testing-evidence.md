---
title: 本地测试证据规范
category: testing_standard
ownerId: u-yu
tags: test, evidence, smoke
summary: 本地测试证据必须包含命令、退出码、耗时和脱敏输出。
---

<a id="local-test-evidence-standard"></a>

# 本地测试证据规范

本地测试证据必须包含命令、退出码、耗时和脱敏输出。

- 仅保存有长度上限的 stdout 和 stderr。
- 在持久化或同步证据前，先对 API 密钥和令牌脱敏。
- 测试失败必须对审查者可见。
