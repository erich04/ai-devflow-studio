# ADR 0008: Knowledge Review Agent Runtime

## Status

Accepted

## Context

DevFlow v0.4 introduced Knowledge Retrieval and Knowledge Governance checks, but the system still
needed a real Agent runtime slice. The v0.5 milestone adds one focused Agent: Knowledge Review
Agent. It reviews a selected Run/Node using a redacted review subject, Knowledge criteria, and test
evidence, then produces a durable review artifact, trace, advisory, and token/cost usage.

The product must work in both places DevFlow runs today:

- Electron desktop, where local SQLite owns private local execution state.
- API/Web, where Postgres owns team-visible state.

## Decision

DevFlow will implement Knowledge Review Agent with a shared Agent Core and provider abstraction.
The same core is used by Electron and API paths.

The review context has three explicit partitions:

- `REVIEW_SUBJECT` is the material being judged. It contains the original Run request and the
  complete, exact Artifact content associated with the current Gate. A clarification Gate reviews
  its clarification Artifact. A design Gate reviews both the approved clarification Artifact and
  its design Artifact. Knowledge summaries never replace these Artifacts.
- `REVIEW_CRITERIA` is the material used to judge the subject. It contains Gate metadata, policy
  constraints, and retrieved Knowledge. Knowledge is grounding only; it is never the review
  subject.
- `REVIEW_OUTPUT` defines the structured findings the provider must return. Design review includes
  requirement coverage, technical decisions, boundaries/data flow, compatibility, security,
  migration, test strategy, and unresolved changes.

The prompt also carries `CONTEXT_APPLICABILITY`, a workflow-aware projection of which fields are
applicable, available, supplemental, not yet expected, or missing-required for the selected node.
Empty optional/inapplicable Test Evidence is omitted rather than presented as a false gap. A policy
can promote a field to required, in which case absence is explicit and fail-closed enforcement can
act on it. Deterministic fake and paid providers consume this same contract.

Knowledge criteria preserve independent `lexicalMatch`, `semanticRelevance`, and Review-use
(`gateEvidence`) metadata. A lexical score never becomes semantic relevance, and no retrieval score
becomes Evidence. The Inspector therefore separates Knowledge/Policy `引用来源` from auditable
`Evidence` such as exact subject Artifacts, Reviews/findings, and applicable Test Evidence.

The shared core resolves every subject Artifact by exact ID and verifies its Run and producer/Gate
association. Missing, duplicate, wrong-Run, wrong-node, stale, empty, or oversized subject material
fails closed instead of silently reviewing a summary or a different Artifact. Content is redacted
before provider invocation, bounded deterministically, and split into ordered chunks without
dropping content inside the supported limit. Budget preflight is calculated from this exact prompt.

Every new review stores a context manifest containing the stage, original-request digest, exact
subject Artifact ID, revision timestamp, content digest, sanitizer version, coverage state, and
Knowledge-criteria identities/digests, typed relevance/use state, and field projection. Gate
enforcement revalidates this manifest and excludes a
review when its subject has changed. Historical reviews without a manifest remain readable as
legacy data, but their subject freshness cannot be proven.

The default provider for automated verification is deterministic and cost-free. It consumes the
same context contract as OpenAI-compatible providers so tests cannot bypass subject selection,
redaction, bounds, or budget checks. OpenAI-compatible providers are supported only when a
credential is explicitly configured.

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
only a redacted `RemoteAgentReviewSummary`; it does not upload subject content, prompt text, raw
trace payloads, local cwd, raw stdout/stderr, or provider secrets. The summary may include the
redacted context-manifest identities and digests needed to explain which subject revision was
reviewed.

## Consequences

- Electron and API do not fork Agent semantics.
- Gate approval can distinguish a current review from a review of an older Artifact revision.
- Tests and CI remain deterministic because they use the fake provider by default.
- Future provider integrations can implement the provider abstraction without rewriting Inspector,
  Agent Workbench, or governance rendering.
- Future enforcement can change Gate policy from warning-only to configurable blocking without
  changing review persistence.
- The first Agent is intentionally narrow; multi-Agent handoff, real MCP execution, vector RAG, and
  auto-fix flows remain out of scope.
- ADR 0009 updates the coding-agent boundary: DevFlow still does not build its own coding agent, but
  v0.6 can host an external opencode engine through a managed adapter.
