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
const fullFeatureWalkthroughPath = join(process.cwd(), 'docs/guides/devflow-studio-full-feature-walkthrough.md')
const fullFeatureWalkthroughDir = dirname(fullFeatureWalkthroughPath)

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

function readFullFeatureWalkthrough(): string {
  return readFileSync(fullFeatureWalkthroughPath, 'utf8')
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
    expect(markdown).toContain('238 个单元测试')
    expect(markdown).toContain('GitHub Actions')
    expect(markdown).toContain('billing/spending-limit')
    expect(markdown).toContain('noWindowsAvailable')
    expect(markdown).toContain('Computer Use 工具层')
    expect(markdown).toContain('test:electron-smoke')
  })

  it('documents a human walkthrough checklist with concrete pass criteria', () => {
    const markdown = readUserGuide()

    expect(markdown).toContain('### 人工演练具体核对表')
    expect(markdown).toContain('DEVFLOW_RELEASE_WALKTHROUGH=passed corepack pnpm release:status -- --strict')
    expect(markdown).toContain('| 步骤 | 入口 | 操作 | 通过标准 |')
    expect(markdown).toContain('方案评审 Gate')
    expect(markdown).toContain('策略来源')
    expect(markdown).toContain('阻断原因')
    expect(markdown).toContain('审查产物')
    expect(markdown).toContain('权限转发')
    expect(markdown).toContain('脱敏的策略、处理建议和重试摘要')
    expect(markdown).toContain('不暴露工作目录、原始日志、提示词、补丁、密钥')
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
    expect(markdown).toContain('处理建议计划')
    expect(markdown).toContain('知识审查 Agent')
    expect(markdown).toContain('Retry Coding')
    expect(markdown).toContain('工具与技能时间线')
    expect(markdown).toContain('docker compose up --build')
    expect(markdown).toContain('Create desktop pairing code')
    expect(markdown).toContain('Pairing code')
    expect(markdown).toContain('同步团队')
    expect(markdown).toContain('corepack pnpm test:docker-smoke')
    expect(markdown).toContain('corepack pnpm test:postgres-smoke')
    expect(markdown).toContain('corepack pnpm opencode:status')
    expect(markdown).toContain('DEVFLOW_RUN_OPENCODE_SMOKE=1')
    expect(markdown).toContain('仅发布时执行的验收门禁')
    expect(markdown).toContain('docs/plans/release-only-real-opencode-smoke.md')
    expect(markdown).toContain('ark-code-latest')
    expect(markdown).toContain('豆包/Volcengine')
  })

  it('documents safe manual walkthrough criteria and current product boundaries', () => {
    const markdown = readV1UserGuide()

    expect(markdown).toContain('| 步骤 | 入口 | 操作 | 通过标准 |')
    expect(markdown).toContain('不暴露工作目录、原始日志、提示词、补丁、密钥')
    expect(markdown).toContain('默认路径不花模型钱')
    expect(markdown).toContain('真实 OpenCode 路径会消耗模型服务商配额')
    expect(markdown).toContain('当前不能保证还原 OpenCode 内部私有技能调用栈')
    expect(markdown).toContain('Electron 安装器、签名、公证、自动更新')
    expect(markdown).toContain('多桌面端并发加固')
    expect(markdown).toContain('Windows Electron 完整冒烟')
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
    expect(markdown).toContain('门禁策略执行')
    expect(markdown).toContain('知识审查 Agent')
    expect(markdown).toContain('工具与技能时间线')
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

    expect(markdown).toContain('默认演练不花模型钱')
    expect(markdown).toContain('真实 `opencode` + 豆包/Volcengine 冒烟测试会产生真实模型调用')
    expect(markdown).toContain('不应泄露本地绝对路径、原始标准输出/错误或密钥')
    expect(markdown).toContain('当前不能保证还原 OpenCode 内部私有技能调用栈')
    expect(markdown).toContain('不要说真实 OpenCode 是默认 CI/验证路径')
    expect(markdown).toContain('不要说 MCP 真执行 / MCP 策略执行已完成')
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
    expect(markdown).toContain('从真实用户需求创建工作流实例')
    expect(markdown).toContain('clarify -> design -> build -> test -> pr -> accept')
    expect(markdown).toContain('Raw request')
    expect(markdown).toContain('选择需求确认门禁')
    expect(markdown).toContain('生成 PR Draft')
    expect(markdown).toContain('生成验收证据包')
    expect(markdown).toContain('Acceptance Bundle')
    expect(markdown).toContain('工作流实例已完成')
    expect(markdown).toContain('DEVFLOW_RUN_OPENCODE_SMOKE=1')
  })

  it('documents v1.3 delivery boundaries', () => {
    const markdown = readV13Walkthrough()

    expect(markdown).toContain('当前 v1.3 只生成 PR 交接产物，不创建真实 GitHub PR')
    expect(markdown).toContain('不包含原始补丁正文')
    expect(markdown).toContain('不泄露模型服务商密钥')
    expect(markdown).toContain('不要说 v1.3 已创建真实 GitHub PR')
    expect(markdown).toContain('不要说系统会自动推送、合并或自动通过门禁')
    expect(markdown).toContain('不要说 MCP 真执行 / MCP 策略执行已完成')
  })
})

describe('full feature walkthrough documentation', () => {
  it('keeps referenced screenshots available on disk', () => {
    const markdown = readFullFeatureWalkthrough()
    const imagePaths = extractImagePaths(markdown)

    expect(imagePaths.length).toBeGreaterThanOrEqual(7)
    expect(imagePaths).toEqual(
      expect.arrayContaining([
        './screenshots/14-electron-current-userdata-workbench.png',
        './screenshots/01-workbench-gate-enforcement.png',
        './screenshots/12-electron-knowledge.png',
        './screenshots/04-agent-workbench.png',
        './screenshots/09-coding-node.png',
        './screenshots/05-tests-evidence.png',
        './screenshots/11-electron-team-overview.png',
        './screenshots/08-team-overview.png',
        './screenshots/07-mcp-management.png',
      ]),
    )

    for (const imagePath of imagePaths) {
      expect(existsSync(join(fullFeatureWalkthroughDir, imagePath))).toBe(true)
    }
  })

  it('documents the full current product surface by module', () => {
    const markdown = readFullFeatureWalkthrough()

    expect(markdown).toContain('DevFlow Studio 全量基础功能体验指南')
    expect(markdown).toContain('工作台')
    expect(markdown).toContain('Team Overview')
    expect(markdown).toContain('Knowledge')
    expect(markdown).toContain('Agents')
    expect(markdown).toContain('Skills')
    expect(markdown).toContain('MCP')
    expect(markdown).toContain('测试')
    expect(markdown).toContain('Runtime Budget')
    expect(markdown).toContain('桌面配对')
    expect(markdown).toContain('Tool / Skill Timeline')
    expect(markdown).toContain('PR Draft')
    expect(markdown).toContain('验收证据包')
    expect(markdown).toContain('修复重试')
  })

  it('documents executable commands and safety boundaries for a no-cost walkthrough', () => {
    const markdown = readFullFeatureWalkthrough()

    expect(markdown).toContain('corepack pnpm dev:api')
    expect(markdown).toContain('corepack pnpm dev:web')
    expect(markdown).toContain('corepack pnpm dev:electron')
    expect(markdown).toContain('默认路径不调用真实付费模型')
    expect(markdown).toContain('DEVFLOW_RUN_OPENCODE_SMOKE=1')
    expect(markdown).toContain('DEVFLOW_AGENT_OPENAI_BASE_URL=https://ark.cn-beijing.volces.com/api/coding/v3')
    expect(markdown).toContain('门禁审查模型凭证')
    expect(markdown).toContain('门禁审查模型 Provider')
    expect(markdown).toContain('ark-code-latest')
    expect(markdown).toContain('豆包/Volcengine')
    expect(markdown).toContain('不保存原始标准输出/错误')
    expect(markdown).toContain('不创建真实 GitHub PR')
    expect(markdown).toContain('不要说 MCP 真执行 / MCP 策略执行已完成')
    expect(markdown).toContain('不要说 Windows Electron 完整冒烟已完成')
  })

  it('is linked from the README demo guide list', () => {
    const readme = readFileSync(join(process.cwd(), 'README.md'), 'utf8')

    expect(readme).toContain('完整功能演练')
    expect(readme).toContain('docs/guides/devflow-studio-full-feature-walkthrough.md')
  })
})
