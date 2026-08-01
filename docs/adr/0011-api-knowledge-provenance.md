# ADR 0011: API Knowledge Provenance

## Status

Accepted

## Context

V1.4 adds a bounded Electron main-process index of Git-managed repository Markdown. That content is
private local repository data. API Review runs on the server and does not have an independently
authorized checkout of the Desktop repository. Treating API Review as if it had used the local
knowledge snapshot would create false provenance; implicitly uploading the raw Markdown would break
the Desktop repository trust boundary.

## Decision

- Desktop raw repository Markdown is not uploaded to the API, including through review prompts,
  remote-sync summaries, or an implicit knowledge synchronization side channel.
- V1.4 API Review knowledge provenance is `none`. API Review may use only a source that the server
  explicitly authorizes and identifies; the current V1.4 path has no such source and must not claim
  local repository knowledge.
- The Desktop repository snapshot remains available only to trusted local consumers. Retrieval
  references remain recommendations and are not Governance evidence, as established by ADR 0007.
- A future server-side repository checkout requires a separate decision and implementation with
  explicit project authorization, least-privilege credentials, source/revision attribution,
  bounded indexing, retention rules, and auditable access events.

## Consequences

- V1.4 API Review honestly reports that it has no repository-knowledge provenance.
- Local Markdown cannot cross the Desktop/API boundary merely because a review or remote summary is
  requested.
- API Review may have less repository context until an authorized server source exists.
- A future server checkout is visible, revocable, attributable, and auditable instead of being an
  implicit extension of Desktop pairing.
