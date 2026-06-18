# ADR 0010: Configurable Gate Enforcement Policy

## Status

Accepted

## Context

ADR 0008 made Gate Advisory warning-only for v0.5 so the first Agent runtime could assist human
reviewers without taking over approval. v0.7 adds a governance layer that can make selected checks
blocking, while preserving the default human-controlled approval path unless a team explicitly opts
in to enforcement.

The enforcement model must avoid the failure modes identified during planning:

- A team project must not become less strict by going offline.
- A project override must not weaken an organization floor.
- A probabilistic Agent finding must never become a hard-block with no human recourse.
- A disabled renderer button is not sufficient; approval write paths must re-check policy.

## Decision

DevFlow will model Gate Enforcement Policy in the shared package and use the same resolver and
evaluator in API, Web, and Electron.

Out-of-box policy is warn-only. Blocking is enabled only by applying the recommended preset or by
custom organization policy. The recommended preset blocks deterministic missing-review, testing
standard, and API-contract failures; Agent policy findings remain warnings unless explicitly
configured otherwise.

Policy resolution uses an ordered action model:

```text
ignore < warn < block
effective = max(organization floor, project desired action)
```

Organization policy is the only source of `floorAction` and `overridable`. Project overrides can
strengthen a rule but cannot weaken a floored organization rule or define hard-block behavior.

Hard-block is allowed only for deterministic enforcement targets and requires remediation text.
`agent_finding + overridable:false` is invalid because Agent findings are probabilistic.

Gate approval is governed by `canApproveGateNow(...)`, which combines the existing role gate with
the enforcement decision and any valid override. Electron main-process approval and API approval
paths must call this shared function. Renderer state is only a mirror.

Overrides for blocking decisions are lead-only and require separation of duties: the lead cannot be
the Run creator or the selected Node owner. Hard-blocks cannot be overridden.

Team policy source of truth is API/Postgres. Desktop caches authoritative policy snapshots and must
use the last cached policy when offline. A team project with no cached policy returns
`blocked_policy_unavailable` for Gate approval. Pure local projects use the built-in warn-only
policy.

## Consequences

- ADR 0008 remains true for v0.5, but from v0.7 onward Gate Advisory can contribute to a blocking
  decision through policy evaluation. The default remains warn-only.
- Web/API owns policy authoring; Desktop consumes, caches, evaluates, and records local/provisional
  decisions.
- Default verification stays deterministic because the default and recommended preset do not make
  Agent findings blocking.
- Future policy signatures, KMS-backed integrity, automatic remediation, MCP policy enforcement,
  and coding retry loops remain out of scope.
