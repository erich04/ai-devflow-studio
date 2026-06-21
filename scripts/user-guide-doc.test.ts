import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'

const userGuidePath = join(process.cwd(), 'docs/guides/devflow-studio-v0.8-user-guide.md')
const userGuideDir = dirname(userGuidePath)
const v1UserGuidePath = join(process.cwd(), 'docs/guides/devflow-studio-v1.0-user-guide.md')
const v1UserGuideDir = dirname(v1UserGuidePath)
const v12WalkthroughPath = join(process.cwd(), 'docs/guides/devflow-studio-v1.2-walkthrough.md')
const v12WalkthroughDir = dirname(v12WalkthroughPath)
const v13WalkthroughPath = join(process.cwd(), 'docs/guides/devflow-studio-v1.3-walkthrough.md')
const v13WalkthroughDir = dirname(v13WalkthroughPath)

function readUserGuide(): string {
  return readFileSync(userGuidePath, 'utf8')
}

function readV1UserGuide(): string {
  return readFileSync(v1UserGuidePath, 'utf8')
}

function readV12Walkthrough(): string {
  return readFileSync(v12WalkthroughPath, 'utf8')
}

function readV13Walkthrough(): string {
  return readFileSync(v13WalkthroughPath, 'utf8')
}

function extractImagePaths(markdown: string): string[] {
  return Array.from(markdown.matchAll(/!\[[^\]]*]\(([^)]+)\)/g)).map((match) => match[1])
}

describe('v0.8 user guide documentation', () => {
  it('keeps every referenced screenshot available on disk', () => {
    const markdown = readUserGuide()
    const imagePaths = extractImagePaths(markdown)

    expect(imagePaths.length).toBeGreaterThanOrEqual(8)
    expect(imagePaths).toEqual(
      expect.arrayContaining([
        './screenshots/14-electron-current-userdata-workbench.png',
        './screenshots/02-search-filter.png',
        './screenshots/05-tests-evidence.png',
        './screenshots/12-electron-knowledge.png',
        './screenshots/04-agent-workbench.png',
        './screenshots/09-coding-node.png',
        './screenshots/11-electron-team-overview.png',
        './screenshots/08-team-overview.png',
      ]),
    )

    for (const imagePath of imagePaths) {
      expect(existsSync(join(userGuideDir, imagePath))).toBe(true)
    }
  })

  it('documents the release-candidate demo and signoff workflow', () => {
    const markdown = readUserGuide()

    expect(markdown).toContain('corepack pnpm dev:electron')
    expect(markdown).toContain('Gate Enforcement')
    expect(markdown).toContain('Remediation Plan')
    expect(markdown).toContain('Retry Coding')
    expect(markdown).toContain('Knowledge Review Agent')
    expect(markdown).toContain('Team Overview')
    expect(markdown).toContain('corepack pnpm verify')
    expect(markdown).toContain('corepack pnpm build')
    expect(markdown).toContain('corepack pnpm release:status')
    expect(markdown).toContain('corepack pnpm opencode:status')
    expect(markdown).toContain('DEVFLOW_DATABASE_URL=')
    expect(markdown).toContain('238 个 unit tests')
    expect(markdown).toContain('GitHub Actions')
    expect(markdown).toContain('billing/spending-limit')
    expect(markdown).toContain('noWindowsAvailable')
    expect(markdown).toContain('Computer Use 工具层')
    expect(markdown).toContain('test:electron-smoke')
  })

  it('documents a human walkthrough checklist with concrete pass criteria', () => {
    const markdown = readUserGuide()

    expect(markdown).toContain('### 人工 walkthrough 具体核对表')
    expect(markdown).toContain('DEVFLOW_RELEASE_WALKTHROUGH=passed corepack pnpm release:status -- --strict')
    expect(markdown).toContain('| 步骤 | 入口 | 操作 | 通过标准 |')
    expect(markdown).toContain('架构 Gate')
    expect(markdown).toContain('policy source')
    expect(markdown).toContain('blocking reason')
    expect(markdown).toContain('review artifact')
    expect(markdown).toContain('permission relay')
    expect(markdown).toContain('redacted policy/remediation/retry summary')
    expect(markdown).toContain('不暴露 cwd、raw logs、prompt、patch、secret')
  })
})

describe('v1.0 hands-on user guide documentation', () => {
  it('keeps every referenced screenshot available on disk', () => {
    const markdown = readV1UserGuide()
    const imagePaths = extractImagePaths(markdown)

    expect(imagePaths.length).toBeGreaterThanOrEqual(10)
    expect(imagePaths).toEqual(
      expect.arrayContaining([
        './screenshots/14-electron-current-userdata-workbench.png',
        './screenshots/01-workbench-gate-enforcement.png',
        './screenshots/12-electron-knowledge.png',
        './screenshots/04-agent-workbench.png',
        './screenshots/09-coding-node.png',
        './screenshots/08-team-overview.png',
        './screenshots/11-electron-team-overview.png',
      ]),
    )

    for (const imagePath of imagePaths) {
      expect(existsSync(join(v1UserGuideDir, imagePath))).toBe(true)
    }
  })

  it('documents the complete v1.0 hands-on path', () => {
    const markdown = readV1UserGuide()

    expect(markdown).toContain('v1.0.0')
    expect(markdown).toContain('corepack pnpm dev:electron')
    expect(markdown).toContain('Gate Enforcement')
    expect(markdown).toContain('Remediation Plan')
    expect(markdown).toContain('Knowledge Review Agent')
    expect(markdown).toContain('Retry Coding')
    expect(markdown).toContain('Tool / Skill Timeline')
    expect(markdown).toContain('docker compose up --build')
    expect(markdown).toContain('Create desktop pairing code')
    expect(markdown).toContain('Pairing code')
    expect(markdown).toContain('同步团队')
    expect(markdown).toContain('corepack pnpm test:docker-smoke')
    expect(markdown).toContain('corepack pnpm test:postgres-smoke')
    expect(markdown).toContain('corepack pnpm opencode:status')
    expect(markdown).toContain('DEVFLOW_RUN_OPENCODE_SMOKE=1')
    expect(markdown).toContain('release-only signoff gate')
    expect(markdown).toContain('docs/plans/release-only-real-opencode-smoke.md')
    expect(markdown).toContain('ark-code-latest')
    expect(markdown).toContain('豆包/Volcengine')
  })

  it('documents safe manual walkthrough criteria and current product boundaries', () => {
    const markdown = readV1UserGuide()

    expect(markdown).toContain('| 步骤 | 入口 | 操作 | 通过标准 |')
    expect(markdown).toContain('不暴露 cwd、raw logs、prompt、patch、secret')
    expect(markdown).toContain('默认路径不花模型钱')
    expect(markdown).toContain('真实 opencode 路径会消耗 provider 配额')
    expect(markdown).toContain('当前不能保证还原 opencode 内部私有 Skill 调用栈')
    expect(markdown).toContain('Electron installer、签名、公证、自动更新')
    expect(markdown).toContain('多 Desktop 并发 hardening')
    expect(markdown).toContain('Windows Electron full smoke')
  })
})

describe('v1.2 walkthrough documentation', () => {
  it('keeps referenced screenshots available on disk', () => {
    const markdown = readV12Walkthrough()
    const imagePaths = extractImagePaths(markdown)

    expect(imagePaths.length).toBeGreaterThanOrEqual(6)
    expect(imagePaths).toEqual(
      expect.arrayContaining([
        './screenshots/14-electron-current-userdata-workbench.png',
        './screenshots/01-workbench-gate-enforcement.png',
        './screenshots/12-electron-knowledge.png',
        './screenshots/04-agent-workbench.png',
        './screenshots/09-coding-node.png',
        './screenshots/08-team-overview.png',
        './screenshots/11-electron-team-overview.png',
      ]),
    )

    for (const imagePath of imagePaths) {
      expect(existsSync(join(v12WalkthroughDir, imagePath))).toBe(true)
    }
  })

  it('documents the current v1.2 manual walkthrough path', () => {
    const markdown = readV12Walkthrough()

    expect(markdown).toContain('v1.2.0')
    expect(markdown).toContain('corepack pnpm dev:electron')
    expect(markdown).toContain('Gate Enforcement')
    expect(markdown).toContain('Knowledge Review Agent')
    expect(markdown).toContain('Tool / Skill Timeline')
    expect(markdown).toContain('Runtime Budget')
    expect(markdown).toContain('Budget Approval')
    expect(markdown).toContain('Retry with approval')
    expect(markdown).toContain('Create desktop pairing code')
    expect(markdown).toContain('DEVFLOW_RUN_OPENCODE_SMOKE=1')
    expect(markdown).toContain('ark-code-latest')
    expect(markdown).toContain('豆包/Volcengine')
    expect(markdown).toContain('DEVFLOW_RELEASE_WALKTHROUGH=passed corepack pnpm release:status -- --strict')
  })

  it('documents safety boundaries for costs, secrets, and opencode skill visibility', () => {
    const markdown = readV12Walkthrough()

    expect(markdown).toContain('默认 walkthrough 不花模型钱')
    expect(markdown).toContain('真实 `opencode` + 豆包/Volcengine smoke 会产生真实模型调用')
    expect(markdown).toContain('不应泄露本地绝对路径、raw stdout/stderr 或 secret')
    expect(markdown).toContain('当前不能保证还原 opencode 内部私有 Skill 调用栈')
    expect(markdown).toContain('不要说真实 opencode 是默认 CI/verify 路径')
    expect(markdown).toContain('不要说 MCP 真执行 / MCP policy enforcement 已完成')
  })
})

describe('v1.3 delivery walkthrough documentation', () => {
  it('keeps referenced screenshots available on disk', () => {
    const markdown = readV13Walkthrough()
    const imagePaths = extractImagePaths(markdown)

    expect(imagePaths.length).toBeGreaterThanOrEqual(5)
    expect(imagePaths).toEqual(
      expect.arrayContaining([
        './screenshots/14-electron-current-userdata-workbench.png',
        './screenshots/01-workbench-gate-enforcement.png',
        './screenshots/09-coding-node.png',
        './screenshots/05-tests-evidence.png',
        './screenshots/08-team-overview.png',
      ]),
    )

    for (const imagePath of imagePaths) {
      expect(existsSync(join(v13WalkthroughDir, imagePath))).toBe(true)
    }
  })

  it('documents the request-to-delivery workflow path', () => {
    const markdown = readV13Walkthrough()

    expect(markdown).toContain('v1.3 delivery-flow candidate')
    expect(markdown).toContain('从真实用户需求创建 Workflow Run')
    expect(markdown).toContain('clarify -> design -> build -> test -> pr -> accept')
    expect(markdown).toContain('Raw request')
    expect(markdown).toContain('选择 Clarification Gate')
    expect(markdown).toContain('生成 PR Draft')
    expect(markdown).toContain('生成验收证据包')
    expect(markdown).toContain('Acceptance Bundle')
    expect(markdown).toContain('Run completed')
    expect(markdown).toContain('DEVFLOW_RUN_OPENCODE_SMOKE=1')
  })

  it('documents v1.3 delivery boundaries', () => {
    const markdown = readV13Walkthrough()

    expect(markdown).toContain('当前 v1.3 只生成 PR handoff artifact，不创建真实 GitHub PR')
    expect(markdown).toContain('不包含 raw patch body')
    expect(markdown).toContain('不泄露 provider key')
    expect(markdown).toContain('不要说 v1.3 已创建真实 GitHub PR')
    expect(markdown).toContain('不要说系统会自动 push、merge 或自动通过 Gate')
    expect(markdown).toContain('不要说 MCP 真执行 / MCP policy enforcement 已完成')
  })
})
