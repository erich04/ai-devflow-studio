import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('release README truth', () => {
  it('distinguishes the published V2.3 package from subsequent main-source changes', () => {
    const readme = readFileSync('README.md', 'utf8')

    expect(readme).toContain('最新已发布版本是')
    expect(readme).toContain('`v2.3.0`')
    expect(readme).toContain('releases/tag/v2.3.0')
    expect(readme).toContain('当前 `main` 源码')
    expect(readme).toContain('已发布安装包不会自动包含后续源码变化')
    expect(readme).toContain('docs/releases/v2.3.0/notes.md')
    expect(readme).toContain('候选版本验证、正式验收和已发布安装包分别记录')
    expect(readme).toContain('Delivery Intent')
    expect(readme).toContain('独立签名的 Web 批准')
    expect(readme).toContain('GitHub App')
    expect(readme).toContain('Draft pull request')
    expect(readme).toContain('永不合并代码')
    expect(readme).not.toContain('GitHub 交付集成尚未实现')
    expect(readme).not.toContain(
      'PR 阶段仅生成交接产物，不具备真实 GitHub 发布能力。',
    )
  })

  it('indexes delivery verification and the current product boundaries', () => {
    const readme = readFileSync('README.md', 'utf8')

    expect(readme).toContain('corepack pnpm test:v15-github-delivery')
    expect(readme).toContain('corepack pnpm test:v15-github-delivery-packaged-smoke')
    expect(readme).toContain('docs/guides/devflow-studio-v1.5-walkthrough.md')
    expect(readme).toContain('可信本地 stdio MCP')
    expect(readme).toContain('作用范围、修订版本、过期和删除状态')
    expect(readme).toContain('尚未实现每次 Coding Run 后自动学习')
    expect(readme).toContain('DEVFLOW_MULTI_ORGANIZATION_ENABLED=true')
    expect(readme).toContain('默认入门流程仍为单团队模式')
    expect(readme).toContain('历史 `/legacy-shell` 地址会重定向')
    expect(readme).toContain('docs/engineering/testing-strategy.md')
  })
})
