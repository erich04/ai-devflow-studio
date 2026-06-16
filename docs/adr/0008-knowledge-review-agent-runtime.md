# ADR 0008: Knowledge Review Agent Runtime

## Status

Accepted

## Context

DevFlow v0.4 introduced Knowledge Retrieval and Knowledge Governance checks, but the system still
needed a real Agent runtime slice. The v0.5 milestone adds one focused Agent: Knowledge Review
Agent. It reviews a selected Run/Node using redacted workflow context, retrieval results, artifacts,
and test evidence, then produces a durable review artifact, trace, advisory, and token/cost usage.

The product must work in both places DevFlow runs today:

- Electron desktop, where local SQLite owns private local execution state.
- API/Web, where Postgres owns team-visible state.

## Decision

DevFlow will implement Knowledge Review Agent with a shared Agent Core and provider abstraction.
The same core is used by Electron and API paths.

The default provider for automated verification is deterministic and cost-free. OpenAI-compatible
providers are supported only when a credential is explicitly configured.

Provider credentials are never returned to UI clients in plaintext:

- Electron stores encrypted provider secrets behind the desktop main-process boundary and returns
  only masked metadata through preload.
- API stores encrypted provider secrets in Postgres and returns only masked metadata.

Agent output is persisted as:

- `AgentReviewResult`
- `AgentTrace`
- `AgentTokenUsage`
- `agent_review` Artifact
- `agent_review` Agent Event

Gate Advisory is warning-only by default. It helps reviewers see risk and missing evidence, but it
does not block human Gate approval in v0.5.

Electron local reviews are stored fully in SQLite. When a team API is available, Electron uploads
only a redacted `RemoteAgentReviewSummary`; it does not upload prompt text, raw trace payloads,
local cwd, raw stdout/stderr, or provider secrets.

## Consequences

- Electron and API do not fork Agent semantics.
- Tests and CI remain deterministic because they use the fake provider by default.
- Future provider integrations can implement the provider abstraction without rewriting Inspector,
  Agent Workbench, or governance rendering.
- Future enforcement can change Gate policy from warning-only to configurable blocking without
  changing review persistence.
- The first Agent is intentionally narrow; coding Agents, multi-Agent handoff, real MCP execution,
  repository edits, vector RAG, and auto-fix flows remain out of scope.
