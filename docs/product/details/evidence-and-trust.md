# Evidence And Trust

## Evidence Chain Rules

Evidence Chain is the core product metaphor for the UI refactor.

1. Every meaningful workflow action should either create evidence or explain why evidence is not yet
   available.
2. Evidence should be attached to a Run and, when possible, to a specific Node.
3. Local raw details stay local.
4. Team-visible evidence must be redacted.
5. Gate UI should show evidence state, policy state, and next action together.
6. Missing evidence should become an actionable remediation path, not passive warning text.
7. A reviewer should be able to answer: what was requested, what changed, what was tested, what did
   the agents conclude, what policy applied, who approved, and what remains risky.

## Trust And Redaction Boundaries

Never sync these raw values to the team by default:

- Local absolute paths.
- Raw prompts.
- Raw stdout/stderr.
- Patch bodies.
- Provider secrets.
- API keys or tokens.
- Unredacted local command output.
- External-directory access details.

Safe team summaries may include:

- Run id, title, status, branch, and stage.
- Changed path summaries when paths are repo-relative and safe.
- Test command, status, duration, and redacted summary.
- Agent Review conclusion, advisory level, missing evidence count, and risk count.
- Policy and budget rollups.
- Gate decisions and override reasons.

