---
title: Postgres Smoke Readiness Checklist
category: review_checklist
ownerId: u-erich
tags: postgres, api, smoke, policy, github-delivery
summary: Postgres smoke should prove Team schema v16, retained migration, governed GitHub Delivery, Agent Runtime projection, policy, sync, and redaction.
---

# Postgres Smoke Readiness Checklist

Use this checklist when API, repository, migration, policy, override, sync, GitHub Delivery, or
manager-summary code changes.

- Set `DEVFLOW_DATABASE_URL` explicitly before running Postgres smoke.
- Prove a disposable fresh database reaches Team schema v16.
- Prove a populated v11-to-v12 migration retains exact repository binding, Delivery Request,
  approval, publication, recovery, and audit data.
- Prove a failed v11-to-v12 migration rolls back transactionally and succeeds once on explicit
  retry without duplicating rows.
- Prove a populated v12-to-v13 migration leaves each legacy issued credential at contract version
  `0`, with `provider_credential_expires_at` and `provider_expiry_observed_at` NULL, and therefore
  fail closed instead of fabricating provider-authoritative expiry confirmation.
- Prove v13-to-v14 adds only a nullable bounded Draft PR provider retry not-before.
- Prove v14-to-v15 adds nullable `source_publication_id`, retains every legacy grant-backed
  publication exactly, and rejects rows that have neither or both publication authorities.
- Prove v15-to-v16 creates empty `agent_runtime_summaries` and
  `agent_runtime_projection_audits` tables, retains all prior rows, and rejects non-redacted,
  incoherent-version, or invalid terminal Runtime summaries.
- Verify seeded team data can be read through the API repository boundary.
- Verify policy save/read and enforcement evaluation behavior.
- Verify override rejection for owner, member, and conflicted lead cases.
- Verify accepted lead override audit behavior.
- Verify stale policy version rejection.
- Verify approval-like sync summaries are rejected as a Gate enforcement bypass.
- Verify an owner can configure and revoke one verified GitHub App repository binding, while a member
  or mismatched Project cannot.
- Verify one redacted Delivery Request preserves series/attempt/revision identity and rejects local
  paths, raw output, patches, source content, and credentials.
- Verify a signed Web approval by a lead or owner is bound to the exact request revision; paired
  Desktop Bearer authority cannot approve its own request.
- Verify credential grant preconditions, expiry, scope, claimant, and binding version. The GitHub App
  private key and issued token must never become durable Postgres evidence.
- Verify the API independently confirms the expected commit as remote head before it creates or
  reconciles one Draft pull request.
- Verify an approved later attempt may use verified publication adoption only from the immediately
  prior same-series terminal Draft failure, with zero additional credential issuance or push.
- Verify revocation blocks a new credential grant and that replay/restart paths do not duplicate the
  request, publication, Draft pull request, or audit result.
- Verify overview and Delivery Request responses remain redacted and do not expose local paths, raw
  logs, prompts, patches, source content, private keys, or tokens.
- Run `DEVFLOW_DATABASE_URL=postgres://... corepack pnpm test:postgres-smoke` and retain its exact
  candidate-bound result.
- Remember that `corepack pnpm verify` intentionally excludes Postgres smoke.
- This checklist does not authorize paid-provider smoke; Postgres and GitHub Delivery persistence
  verification requires no model-provider request.
