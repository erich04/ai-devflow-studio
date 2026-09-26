import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (relativePath: string) => readFileSync(join(process.cwd(), relativePath), 'utf8')

describe('v1.5 GitHub Delivery contract', () => {
  it('defines a finite product outcome and one authenticated delivery story', () => {
    const prd = read('docs/product/prd/v1.5-github-delivery-prd.md')

    expect(prd).toContain('## Problem Statement')
    expect(prd).toContain('## Solution')
    expect(prd).toContain('## User Stories')
    expect(prd).toContain('## Implementation Decisions')
    expect(prd).toContain('## Testing Decisions')
    expect(prd).toContain('## Out of Scope')
    expect(prd).toContain('managed worktree')
    expect(prd).toContain('expected commit')
    expect(prd).toContain('explicit human approval')
    expect(prd).toContain('Draft pull request')
    expect(prd).toContain('revocation')
    expect(prd).toContain('idempotent')
    expect(prd).toContain('Acceptance')
  })

  it('chooses a GitHub App without widening the identity OAuth boundary', () => {
    const adr = read('docs/adr/0013-github-app-delivery-authority.md')

    expect(adr).toContain('状态：已接受（Accepted）')
    expect(adr).toContain('GitHub App')
    expect(adr).toContain('installation access token')
    expect(adr).toContain('单个仓库')
    expect(adr).toContain('Contents: write')
    expect(adr).toContain('Pull requests: write')
    expect(adr).toContain('签名浏览器会话')
    expect(adr).toContain('桌面 Bearer 权限不能批准')
    expect(adr).toContain('独立读取远端分支头')
    expect(adr).toContain('一小时')
    expect(adr).toContain('renderer')
    expect(adr).toContain('read:user user:email')
    expect(adr).toContain('不会合并')
    expect(adr).toContain('不会强制推送')
  })

  it('defines vertical delivery slices and blocks 2.x until the 1.x gate passes', () => {
    const plan = read('docs/plans/v1.5-github-delivery.md')

    expect(plan).toContain('## Slice 1 — Delivery Intent')
    expect(plan).toContain('## Slice 2 — Durable Approval')
    expect(plan).toContain('## Slice 3 — Repository-Scoped GitHub App Credential')
    expect(plan).toContain('## Slice 4 — Idempotent Branch Publication')
    expect(plan).toContain('## Slice 5 — Draft Pull Request')
    expect(plan).toContain('## Slice 6 — Recovery, Revocation, And Operator UX')
    expect(plan).toContain('## Slice 7 — 1.x Completion Gate')
    expect(plan).toContain('Verify credential revocation')
    expect(plan).toMatch(/renderer never\s+receives the Desktop Bearer/)
    expect(plan).toContain('2.x implementation remains blocked')
  })

  it('defines the post-revocation issuance linearization and confirmation-only quarantine guarantee', () => {
    const prd = read('docs/product/prd/v1.5-github-delivery-prd.md')
    const plan = read('docs/plans/v1.5-github-delivery.md')
    const walkthrough = read('docs/guides/devflow-studio-v1.5-walkthrough.md')

    for (const contract of [prd, plan]) {
      expect(contract).toContain('active-binding CAS')
      expect(contract).toContain('issuance linearization point')
      expect(contract).toContain('credential_revocation_pending')
      expect(contract).toContain('non-secret quarantine marker')
      expect(contract).toContain('credential-absence-or-revocation confirmation')
      expect(contract).toContain('pre-POST credential absence')
      expect(contract).toMatch(/exact-`204`\s+provider\s+revocation\s+is\s+durably\s+confirmed/u)
      expect(contract).toContain('exact `204`')
      expect(contract).toMatch(/must\s+not\s+be\s+cleared\s+by\s+elapsed\s+time/u)
      expect(contract).toContain('never persisted')
      expect(contract).not.toContain('69 minutes')
      expect(contract).not.toContain('confirmed or expired')
    }

    expect(walkthrough).toContain('credential_revocation_pending')
    expect(walkthrough).toMatch(/等待并重试\s+\*\*Verify credential revocation\*\*/u)
    expect(walkthrough).toContain('绕过隔离')
    expect(walkthrough).toContain('不声称撤销前的所有凭据都已失效')
    expect(walkthrough).toContain('撤销后的新签发')
  })

  it('indexes the scoped contract from the existing documentation entrypoints', () => {
    const prdIndex = read('docs/product/prd/README.md')
    const roadmap = read('docs/roadmap.md')

    expect(prdIndex).toContain('v1.5-github-delivery-prd.md')
    expect(roadmap).toContain('v1.5-github-delivery-prd.md')
    expect(roadmap).toContain('0013-github-app-delivery-authority.md')
    expect(roadmap).toContain('v1.5-github-delivery.md')
  })

  it('documents the bounded GitHub App setup and recoverable operator path', () => {
    const adr = read('docs/adr/0013-github-app-delivery-authority.md')
    const plan = read('docs/plans/v1.5-github-delivery.md')
    const walkthrough = read('docs/guides/devflow-studio-v1.5-walkthrough.md')
    const guide = read('docs/guides/devflow-studio-self-hosted-pilot.md')

    expect(guide).toContain('## 配置 GitHub 交付')
    expect(guide).toContain('DEVFLOW_GITHUB_APP_ID')
    expect(guide).toContain('DEVFLOW_GITHUB_APP_PRIVATE_KEY_BASE64')
    expect(guide).toContain('Contents: write')
    expect(guide).toContain('Pull requests: write')
    expect(guide).toContain('仅允许选定仓库')
    expect(guide).toContain('approval_required')
    expect(guide).toContain('recovery_required')
    expect(guide).toContain('creating_pr')
    expect(guide).toContain('绝不强制推送')
    expect(guide).toContain('绝不合并')
    expect(guide).toContain('安装访问令牌')
    expect(guide).toContain('桌面主进程内存')
    for (const contract of [adr, plan, walkthrough, guide]) {
      expect(contract).toContain('Contents: read + Pull requests: write')
    }
  })

  it('keeps Retry-After validation failures recoverable without retaining provider payloads', () => {
    const prd = read('docs/product/prd/v1.5-github-delivery-prd.md')
    const plan = read('docs/plans/v1.5-github-delivery.md')
    const walkthrough = read('docs/guides/devflow-studio-v1.5-walkthrough.md')

    for (const contract of [prd, plan, walkthrough]) {
      expect(contract).toContain('Retry-After')
      expect(contract).toContain('`github_rate_limited`')
    }
    expect(prd).toContain('Raw provider headers and bodies are never persisted')
    expect(plan).toContain('persist only the derived provider retry not-before')
    expect(plan).toMatch(/reconcile by exact\s+marker first/u)
    expect(plan).toContain('block another create before that boundary')
    expect(walkthrough).toContain('不得再次创建')
    expect(walkthrough).toContain('服务商退避期结束前')
  })

  it('separates both outbound-content boundaries and documents the only safe rebuild path', () => {
    const adr = read('docs/adr/0013-github-app-delivery-authority.md')
    const plan = read('docs/plans/v1.5-github-delivery.md')
    const walkthrough = read('docs/guides/devflow-studio-v1.5-walkthrough.md')
    const guide = read('docs/guides/devflow-studio-self-hosted-pilot.md')

    for (const contract of [adr, plan, walkthrough, guide]) {
      expect(contract).toMatch(/exact outbound Git objects|确切的出站 Git 对象/u)
      expect(contract).toMatch(/PR title and body|PR 标题和正文/u)
      expect(contract).toContain('content_scan_blocked')
      expect(contract).toMatch(/must not Resume or override|不得恢复（Resume）或覆盖/u)
      expect(contract).toMatch(/new Work Request\/Run|新的 Work Request\/Run/u)
      expect(contract).toMatch(/clean Coding Agent workspace|干净的 Coding Agent 工作空间/u)
    }
    expect(adr).toContain('在请求任何 GitHub 凭据前')
    expect(plan).toContain('durable non-secret scan receipt')
    expect(guide).toContain('Git 内容阻断发生在推送之前')
    expect(guide).toContain('PR 文本阻断可能发生在分支已发布并核验之后')
  })

  it('defines one candidate-bound V1.5 walkthrough without reusing paid-provider authority', () => {
    const walkthrough = read('docs/guides/devflow-studio-v1.5-walkthrough.md')

    expect(walkthrough).toContain('状态：稳定的操作规程；不代表任何候选已经通过验证')
    expect(walkthrough).toContain('专用的私有 GitHub 沙箱仓库')
    expect(walkthrough).toContain('一个正式 Run')
    expect(walkthrough).toContain('一个 Draft PR')
    expect(walkthrough).toContain('Revise')
    expect(walkthrough).toContain('Resume')
    expect(walkthrough).toContain('Retry')
    expect(walkthrough).toContain('Run 变为 `completed`')
    expect(walkthrough).toContain('撤销绑定')
    expect(walkthrough).toContain('Verify credential revocation')
    expect(walkthrough).toMatch(/不编写或修改 `C`/u)
    expect(walkthrough).toContain('正常 Web 与打包桌面界面')
    expect(walkthrough).toContain('不使用命令行、直接 HTTP、SQL 或 GitHub CLI')
    expect(walkthrough).toContain('credential_unexpectedly_issued')
    expect(walkthrough).toContain('docs/releases/v1.5.0/github-sandbox.json')
    expect(walkthrough).toContain('ai-devflow-studio-v15-candidate-desktop')
    expect(walkthrough).toContain('DEVFLOW_RELEASE_DESKTOP_ARTIFACT_INDEX')
    expect(walkthrough).toContain(
      '使用这一精确归档执行私有沙箱演练',
    )
    expect(walkthrough).toContain('签收只接受 `run_attempt: 1`')
    expect(walkthrough).toContain('Publish GitHub Release')
    expect(walkthrough).toContain('要求恰好七个普通文件')
    expect(walkthrough).toContain('git/ref/tags/v1.5.0')
    expect(walkthrough).toContain('desktop-artifact-trio.mjs inspect')
    expect(walkthrough).toContain('数字版本/计数')
    expect(walkthrough).not.toContain('"evidenceExists"')
    expect(walkthrough).toContain('"desktopArtifact"')
    expect(walkthrough).toContain('"intentDigest"')
    expect(walkthrough).toContain('"runVersion"')
    expect(walkthrough).toContain('"testEvidenceDigest"')
    expect(walkthrough).toContain('"prPackageDigest"')
    expect(walkthrough).toContain('"revocationProof"')
    expect(walkthrough).toContain('"proofStateVersion": 2')
    expect(walkthrough).toContain('"intentId"')
    expect(walkthrough).toContain('"revokedBindingVersion"')
    expect(walkthrough).toContain('"outcomeCode": "binding_inactive"')
    expect(walkthrough).toContain('"checkedAt"')
    expect(walkthrough).toContain('"durableCheckCount": 1')
    expect(walkthrough).toContain(
      '`github-delivery-intent-<lowercase RFC4122 v4 UUID>`',
    )
    expect(walkthrough).toContain('变体位为 `8`、`9`、`a` 或 `b`')
    expect(walkthrough).toContain('同一 UTC 日历日期')
    expect(walkthrough).toContain('且仅包含一行 `Revocation proof:`')
    expect(walkthrough).toContain('Revocation proof: state version 2;')
    expect(walkthrough).toContain('git rev-parse S^1')
    expect(walkthrough).toContain('git diff --name-only C..S')
    expect(walkthrough).toContain('release:status -- --mode=pre-tag')
    expect(walkthrough).toContain('release:status -- --mode=tagged')
    expect(walkthrough).toContain('git tag -a v1.5.0 S')
    expect(walkthrough).toContain(
      'V1.5 不授权或要求再次运行付费 OpenCode 服务商冒烟',
    )
  })
})
