# ADR 0017: Evaluated Hybrid Retrieval And Citation Authority

Status: Accepted

Date: 2026-08-13

## Context

DevFlow already indexes reviewable repository Markdown into versioned Knowledge Documents and
Knowledge Chunks, retrieves deterministic lexical hits, and attaches Knowledge References to Runs.
ADR 0007 makes retrieval advisory: a high-scoring result is not Governance Evidence. V2.1 must
improve recall and explanation without turning an embedding provider, vector store, reranker, or
model-generated citation into a new authority.

Repository source and full chunk text remain inside the Electron-main/local-project boundary. Team
state may receive only allowlisted, redacted retrieval metrics and citation metadata. A provider call
that transmits chunk text is a distinct, explicit, bounded authority decision and is never part of
default verification.

## Decision

DevFlow will expose one versioned `KnowledgeRetriever` result contract for lexical, vector, hybrid,
and reranked retrieval. A hybrid retrieval run binds the exact query scope, Knowledge snapshot hash,
chunk content hashes, embedding model identity/version, ranking contract version, and deterministic
tie-break order. Missing, stale, cross-scope, malformed, non-finite, or dimension-mismatched inputs
fail closed.

Lexical retrieval remains the stable no-cost baseline. Vector candidates may increase recall; a
reranker may rerank only candidates already admitted by the exact scoped retrieval set. Neither
operation may widen organization, project, Local Project, category, tag, or caller scope. The
contract requires that scope and lifecycle filtering happens before embedding, ranking, reranking, or provider use.

### Citation Contract

A Knowledge Citation identifies the exact document, chunk, source-relative path, heading path,
content hash, snapshot hash, retrieval strategy chain, and bounded rank/score provenance used by an
answer or Agent observation. A citation is valid only while the referenced chunk hash exists in the
bound snapshot. Stale, deleted, inaccessible, fabricated, or cross-tenant citations are rejected.

Citation presence does not establish faithfulness. Evaluation separately checks that a bounded
claim is supported by the cited chunk. Knowledge Citations and retrieval hits remain Context; they
do not satisfy a Knowledge Governance Check, approve a Gate, advance Workflow, or become Test
Evidence without the existing authoritative evidence path.

### Evaluation Contract

The versioned V2.1 corpus records synthetic/reviewable documents, exact tenant/project scope,
queries, relevant and forbidden chunk identities, expected citation behavior, and Memory preconditions.
Default evaluation is deterministic and no-cost. It reports at least Recall@K, nDCG@K, mean
reciprocal rank, citation precision, citation faithfulness, latency, and isolation violations for the
lexical baseline and hybrid candidate.

V2.1 may pass only when the frozen hybrid candidate improves the declared aggregate retrieval
threshold over the lexical baseline, does not regress citation precision or faithfulness below the
contract floor, and records zero forbidden-scope hits. A changed corpus, provider/model identity,
ranking contract, threshold, or metric implementation creates a new corpus/contract version; it
cannot rewrite prior evidence.

### Provider And Storage Boundary

Default CI uses deterministic fixture embeddings and reranking. Real embedding or reranking calls
are opt-in, separately budgeted, single-corpus, secret-safe, and evidenced outside default CI. No
renderer request supplies a provider credential, endpoint, raw source path, or unrestricted text.

This ADR does not select a vector database. The first implementation may use a bounded local index
behind a narrow repository interface. Storage choice cannot change citation identity, scope checks,
evaluation, deletion, or authority semantics.

## Consequences

- Existing lexical retrieval stays available as the comparison and fail-safe path.
- Retrieval and citation need versioned shared contracts before persistence or UI work.
- Index refresh and source deletion must invalidate stale chunk/vector entries atomically enough to
  prevent them from being returned as current.
- Team-visible projections can explain quality and provenance without receiving repository content.

## Rejected Alternatives

- **Treat top vector similarity as correctness.** Similarity is neither citation faithfulness nor
  Governance Evidence.
- **Let reranking search outside the admitted candidate set.** That would bypass scope and retrieval
  audit.
- **Upload the whole repository knowledge index by default.** That violates the local source
  boundary and no-cost deterministic verification.
- **Choose a vector database before freezing behavior.** Storage is replaceable; scope, provenance,
  deletion, and evaluation are the product contract.
