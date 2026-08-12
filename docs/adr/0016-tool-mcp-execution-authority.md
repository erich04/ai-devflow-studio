# ADR 0016: Tool And MCP Execution Authority

Status: Accepted

Date: 2026-08-12

## Context

The 1.x domain contains a Team-visible `McpServerDefinition` with a display name, command string,
permission label, enabled flag, and audit summary. It supports management UI and synchronized team
metadata. That record is renderer/team writable and was never designed to authorize `spawn`.

V2.0 needs native Tool calls and one accepted MCP scenario without turning synchronized display data
into local command execution, leaking the parent environment, or allowing a model to invent scope.

## Decision

Team `McpServerDefinition` remains non-authoritative catalog/display metadata and must never be used as process-spawn authority.
Local execution uses a separate Electron-main-owned
`LocalMcpInstallation` registry plus a main-owned native Tool registry.

### Tool Definitions And Capability Grants

A Tool Definition has a stable ID/version, source (`native` or `mcp`), description, strict JSON input
and output schemas, declared permission class, side-effect class, default deadline, result-size cap,
and audit/redaction policy. Duplicate IDs, unsupported schema features, unknown permissions, and
unbounded definitions fail registration.

Before a call, Electron main issues an opaque, short-lived `ToolCapabilityGrant` bound to the exact
Agent Runtime, organization, project, user, session, and Local Project; Tool ID/version; allowed
permission and side-effect class; resource scope; expiry; remaining call count; and budget. The
runtime and renderer can refer to the grant but cannot forge or widen it. Policy, Workflow version,
Local Project binding, and grant freshness are rechecked immediately before execution.

Every call uses strict input and output schema validation, a bounded result, deadline, cancellation,
and redaction. Unknown fields are rejected. Timeout or cancellation terminates or disconnects the
underlying operation and produces a typed result; it never assumes that an ambiguous side effect did
not occur. Non-idempotent Tools require an idempotency or reconciliation contract before acceptance.

### Trusted Local MCP Installation

`LocalMcpInstallation` is persisted only in Desktop local state. It records a stable installation ID,
verified executable identity/path, fixed argument vector, `stdio` transport, bounded startup and
call deadlines, allowed environment-variable names, working-directory policy, expected server/tool
identity, enabled state, and installation version. Secret values stay in the credential boundary and
are injected only by Electron main. The parent process environment is not inherited wholesale.

Installation or material revision is an explicit local developer action. Team metadata may suggest
or describe a server, but cannot create, enable, revise, or execute an installation. Renderer input
never supplies the executable, arguments, cwd, or secret environment values at call time.

V2.0 accepts local `stdio` MCP only; remote MCP transports are deferred until a separate authority,
network egress, authentication, redirect, and tenant-isolation decision exists.

### Discovery, Lifecycle, And Audit

Electron main starts an MCP process only after runtime and installation authority pass. It performs a
bounded protocol handshake, validates server identity and advertised Tool schemas, snapshots a
capability-set digest, and then permits calls covered by an exact ToolCapabilityGrant. Discovery
does not itself authorize execution.

The main process owns start, health, deadline, cancellation, protocol error, and shutdown. A process
is scoped to the accepted runtime/session policy; it cannot silently outlive cancellation or Desktop
shutdown. Crash/restart recovery never assumes a prior non-idempotent call is safe to repeat.

Local audit records installation ID/version, runtime and Tool identity, scope IDs, permission
decision, start/end time, bounded status, result digest/size, redaction state, and failure code. Team
receives only an allowlisted redacted summary. No audit row contains command text from Team,
credentials, raw source, prompt, output, patch, or absolute path.

## Consequences

- Existing MCP management UI remains useful but gains no execution authority by accident.
- Native and MCP Tools share validation, capability, deadline, cancellation, result, and audit
  semantics.
- Cross-project, cross-user, expired-grant, disabled-installation, schema-tamper, and environment
  leakage tests become release requirements.
- V2.2 execution tenancy can build on the scoped grant without claiming hosted public multi-tenancy.

## Rejected Alternatives

- **Spawn `McpServerDefinition.command`.** Rejected because Team/renderer data is not trusted local
  process authority.
- **Allow arbitrary shell MCP configuration per Agent prompt.** Rejected because a model cannot
  create executable or credential scope.
- **Inherit the full Desktop environment.** Rejected because unrelated credentials would cross the
  server boundary.
- **Support remote MCP immediately.** Rejected because its authentication and network authority are
  materially different from a local child process.
