# Module 6: 一枚可信 Draft PR 的诞生

## Teaching Arc
- **Metaphor:** 防拆封快递。代码、diff、测试和 PR 文案各有指纹；收件人先批准准确包裹，快递员只拿一次性钥匙，送达后还要核对回执，任何封条变化都退回人工恢复。
- **Opening hook:** “已经写完代码”离 GitHub 上出现一个可信 Draft PR 还有很远：系统必须证明正在发布的就是刚才测试和批准的那一份。
- **Key insight:** GitHub Delivery 用 commit 与多种 digest 把本地工作区、差异、测试、PR package、Web approval、短时凭据和最终 Draft PR 绑定为同一条不可偷换的证据链。
- **Why should I care?:** 你能识别安全交付真正需要的条件，也知道遇到 stale intent / authority mismatch 时为什么应显式 Resume，而不是自动重试危险写操作。

## Code Snippets (pre-extracted)

File: `packages/shared/src/github-delivery.ts` (lines 144-160)
```ts
  repository: string
  baseBranch: string
  headBranch: string
  baseCommitSha: string
  expectedCommitSha: string
  diffArtifactId: string
  diffSourceDigest: string
  testEvidenceId: string
  testEvidenceCreatedAt: string
  testEvidenceDigest: string
  prPackageArtifactId: string
  prPackageUpdatedAt: string
  prPackageDigest: string
  changedPaths: string[]
  intentDigest: string
  idempotencyKey: string
  status: GitHubDeliveryStatus
```

File: `apps/desktop/electron/github-delivery-processor.ts` (lines 903-910)
```ts
    async (credential) => {
      if (
        credential.repositoryId !== source.repositoryId ||
        credential.repository !== source.repository ||
        credential.headBranch !== source.headBranch ||
        credential.expectedCommitSha !== source.expectedCommitSha
      ) {
        throw new Error('Credential authority mismatch')
```

File: `packages/shared/src/github-delivery.ts` (lines 299-307)
```ts
  if (
    repository !== input.intent.repository ||
    baseBranch !== input.intent.baseBranch ||
    headBranch !== input.intent.headBranch ||
    headSha !== input.intent.expectedCommitSha ||
    input.draft !== true
  ) {
    throw new Error('GitHub Delivery completion does not match the approved intent')
  }
```

## Interactive Elements
- [x] **Code↔English translation:** Use processor lines 903-910 exactly. Explain that a credential is accepted only if repository ID/name, delivery branch and expected commit all match the approved intent.
- [x] **Quiz:** Three final application questions: (1) tests passed, then workspace commit changed before publish; (2) provider returns a normal non-draft PR; (3) outbound secret scan cannot complete. Correct actions are recovery/reject/recovery, never “publish anyway.”
- [ ] **Group chat animation**
- [ ] **Data flow animation** — already satisfied by Module 3; use a static flow here to avoid duplicating the same interaction.
- [ ] **Drag-and-drop**
- [x] **Other:** Hero flow diagram: managed worktree → re-test → sealed delivery intent → explicit Web approval → outbound scan → short-lived credential → publish branch → create and verify Draft PR → acceptance. Clickable lifecycle diagram for `approval_required`, `approved`, `publishing_branch`, `branch_published`, `creating_pr`, `completed`, `recovery_required`. Final big-picture architecture cards.

## Required Screens
1. Tamper-evident parcel metaphor and the full delivery chain.
2. Digest/seal cards grounded in the exact intent fields (commit, diff, test, PR package, intent).
3. Code↔English translation of the exact credential authority check.
4. Clickable delivery lifecycle and explicit recovery branch.
5. Verified completion check (`draft === true` and exact head SHA) plus final whole-system architecture: UI → Electron Main → Shared contracts → SQLite/outbox → API/Postgres/Web → GitHub.
6. End-of-course scenario quiz with three questions and a concise “how to steer/debug this project” takeaway.

## Reference Files to Read
- `references/interactive-elements.md` → Code ↔ English Translation Blocks; Multiple-Choice Quizzes; Interactive Architecture Diagram; Pattern/Feature Cards; Flow Diagrams; Numbered Step Cards; Glossary Tooltips.
- `references/design-system.md` → Color Palette; Typography; Spacing & Layout; Module Structure; Responsive Breakpoints.
- `references/content-philosophy.md` → entire file.
- `references/gotchas.md` → entire file.

## Connections
- **Previous module:** 为什么 Gate 不肯放行 — it established exact, current, scoped evidence as the condition for state change.
- **Next module:** None; close by zooming back out to the complete architecture and practical debugging language.
- **Tone/style notes:** Chinese, smart-friend tone. Teal accent. Module 6 uses `var(--color-bg)`. Tooltip first use of managed worktree, commit SHA, diff, digest, idempotency key, delivery intent, authority, short-lived credential, outbound scan, Draft PR, stale intent, recovery. Explicitly say a managed worktree is isolation, not a security sandbox. No custom styles/scripts.
