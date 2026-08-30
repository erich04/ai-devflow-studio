# DevFlow Studio V2.2 Release Walkthrough

Status: Stable release procedure; no result claimed

This walkthrough verifies the formal `2.2.0` candidate `C` through the normal packaged Desktop,
Web, API, and private GitHub sandbox surfaces.

It covers the workflow and bounded Agent group: Workflow Stage Agent, Knowledge-Grounded Gate Review
Agent, and the Coding Agent connected through the CRI boundary. In Gate Review, retrieved Knowledge
is grounding; the current Gate, its conditions, and associated stage artifacts and evidence are the
review subject.

It also checks the V2.0 runtime, V2.1 Memory, and V2.2 coordination boundaries without giving an
Agent authority over human Gates or GitHub publication.

## Preconditions

- Use a clean checkout at the full SHA of `C`, fresh Team schema v24 state, and fresh Desktop schema
  v34 state.
- Dispatch the `Verify` workflow against `C` and download
  `ai-devflow-studio-v22-candidate-desktop` from its first successful attempt. Verify the complete
  artifact trio before launch; a local rebuild is not a substitute.
- Use a non-sensitive fixture repository and a dedicated private GitHub sandbox with the documented
  least-privilege App setup. Keep all credentials and local paths out of evidence.
- Use a non-maintainer operator. After the run begins, shell, direct HTTP, SQL, GitHub CLI, source
  edits, evidence edits, or undocumented repair disqualifies the result.

## Operator Path

1. Launch the isolated self-hosted stack and packaged Desktop. Confirm the package version, schemas,
   artifact SHA-256, authentication, and empty release state.
2. Pair one Local Project to one Team Project, then create one Work Request and materialize exactly
   one canonical local Run.
3. Complete Clarify and Design with the Workflow Stage Agent. On the Workflow Board, confirm that
   Design is a Task that produces the unique Design Artifact, not a Review node. Stage summaries
   must keep node type, source, and any special folded-output presentation on separate lines. Inspect
   each Task's read-only Gate impact: it must select the nearest downstream Gate from workflow edges,
   show that Gate's live status and only the Task artifacts actually associated with it, and navigate
   to the Gate without exposing approval or Override on the Task.
4. Run Gate Review before each Gate approval. Confirm that Gate Review is shown separately from the
   Design Task and from the final human approval. Confirm that retrieved Knowledge citations and policy
   findings are evidence rather than approval authority, and that only redacted metadata reaches Team
   storage. In Remediation, confirm that only current unmet facts appear, with their source/rule,
   severity, required role/evidence, completion standard, and a controlled Review, Tests, Policy sync,
   or Coding retry action where one exists. Confirm that Lead Override remains a separate authorized
   and audited path. Then approve the Gate explicitly.
5. From the Agent Runtime panel, start exactly one standalone Runtime for the current Build node and
   advance its `scenario.evaluate` action to terminal success. Exercise the resulting Memory
   candidate through human-controlled promotion, revision, deletion, and purge. Separately start one
   bounded Coordination Session and one read-only Specialist, cold-restart while that session is
   partial, confirm zero repeated starts or effects, then cancel the session and child Runtime before
   continuing. Do not advance a Supervisor or Specialist Runtime as the standalone Runtime check;
   their capability digest and leases are coordination-scoped.
6. In Agents, configure the project Coding Executor before starting it. For Native, select a locally
   saved Provider. For OpenCode, run local detection, review the exact candidate, and explicitly
   confirm it for this project; detection alone must not save or start it. Confirm that Workbench and
   Agents show the same checks for Coding Executor, Coding Engine, capability, Provider, Team Project,
   test command, budget policy/evaluation, concurrency, and permission, and that any unknown or blocked
   check disables Start. Then start the Coding Agent through the CRI boundary and review its permission
   request, bounded Tool/MCP use, managed-worktree diff, tests, runtime trace, and cost evidence.
   Confirm cancellation and failure paths leave a safe resumable or terminal state.
7. At the PR node, prepare one exact Delivery Intent. Approve it separately in Web as a lead or
   owner, then publish one namespaced branch and create or reconcile exactly one Draft pull request.
8. Cold-restart Desktop after the remote effect. Confirm there is no second credential grant, push,
   Draft PR, Agent Tool effect, Memory lifecycle effect, or coordination replay effect.
9. Complete Acceptance while the pull request remains Draft and unmerged. Revoke the repository
   binding and run the packaged revocation check; only a durable `binding_inactive` result passes.
10. Inspect Team and Desktop projections for credentials, raw patches/output, repository contents,
    prompts, and local absolute paths. Record only bounded metadata and complete external cleanup.

## Passing Result

The result passes only when every observation binds to `C`, the downloaded `2.2.0` artifact, Team
schema v24, and Desktop schema v34; every deterministic gate is passing; the Agent group remains
inside its scoped workflow roles; restart produces zero duplicate effects; GitHub receives one
approved branch and one unmerged Draft PR; and all evidence is redacted.

Write the dated result as
`docs/guides/devflow-studio-v2.2-walkthrough-result-YYYY-MM-DD.md`. The machine-checked release
summary must include the exact candidate SHA, artifact version/platform/SHA-256, Verify URL, delivery
identities, Draft PR URL, lifecycle counts, restart result, revocation proof, redaction result, and
cleanup result. Then add the three `release-*` JSON records described in
`docs/plans/v2.2-release-signoff.md` in the direct-child signoff commit `S`.
