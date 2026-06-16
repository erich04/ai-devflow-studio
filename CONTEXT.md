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

## Knowledge Graph

A lightweight relationship layer extracted from the Knowledge Base and Run artifacts. It links terms,
systems, decisions, tasks, artifacts, and owners.

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
