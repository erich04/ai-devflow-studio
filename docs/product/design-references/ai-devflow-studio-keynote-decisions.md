# AI DevFlow Studio Keynote Decisions

This document records the presentation and product-language decisions confirmed for the AI DevFlow
Studio keynote deck. It should guide future PPT, OpenDesign, and product-narrative work.

## Core Narrative

AI DevFlow Studio is an exploration of moving AI-assisted software delivery from black-box Skill or
CI calls into an observable, traceable, governable team delivery flow.

Use this concise keynote framing:

> Let AI development move from black-box invocation to evidence-driven team delivery.

In Chinese presentation material:

> 让 AI 研发从黑盒调用，走向证据驱动的团队交付。

The deck should not claim the demo is a complete commercial platform. It should show that the demo
validates a practical path.

## Audience

Target technical leads, architects, BA leads, QA leads, and engineering-process stakeholders who
care about AI delivery governance. Do not optimize the deck for a pure frontend audience or a
generic management audience.

## Key Terms

- **Team Knowledge Foundation / 团队知识底座**: the shared knowledge layer used by Runs, Agents, and Gates.
- **Knowledge Repository / 知识仓库**: a Git-managed knowledge repository that links to multiple code repositories.
- **Code Repository / 代码仓库**: an implementation repository linked from the knowledge repository.
- **Repository-Derived Knowledge**: system or business knowledge summarized from linked code repositories.
- **Candidate Knowledge**: extracted knowledge that has not passed review.
- **Confirmed Knowledge**: reviewed knowledge that can be used as authoritative Gate evidence.
- **System Knowledge**: technical structure, boundaries, services, interfaces, data models, dependencies, and constraints.
- **Business Knowledge**: business terms, rules, user flows, assumptions, and relationships between business concepts.
- **PR Delivery Package / PR 交付包**: a handoff artifact for later PR creation, not automatic repository upload or merge.

Avoid:

- realtime library
- knowledge frequency
- automatic knowledge generation
- automatic merge
- automatic repository upload
- code repository manager

## Knowledge Repository Model

The multi-repository story should be explained as:

> One knowledge repository connects multiple code repositories.

The knowledge repository contains a dedicated area for knowledge extracted from code repositories.
That extracted knowledge is organized as system knowledge and business knowledge.

Extraction is tool-assisted, not automatically authoritative:

1. ISCQ / WeQ / isctPilot help extract and summarize knowledge from code repositories.
2. Extracted output enters the candidate knowledge state.
3. Review or Gate confirmation promotes it to confirmed knowledge.
4. Confirmed knowledge can support requirement clarification, solution design, Knowledge Review,
   Gate decisions, and Coding Agent context.

## Delivery Workflow

The Workflow Board is the complete delivery flow, not a side process:

1. Requirement clarification
2. Clarification Gate
3. Solution design
4. Solution Review Gate
5. Implementation
6. Test evidence
7. PR delivery package
8. Business acceptance

The short Chinese flow for slides:

> 需求澄清 -> Gate -> 方案设计 -> Gate -> 开发实现 -> 测试证据 -> PR 交付包 -> 业务验收

Gate should be explained as evidence review, not generic approval. A Gate checks whether the current
stage has enough evidence to enter the next risky stage.

## Agent Boundaries

Use two main Agent paths:

- **Knowledge Review Agent** reviews requirements or solution design against team knowledge,
  evidence, and policy context. It produces risks, missing evidence, references, and Gate Advisory.
- **Coding Agent** writes code through a managed worktree, permission relay, diff capture, and test
  evidence path.

Skill is not a third main Agent path. It is a reusable capability catalog that can support Review
and Coding, but it cannot bypass Gate, policy, or evidence requirements.

External coding engines such as opencode / OpenCode should appear as external capability, not as
DevFlow's own Agent core. DevFlow owns context assembly, permission relay, evidence capture, tests,
and team-safe summaries.

## Open Design Boundary

Keep Open Design and opencode / OpenCode separate:

- **Open Design** belongs to the design path: generate an HTML prototype, validate information
  architecture and interaction, then convert the prototype into React components and the Electron
  workbench.
- **opencode / OpenCode** belongs to the execution path: external Coding Agent capability connected
  through the Coding Agent Adapter.

Do not describe OpenCode as the design tool.

## Deck Structure

Use a 9-slide structure:

1. **AI DevFlow Studio**: let AI development workflows become observable, traceable, and governable.
2. **Problem**: invisible process, untraceable basis, unfriendly collaboration.
3. **Core thesis**: from black-box invocation to evidence-driven team delivery.
4. **Team knowledge foundation**: one knowledge repository connects multiple code repositories.
5. **Delivery workflow**: requirement clarification through business acceptance, with Gates.
6. **Design-to-engineering**: Open Design HTML prototype -> React components -> Electron Workbench.
7. **Dual Agent paths**: Knowledge Review Agent and Coding Agent have separate responsibilities.
8. **Architecture boundaries**: Electron, SQLite/Postgres, external Coding Engine, team management platform.
9. **Closing**: this is not the endpoint, but a verifiable path.

Do not include the personal background that the demo was built after work or on weekends.

## Visual Direction

Follow `apple-inspired-keynote-style.md`.

Use:

- content-first pages
- large concise titles
- generous whitespace
- modern sans-serif typography
- neutral black / white / gray palette
- blue as the primary accent
- small amber or red semantic markers only for Gate or risk
- screenshots as evidence, not as dense first-contact explanation
- light Liquid Glass inspiration only when it supports readability

Avoid:

- Apple logo or official Apple assets
- Apple website imitation
- dense report-style pages
- large red/pink theme derived from the product UI
- decorative cyberpunk gradients
- cluttered architecture diagrams

## Screenshot Usage

Do not start with the full Workflow Board screenshot. First show a simplified flow diagram, then show
the screenshot as proof that the flow has been implemented as an operational workbench.

When using the Workflow Board screenshot, highlight:

- six-stage main flow
- Gate review points
- right-side Inspector evidence / Trace / Gate impact

## Closing Message

Use this final statement:

> 这不是终点，而是一条可验证的路径。

Supporting points:

- 从知识碎片到团队知识底座
- 从黑盒调用到证据链
- 从个人 Agent 使用到团队治理

Mention that the current artifact remains an exploratory demo and that future work should focus on
real Agent integration, knowledge review flow, and team operation.
