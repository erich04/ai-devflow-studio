# Context

## Run

A single AI-assisted delivery attempt that starts from a task request and moves through clarification,
design, build, test, pull request, and acceptance.

## Node

An execution or review unit inside a Run. Nodes can represent agent work, human gates, tests, pull
request creation, or acceptance steps.

## Gate

A human decision point that controls whether a Run can move into the next risky stage.

## Artifact

A durable piece of evidence produced by a Run or Node, such as a requirement note, design document,
code diff, test report, log, or pull request summary.

## Skill

A reusable team capability that defines a process method, prompt strategy, knowledge-reading rule, or
review checklist.

## MCP Server

A local or remote tool connector that an agent can call during a Run, subject to team policy and local
developer configuration.

## Knowledge Base

The team-maintained Git and Markdown source of reusable standards, templates, decisions, examples,
project context, and glossary.

## Knowledge Source File

A Markdown file in the repository that remains the reviewable source of truth for a team standard,
checklist, ADR, contract, onboarding note, Skill rule, or MCP rule.

## Knowledge Document

The indexed representation of a Knowledge Source File, including title, category, summary, tags,
owner, source path, and Markdown content.

## Knowledge Graph

A lightweight relationship layer extracted from the Knowledge Base and Run artifacts. It links terms,
systems, decisions, tasks, artifacts, and owners.

## Knowledge Reference

A relationship between a Run, Node, Artifact, Test Evidence, or Gate decision and a Knowledge
Document. References can cite, satisfy, require evidence for, or violate a standard.

## Knowledge Governance Check

A reviewer-facing summary of whether the currently selected workflow node has enough evidence for
the standards that apply to it. v0.4 displays these checks; later versions can enforce them.

## Token Usage

The measured model usage for a Run, Node, member, project, or model provider.

## Local Project

A repository directory selected on a developer's machine for local execution. It carries local-only
configuration such as the test command and detected package manager.

## Local Execution

Work performed by the desktop client on the developer's machine, such as running a project's test
command and collecting evidence. Local Execution is separate from team-wide synchronized state.

## Test Evidence

The durable record of a local test execution, including command, working directory, result status,
duration, and redacted output.

## Data Origin

The source class for data shown in the app. `seed` is fixture/demo data, `local` is Electron SQLite
state, `remote` is future team backend state, and `adapter` is reserved for future external execution
engine snapshots such as a HoneyAI bridge.

## Local Settings

Developer-machine preferences stored in Electron SQLite, such as the theme preference and local MCP
UI state. Browser preview can still fall back to localStorage when the Electron preload API is not
available.

## Remote State

Team-shared state that will be owned by the backend in v0.3, including shared Runs, projects,
members, costs, Gate decisions, and manager dashboard summaries.

## Cross-Platform Desktop

The requirement that the Electron client work across macOS and Windows. Windows 11 is the primary
Windows target; Windows 10 is best-effort.

## Windows Compatibility

The product constraint that local execution, SQLite persistence, path handling, command safety, and
smoke tests must not assume macOS-only behavior.

## Platform-Safe Local Execution

Local execution implemented with cross-platform Node/Electron APIs such as `path`, `os.tmpdir()`,
`spawn` with explicit `cwd`/`env`, and Electron `app.getPath('userData')`, without requiring
`bash`, `zsh`, `/tmp`, or POSIX path separators.
