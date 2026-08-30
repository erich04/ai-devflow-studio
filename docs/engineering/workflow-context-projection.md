# Workflow Context Projection

DevFlow projects one canonical context contract from the selected Workflow node. The same projection
drives provider prompts, runtime capability checks, Inspector tabs, empty states, and persisted Review
manifests. A field is not shown merely because data with the same Run ID exists.

## Field states

| State | Meaning |
| --- | --- |
| `not_applicable` | This node does not own or consume the field. |
| `not_yet_expected` | A later stage will produce the field. |
| `optional` | The field may be useful, but absence is not a gap. |
| `required` | Policy or the node contract requires the field. This is the applicability value before availability is evaluated. |
| `available` | Applicable data exists in the current node scope. |
| `missing_required` | Required data is absent. UI and runtime must show an explicit gap. |

Existing earlier-than-expected data is not discarded. It is projected as `available` with a
`supplemental` or `historical` role. Empty optional or inapplicable fields are omitted from provider
prompts and Inspector Evidence.

## Default node matrix

`R` means required, `O` optional, `N/A` not applicable, and `Later` not yet expected. Availability
turns any populated field into `available`; a blocking policy may promote an optional field to `R`.

| Node | Request | Artifacts | Knowledge refs | Generation refs | Gate Review | Test Evidence | Coding result | GitHub Delivery | Acceptance Evidence |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Clarify Agent | R | O | N/A | O | N/A | N/A | Later | Later | Later |
| Clarification Gate | R | R | O | N/A | O | N/A | Later | Later | Later |
| Design Agent | R | O | N/A | O | N/A | N/A | Later | Later | Later |
| Design Gate | R | R | O | N/A | O | O, supplemental | Later | Later | Later |
| Build Task | R | O | N/A | N/A | N/A | O, supplemental | O | Later | Later |
| Test | R | O | N/A | N/A | N/A | R | O, historical | Later | Later |
| PR Delivery | R | O | N/A | N/A | N/A | R | O, historical | R | Later |
| Acceptance | R | R | O | N/A | O | R | O, historical | O, historical | R |

Knowledge Review can execute only on Gate and Acceptance nodes. Clarification and Design Agents
generate workflow Artifacts; they do not expose a Gate Review action or Gate Review history.

## Knowledge relevance and Evidence

Knowledge retrieval has three independent meanings:

| Field | Meaning | May satisfy a Gate by itself? |
| --- | --- | --- |
| `lexicalMatch` | Raw additive keyword match. It has no fixed maximum and cannot be compared across queries. | No |
| `semanticRelevance` | Provider/model-defined semantic relevance. It exists only when a semantic retriever actually ran. | No |
| `gateEvidence` | How a completed Review used the reference: candidate, reviewed, supports a finding, or rejected. | No; the auditable Review/finding is Evidence. |

Legacy `score` remains readable. A lexical legacy score becomes only a legacy lexical match; a
vector legacy score becomes only legacy semantic relevance. No legacy score is promoted to Gate
Evidence.

## Inspector contract

- **引用来源** shows Knowledge/Policy provenance: document, chunk, repository-relative path,
  heading, content hash, retrieval strategy, lexical match, semantic relevance, and Review-use state.
- **Evidence** shows auditable results: exact subject Artifact ID/revision/digest/coverage, Review and
  policy findings, stage-applicable Test Evidence, diff, or delivery/acceptance records.
- A Knowledge reference is never rendered in both sections as if it were Evidence.
- Deep links preserve the selected Gate and return to the source tab. Empty states distinguish
  inapplicable, optional, and missing-required fields.

## Boundary and compatibility

`projectWorkflowContext` is the canonical helper. `projectKnowledgeReferencesForNode` prevents
wrong-node, wrong-Artifact, wrong-Evidence, and cross-stage references from leaking into the selected
node. New Review manifests persist the projection and typed retrieval fields. Older records without
them remain readable, but the UI labels their unavailable semantics instead of inventing them.

All provider-bound and remote-summary metadata passes the existing redaction boundary. Remote
summaries retain only redacted identities, digests, revisions, states, and bounded explanations;
they do not contain subject content, prompts, secrets, local absolute paths, or raw test output.
