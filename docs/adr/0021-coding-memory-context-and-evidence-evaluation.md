# ADR 0021: Coding Memory, Bounded Context and Real Evidence Evaluation

Status: Accepted

Date: 2026-09-16

## Context

Memory lifecycle and independent Runtime attachments already existed, but Native Coding and
OpenCode briefs did not include the recalled statements. Native v2 sliced the brief at different
character limits. Independent Runtime always sent a matching fixture to `scenario.evaluate`;
success described that fixture, even when the selected task had no artifacts or tests.

## Decision

Electron main recalls Memory before reserving a Coding Run. Existing LocalStore visibility,
project/user/session scope, expiry, revision and tombstone rules remain authoritative. A bounded
lexical ranking selects at most eight complete statements within 4,000 UTF-8 bytes including
label allowance. Ineligible records never enter the ranking; oversized or lower-ranked records
are counted as omitted. Candidate observations still require explicit promotion.

The common Coding Brief includes those statements as low-trust background. They cannot grant
permissions, override the current request, satisfy a Gate, or become test evidence. This one brief
feeds Native v1, Native v2 and OpenCode. Coding `contextDigest` retains its existing meaning,
SHA-256 of the exact brief; it is not replaced with the separate Runtime attachment digest.

A local `CodingContextReceipt` binds the prepared brief to Run/Node version, actor/pairing scope
and selected Memory revision/head/content digests. The runtime rechecks this before Provider
calls, managed tool actions, approvals and saved tests. Native v2 also checks after a Provider
response. A changed/deleted/expired source stops continuation; usage already incurred is retained
as a successful Provider settlement, rather than misclassified as a Provider error. A new attempt
must recall current sources. Recovery retains the frozen brief and existing no-replay contracts.

The brief has a conservative 12,000 UTF-8 byte budget. Current request/instruction, Memory,
remediation and the bounded latest test diagnostic are indivisible. Historical sources compact
to their existing summaries plus recognizable explicit constraint lines. Sources keep stable
identities, priority and representation/size receipts. If protected content alone is too large,
preparation fails before a paid call. No LLM is used to invent a summary.

The runtime fixture is replaced by the read-only `workflow.evaluate` tool. Electron main supplies
an evidence digest computed from the current Run, stage artifacts, real Coding Run, sanitized
diff, saved test command and actual Test Evidence. The handler rereads the sources before use.
Missing evidence, failed latest tests, fake Coding Runs, wrong provenance and stale fingerprints
cannot pass. A recovered successful tool invocation is not treated as a successful evaluation:
the logical result is checked separately. Real Coding completion automatically records the same
evidence check in its event trace. These checks do not grant business acceptance or publication.

Offline scenario/retrieval/multi-agent fixtures remain reproducible regression baselines. They
are explicitly separate from current-task evaluation.

## Privacy and compatibility

- Full prompts and selected Memory remain local execution data. Team Coding summaries exclude
  the receipt and prompt; inbound remote summaries reject local-only receipt fields.
- Deletion excludes future recall and invalidates attached continuation. Historical local audit
  records retain the prior execution, following the existing Memory lifecycle contract.
- No new storage service, vector database, credential store, API endpoint or schema migration.
- Old Coding Runs without receipts remain readable and retain their recovery behavior.
- Existing permissions, Change Acceptance, Workflow Gates and delivery authorization remain
  authoritative. The existing advanced Runtime controls keep their interaction; explanatory copy
  now describes actual evidence checks.

## Limits

This slice connects the Coding executors. Stage Agents and specialist/multi-agent Memory
delegation are not expanded. The compactor summarizes historical brief sources; it does not
claim a semantic long-conversation summarizer or a tokenizer-specific whole-request limit.
Native v2 repository excerpts retain their separate existing bounded-input rules.
OpenCode is an external executor: DevFlow fences session creation, message submission, polling
and permission relay, and aborts on detected staleness; it cannot intercept each internal
OpenCode model call or retract a prompt already sent to a Provider.
Memory relevance uses lexical overlap and recency, not embeddings. Evidence evaluation checks
provenance/completeness and real test results; it cannot establish arbitrary business correctness
without appropriate acceptance tests and human review.
