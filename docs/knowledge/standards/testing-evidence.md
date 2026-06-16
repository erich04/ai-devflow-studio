---
title: Local Test Evidence Standard
category: testing_standard
ownerId: u-yu
tags: test, evidence, smoke
summary: Local test evidence needs command, exit code, duration, and redacted output.
---

# Local Test Evidence Standard

Local test evidence needs command, exit code, duration, and redacted output.

- Store only bounded stdout and stderr.
- Redact API keys and tokens before evidence is persisted or synchronized.
- Failed tests must remain visible to reviewers.
