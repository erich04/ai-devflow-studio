---
title: PR Review Readiness Checklist
category: review_checklist
ownerId: u-ling
tags: pr, review, gate, github-delivery
summary: PR review should bind the delivery package, exact approved commit, verified Draft, evidence, and Acceptance decision.
---

# PR Review Readiness Checklist

Pull requests should link design, Test Evidence, reviewer decisions, and rollout notes.

- Confirm the metadata-only PR Delivery Package matches the reviewed coding source.
- Confirm the Delivery Intent binds the canonical managed worktree, expected commit, repository
  binding, Run version, evidence digests, and package digest.
- Confirm the redacted Delivery Request has a separate signed Web approval for its exact revision.
- Confirm the verified remote head equals the approved expected commit and the matching pull request
  remains Draft.
- Confirm no credential, local path, raw output, patch, or source content entered durable evidence.
- Acceptance may cite the Draft pull request and completion evidence, but must never merge, close,
  force-push, delete the branch, or publish a tag.
