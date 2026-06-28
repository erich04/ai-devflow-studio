# Product Object Model

## Organization

The team boundary for users, projects, policy, and shared visibility.

## Project

A team-visible software project. It has a repository mapping, default branch, health state, optional
test command, policy settings, budget settings, and Desktop pairing credentials.

## Local Project

A developer-selected local repository in Desktop. It can contain private paths, local test commands,
and raw execution details. These details must stay local unless converted into redacted summaries.

## Run

A single delivery attempt for one software request. It moves through the product workflow from
clarification to acceptance and owns Nodes, Artifacts, Agent Events, Test Evidence, Coding Agent
Runs, and Gate decisions.

## Node

A unit inside a Run. Current product stages are:

1. `clarify`
2. `design`
3. `build`
4. `test`
5. `pr`
6. `accept`

Node kinds are `agent`, `gate`, `task`, `test`, `pr`, and `acceptance`.

Nodes are the main flow objects. Artifacts, Evidence, Trace, and Decisions are related resources
attached to a Run or Node, not separate Board nodes. Node-specific UI semantics are defined in
[`workflow-node-semantics.md`](./workflow-node-semantics.md).

## Gate

A human decision point. Gate approval must be enforced in write paths, not only through disabled UI.
Protected Gates are nodes whose kind is `gate` or `acceptance`.

A Gate can produce a durable report or approval record, but the user-facing concept should be a
Decision, conclusion, approval, block, or override rather than a generic Artifact.

## Artifact

A durable work product or evidence item attached to a Run or Node. Product-critical artifacts include
raw request, clarification, design, coding diff, PR draft, and acceptance evidence bundle.

## Evidence

Any durable proof that supports a Gate or delivery decision. Evidence includes artifacts, test
evidence, Knowledge Review results, policy decisions, budget decisions, runtime trace, permission
decisions, and redacted team summaries.

## Trace

A time-ordered execution or audit history explaining how a result was produced. Trace includes Agent
events, tool calls, permission relay, runtime steps, and cleanup events.

## Decision

A formal outcome that changes whether the Run may continue. Decisions include Gate approval,
blocking decisions, override acceptance or rejection, and budget approval.

## Agent Review

A structured review result produced from DevFlow-owned context and a model provider. It can produce
risks, missing evidence, suggested tests, policy findings, references, token usage, trace steps, and a
Gate Advisory.

## Coding Agent Run

A local implementation attempt hosted by the managed coding runtime. DevFlow owns context assembly,
permission relay, managed worktree isolation, diff capture, test evidence, runtime trace, cleanup
state, and redacted summary sync. The external coding engine owns actual code generation.

## Policy

The configurable Gate Enforcement Policy that maps evidence and findings to warning, block,
hard-block, override, or policy-sync states.

## Budget

Runtime cost controls for model/provider usage. Budget decisions should explain whether work is
allowed, warned, or blocked before expensive provider usage proceeds.
