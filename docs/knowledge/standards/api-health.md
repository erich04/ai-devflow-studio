---
title: API Health Endpoint Standard
category: api_contract
ownerId: u-ling
tags: api, health, degraded
summary: Health endpoints must expose ok, degraded, and down states with explicit status mapping.
---

# API Health Endpoint Standard

Health endpoints must expose ok, degraded, and down states with explicit status mapping.

- Route handlers compose service results; services own dependency checks.
- Degraded dependencies must remain observable in test evidence.
- Runtime, database, and cache checks must be safe to call during deploy smoke.
