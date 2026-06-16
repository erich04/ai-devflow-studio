# ADR 0007: Knowledge Retrieval Is Not Governance Evidence

## Status

Accepted

## Context

DevFlow Studio links workflow activity to team knowledge so reviewers and agents can see which
standards, ADRs, and checklists may apply to a Run. The first v0.4 implementation used deterministic
matching for demo-friendly Knowledge References. Future versions may add lexical, vector, hybrid, or
RAG-based retrieval.

If retrieval hits directly changed governance status, a high-scoring search result could make a Gate
look satisfied without a durable Artifact, Test Evidence record, or human decision. That would make
the governance layer harder to audit and harder to explain to teams.

## Decision

Treat Knowledge Retrieval as a recommendation layer. Retrieval can create or explain Knowledge
References, including source chunks, scores, strategies, and content hashes.

Knowledge Governance Checks must still be driven by auditable workflow evidence:

- Artifacts can satisfy standards when they are linked to the selected node.
- Test Evidence can satisfy or violate testing standards.
- Gate decisions can require evidence and record human review context.
- Run-level retrieval citations provide context but do not satisfy or violate standards by
  themselves.

## Consequences

- Future RAG implementations can improve recall and explanation without rewriting the governance UI.
- Reviewers can inspect retrieval provenance while still asking for concrete evidence.
- The product avoids treating model or search confidence as proof of compliance.
- Enforcement work in v0.5 can reuse Knowledge Governance Checks without depending on a specific
  retrieval provider.
