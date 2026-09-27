import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const signoffPath = join(process.cwd(), 'docs/plans/v0.8.1-release-signoff.md')

describe('v0.8.1 release signoff documentation', () => {
  it('keeps the manual walkthrough gate honest about Computer Use limitations', () => {
    const markdown = readFileSync(signoffPath, 'utf8')

    expect(markdown).toContain('人工逐项操作')
    expect(markdown).toContain('已用电脑控制读取 AI DevFlow Studio 真实窗口')
    expect(markdown).toContain('blocked_policy_unavailable')
    expect(markdown).toContain('处理计划')
    expect(markdown).toContain('noWindowsAvailable')
    expect(markdown).toContain('以下人工操作待完成')
    expect(markdown).toContain('corepack pnpm test:e2e')
    expect(markdown).toContain('corepack pnpm test:electron-smoke')
    expect(markdown).toContain('不能替代该标签的最终人工验收')
  })
})
