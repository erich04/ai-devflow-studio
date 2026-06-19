---
title: Postgres Smoke Readiness Checklist
category: review_checklist
ownerId: u-erich
tags: postgres, api, smoke, policy
summary: Postgres smoke should run against an explicit clean database and cover migration, policy, override, sync, and redacted overview behavior.
---

# Postgres Smoke Readiness Checklist

Use this checklist when API, repository, migration, policy, override, sync, or manager summary code
changes.

- Set `DEVFLOW_DATABASE_URL` explicitly before running Postgres smoke.
- Prefer a disposable clean database for release-style signoff.
- Run the migration/setup path before smoke if the database is new.
- Verify seeded team data can be read through the API repository boundary.
- Verify policy save/read and enforcement evaluation behavior.
- Verify override rejection for owner, member, and conflicted lead cases.
- Verify accepted lead override audit behavior.
- Verify stale policy version rejection.
- Verify approval-like sync summaries are rejected as a Gate enforcement bypass.
- Verify overview responses remain redacted and do not expose local paths, raw logs, prompts, patches, or secrets.
- Remember that `corepack pnpm verify` intentionally excludes Postgres smoke.
