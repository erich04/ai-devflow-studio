# ADR 0012: Web/Desktop Work Authority

## Status

Accepted

## Context

V1.4 adds Web work intake and Gate actions to a product whose execution authority is local. The
current API/Postgres Run is built incrementally from redacted `RemoteRunSummary` records. It has only
the current-node projection and selected child summaries; it does not contain the complete local
node graph, repository context, artifacts, test output, or workflow evidence held by Electron
LocalStore.

Treating that lossy record as a writable Run would create two workflow authorities. Web could then
advance a status without the local evidence checked by `applyWorkflowCommand(...)`, while a later
Desktop sync could overwrite or contradict the Web result. Conversely, uploading the full local
Run and its evidence would violate the local execution and repository privacy boundary established
by ADR 0003 and ADR 0011.

V1.4 therefore needs an explicit ownership and handoff model before either Work Request or Web Gate
write routes are implemented.

## Decision

Team owns the versioned Work Request and Gate Command records. Desktop owns the canonical
full-fidelity local Run and every workflow transition over that Run. The server may authorize and
queue collaboration intent, but only the owning Desktop may apply that intent through the shared
workflow domain logic and an atomic LocalStore mutation.

### Authority map

| Record or decision | Authority | Boundary |
| --- | --- | --- |
| Work Request | Team API/Postgres | Versioned team intake; contains bounded collaboration text, project scope, lifecycle, and claim binding. |
| Work Request claim | Team API/Postgres | A project-bound Desktop explicitly claims a version and binds one stable local Run ID. |
| Canonical Run, full node graph, and local evidence | Desktop LocalStore | Created only after a successful claim; evaluated and mutated only through the Desktop workflow runtime. |
| Team Run Projection | Team API/Postgres | Versioned, redacted, lossy read model derived from canonical Desktop summaries. It is never execution authority. |
| Gate Command | Team API/Postgres | Authenticated, version-bound collaboration intent plus its server evaluation and delivery lifecycle. |
| Gate transition | Desktop LocalStore | Re-evaluated against the full local Run, evidence, and authoritative policy, then committed atomically. |
| Manager/Web views | Team API read models | Read Work Requests, commands, projections, and redacted evidence; never read LocalStore directly. |

### Versioned Work Request and explicit claim

A Work Request is not a `WorkflowRun`. It has its own stable ID, project and organization scope,
bounded title/request fields, integer `version`, lifecycle status, creator, timestamps, and optional
expiry. Team increments the version for every accepted lifecycle or content change.

To start execution, a paired Desktop generates the intended local Run ID and submits a claim with
the Work Request ID, expected Work Request version, Desktop-token identity, and an idempotency key.
The Team service atomically verifies the live project membership, request state/version, expiry,
and absence of another claim before binding that exact Run ID and claimant. Desktop waits for that
grant before it creates the canonical Run transactionally from the returned immutable request
snapshot. Local creation is idempotent by Run ID, so retrying after a crash cannot create a second
Run.

The claim is durable rather than an automatically reassignable lease. If Desktop fails after Team
grants the claim but before local creation, the same claimant resumes with the same claim and Run
ID. The request is shown as `claim_pending` until Desktop acknowledges local materialization or the
first canonical projection arrives. A lead may explicitly release a pending claim only when no
canonical projection has ever been accepted, using the expected Work Request version; the release
is audited. Team never fabricates a Run merely because a Work Request or claim exists.

Each canonical local mutation advances an integer Run version. A remote Run summary carries that
version, and Team accepts it monotonically into the Team Run Projection. Timestamps remain display
and audit data, not concurrency tokens.

### One workflow state machine

Web never directly mutates a Team Run Projection, and no API route accepts a replacement
`WorkflowRun`, status, or current-node write from Web. The Team service does not copy the Electron
workflow state machine. Shared pure evaluators may be used for a server preflight, but advancing the
canonical Run still requires Desktop to call the shared transition function with its complete local
evidence and commit through LocalStore optimistic concurrency.

Remote summaries remain one-way redacted projections. They cannot replace a colliding local Run,
reactivate an old node, satisfy missing evidence, or serve as the input to a local transition.

### Gate Command contract

A Web Gate action submits a Gate Command; it does not submit a Run patch. The browser write uses a
signed browser Session Cookie. The API resolves the authenticated identity from that cookie and
reloads live project membership and role from Team storage instead of trusting a role embedded in
the form, query string, or an old overview response. Pilot routes do not accept unsigned identity
headers.

The bounded Gate Command record contains:

- organization ID, project ID, Work Request ID when present, Run ID, and current Node ID;
- action (`approve` or `reject`) and a redacted, size-limited reason;
- requesting user ID and the project role verified by the server;
- a client-generated idempotency key and a server-computed request fingerprint;
- integer `expectedRunVersion`, integer `expectedPolicyVersion`, and the exact expected blocker-ID
  set used for the decision;
- server evaluation result and timestamp, lifecycle status, creation/expiry timestamps, and only
  safe receipt/outcome metadata.

The API performs a server-side preflight before persisting a pending command. In one transaction it
rechecks organization/project/Run/Node scope, current Team Run Projection version and node, the
fresh effective-policy version, the submitter's live project membership and role, separation of
duties, and the current redacted enforcement inputs. It uses the shared policy evaluators; it does
not reimplement their rules in a route. A known denial is returned immediately and audited, not
queued for Desktop to discover. Passing server preflight authorizes only the command request, not
the local transition, because Team does not possess all local evidence.

For V1.4, `approve` requests either `approve_gate` or `approve_acceptance` for the selected current
node. `reject` records a human rejection and leaves the canonical Run paused at that Gate; it does
not guess a rollback target. Any future rollback or changes-requested transition requires a shared
domain command and a separate product decision rather than an API-only status rewrite.

### Desktop inbox, receipt, apply, and acknowledgement

Delivery follows `inbox → receipt → apply → acknowledgement`:

1. The Desktop that owns the Work Request claim polls a project-scoped inbox with its paired
   Desktop Bearer Token. Team resolves the token, immutable project binding, claimant token ID, and
   current membership before returning a command.
2. Team grants a bounded delivery receipt/lease for one command. The receipt identifies the command
   and attempt but carries no Cookie, Bearer Token, or repository data.
3. Desktop persists the receipt, loads the bound canonical Run and local evidence, verifies the
   command scope and expiry, compares `expectedRunVersion`, refreshes or loads the authoritative
   `expectedPolicyVersion`, and re-evaluates the full local evidence. For approval it invokes the
   existing shared workflow transition and commits the Run mutation plus the command outcome in one
   optimistic LocalStore transaction. Rejection is persisted as a human decision without advancing
   the current node.
4. Desktop acknowledges the exact receipt using the paired Desktop Bearer Token and reports only a
   bounded outcome code plus before/after Run versions. Team records the acknowledgement and audit
   result; it does not update projected workflow state from the acknowledgement.

Only a later canonical Desktop summary advances the Team Run Projection. This preserves the
existing child-first, monotonic, redacted sync contract and ensures an acknowledgement cannot race a
summary into becoming an alternative Run mutation channel.

### Duplicate, concurrency, expiry, and recovery semantics

Every Work Request create/claim and Gate Command write is idempotent. Retrying the same operation
with the same idempotency key and fingerprint returns the original result, including an original
rejection or terminal outcome. Reusing the same key with a different fingerprint is a `409 Conflict`
and never changes the first record. Idempotency records are scoped to organization, project, actor,
operation kind, and key; a key from one project cannot address another project.

Work Request claim uses an expected version and an atomic conditional update. If different
Desktops race to claim the same request version, one claimant wins and every loser receives a
conflict before creating a local Run. A timed-out winner retries its original key and receives the
same Run binding. An unclaimed request past its optional expiry returns `410 Gone`; a successful
durable claim does not silently expire or move to another Desktop.

For a Gate, Team permits exactly one active command for a project/Run/Node/`expectedRunVersion`
tuple. A concurrent different action or actor receives `409 Conflict` and must reload the projection
after the active command reaches a terminal state. This prevents an approval and rejection prepared
from the same snapshot from both reaching Desktop. A command expires after a bounded server-defined
window (15 minutes by default). An expired command is never delivered or applied, and expiry is a
terminal audited outcome rather than a retryable failure.

Delivery receipts are leases, not transition authority. If Desktop crashes after receipt but before
the LocalStore transaction, the receipt lease expires and Team may redeliver the same command while
it remains unexpired. Desktop stores command ID, receipt ID, request fingerprint, and terminal local
outcome under a unique command ID in the same transaction as any Run mutation. If the transition was
applied before acknowledgement and Desktop or the network then fails, a redelivery reads that local
outcome and retries the same acknowledgement; it must not apply the transition twice. Team likewise
treats a repeated matching acknowledgement as the original terminal result.

Team terminally rejects a command before delivery when the requesting actor's membership or role
has been revoked. Desktop rejects without mutation when the command is expired, its scope does not
match the claiming Desktop, the current node differs, the local Run version differs (`stale_run`),
the authoritative policy version differs or is unavailable (`stale_policy`), the blocker set
changed, or the full local evidence blocks the transition. These are safe, terminal outcome codes
for that command; the Web user must refresh and create a new version-bound command. A local
mutation racing between receipt and commit becomes `stale_run` through LocalStore optimistic
concurrency.

If Desktop is offline, a pending command remains visible and deliverable until expiry; Team never
advances the projection on its behalf. If an acknowledgement arrives after wall-clock expiry, Team
accepts the recorded terminal outcome only when the matching receipt proves Desktop applied or
rejected it before expiry. A receipt obtained before expiry does not authorize a new application
after expiry.

The API failure categories are stable and fail closed:

| Result | Meaning |
| --- | --- |
| `400 Bad Request` | Malformed or unsupported bounded input. |
| `401 Unauthorized` | Missing or invalid signed Cookie/Bearer authentication. |
| `403 Forbidden` | Organization, project membership, role, separation-of-duties, claimant, or token scope denial. |
| `409 Conflict` | Idempotency fingerprint mismatch, stale expected version, competing claim/command, or immutable binding conflict. |
| `410 Gone` | Unclaimed Work Request or Gate Command expired before the requested operation. |
| `503 Service Unavailable` | Authoritative membership or policy state cannot be loaded; no command or transition is allowed. |

A Gate Command lifecycle is `pending`, `delivering`, `applied`, `rejected`, or `expired`. A
transient inbox/receipt/ack transport failure retains or returns the command to `pending` after its
lease, subject to expiry. A deterministic authorization, scope, version, policy, blocker, or local
evidence failure is `rejected` with a safe code and is not retried. An unexpected Team `5xx` leaves
the previously committed state authoritative; clients retry with the same idempotency key. There is
no ambiguous state that assumes a failed response applied a transition.

### Audit and data minimization

Audit is append-only at both authority boundaries. Team audit covers every Work Request create,
content/version change, claim/release, materialization acknowledgement, cancellation, and expiry,
plus every Gate command submission, server preflight, receipt, acknowledgement, and expiry. Each
entry contains stable record IDs, organization/project scope, actor ID, authentication mechanism
kind, verified project role, expected/observed versions, action, blocker IDs or hashes, safe outcome
code, idempotency fingerprint, and timestamps. Desktop records receipt, evaluation, atomic outcome,
and acknowledgement retry state against the local Run and Node.

Audit never stores Cookies, Bearer Tokens, API keys, or provider credentials. It stores a safe token
record ID where attribution is necessary, never the token or token hash. User-entered titles,
requests, and reasons pass through size limits plus path/secret redaction before Team persistence;
error messages use fixed allowlisted codes and bounded redacted detail.

Every network contract uses a bounded allowlist projection. Team Run Projection, Work Request, Gate
Command, receipt, and acknowledgement parsers discard unknown fields and reject over-limit input.
The command may refer to evidence, blocker, policy, and content hashes by stable IDs, but it cannot
carry raw local evidence.

In particular, raw repository Markdown, source files, prompts, stdout, stderr, patches, and absolute
local paths never cross this boundary; local repository content is not uploaded by claim, command,
receipt/acknowledgement, audit, or remote-summary sync. ADR 0011 continues to govern repository
knowledge provenance; pairing a Desktop grants neither repository upload authority nor server-side
repository access.

## Consequences

- Team needs separate versioned Work Request, claim/idempotency, Gate Command, delivery receipt, and
  append-only audit persistence. These are collaboration records, not new `workflow_runs` mutation
  routes.
- The canonical `WorkflowRun` and remote summary/projection need an explicit monotonic integer Run
  version. LocalStore must atomically persist Gate command outcomes with transitions and dedupe by
  command ID.
- Web can show `pending`, `waiting for Desktop`, `applied`, `rejected`, and `expired` honestly. Gate
  actions are asynchronous when the owning Desktop is offline.
- Team performs an early, authoritative authorization/policy check while Desktop remains the final
  evidence and transition authority. A server allow is therefore necessary but not sufficient.
- Existing redacted outbox ownership remains intact: command acknowledgements do not advance Run
  state, and lossy Team projections never write into LocalStore.
- V1.4 intentionally does not solve automatic claim reassignment or general multi-Desktop conflict
  resolution. A pending claim requires explicit recovery; broader collaboration hardening remains a
  later milestone.

## Rejected alternatives

- **Create a full Run in Web/API at intake.** Rejected because Team lacks repository context and
  local execution evidence; it would create a second canonical workflow.
- **Let Web update `workflow_runs.status` or `current_node_id`.** Rejected because a lossy projection
  cannot enforce the shared evidence-backed transition invariants.
- **Apply Gate approval only on the server.** Rejected because server preflight cannot inspect the
  full LocalStore evidence chain and cannot atomically mutate the canonical local Run.
- **Copy the Electron transition rules into API routes.** Rejected because duplicated rules drift;
  shared pure evaluators may be called, but the canonical transition stays local.
- **Use timestamps or last-write-wins instead of expected versions.** Rejected because equal clocks,
  delayed sync, retries, and concurrent actions would make outcomes ambiguous.
- **Upload the full local Run or repository evidence to make the server authoritative.** Rejected
  because it violates the private local execution, redaction, and repository-provenance boundaries.
