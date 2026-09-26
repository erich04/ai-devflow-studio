import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const contractPath = join(
  process.cwd(),
  'docs/research/2026-06-19-opencode-runtime-contract-refresh.md',
)
const forbiddenSecretSentinels = [
  'volcengine-secret',
  '00000000-0000-4000-8000-000000000000',
  '11111111-2222-4333-8444-555555555555',
]

describe('opencode runtime contract refresh documentation', () => {
  it('records the latest provider-safe status re-check and current live smoke evidence', () => {
    const markdown = readFileSync(contractPath, 'utf8')

    expect(markdown).toContain('2026-06-20 复查')
    expect(markdown).toContain('corepack pnpm opencode:status')
    expect(markdown).toContain('PR #3 head `ec878e5`')
    expect(markdown).toContain('本地二进制仍报告 `1.17.5`')
    expect(markdown).toContain('默认禁用真实 OpenCode 冒烟')
    expect(markdown).toContain('避免 verify 意外调用服务商')
    expect(markdown).toContain('opencode smoke passed; changed paths: devflow-opencode-smoke.txt')
    expect(markdown).toContain('v0.9.0 发布后真实冒烟')
    expect(markdown).toContain('约 1 分 38 秒')
  })

  it('documents the Volcengine Ark provider profile with a local config and explicit live gate', () => {
    const markdown = readFileSync(contractPath, 'utf8')

    expect(markdown).toContain('### 服务商配置模板：不含秘密')
    expect(markdown).toContain('DEVFLOW_RUN_OPENCODE_SMOKE=1')
    expect(markdown).toContain('DEVFLOW_CODING_ENGINE=opencode-http')
    expect(markdown).toContain('DEVFLOW_OPENCODE_BIN=/opt/homebrew/bin/opencode')
    expect(markdown).toContain('DEVFLOW_OPENCODE_PROVIDER_ID=double')
    expect(markdown).toContain('DEVFLOW_OPENCODE_MODEL_ID=ark-code-latest')
    expect(markdown).toContain('DEVFLOW_OPENCODE_API_KEY_ENV=ARK_API_KEY')
    expect(markdown).toContain('ARK_API_KEY="<set in shell only; never commit>"')
    expect(markdown).toContain('https://ark.cn-beijing.volces.com/api/coding/v3')
    expect(markdown).toContain('@ai-sdk/openai-compatible')
    expect(markdown).toContain('2026-08-09 V1.4 发布更新')
    expect(markdown).toContain('@ai-sdk/openai`，使 OpenCode 使用 Responses API')
    expect(markdown).toContain('provider_retry_observed')
    expect(markdown).toContain('不得将服务商密钥')

    for (const sentinel of forbiddenSecretSentinels) {
      expect(markdown).not.toContain(sentinel)
    }
  })

  it('keeps live provider smoke explicitly gated while preserving the V1.4 contract record', () => {
    const checklist = readFileSync(
      join(process.cwd(), 'docs/knowledge/checklists/opencode-runtime-signoff.md'),
      'utf8',
    )
    const releaseGate = readFileSync(
      join(process.cwd(), 'docs/plans/release-only-real-opencode-smoke.md'),
      'utf8',
    )
    const v14ReleasePlan = readFileSync(
      join(process.cwd(), 'docs/plans/v1.4-release-signoff.md'),
      'utf8',
    )

    expect(checklist).toContain('将真实 OpenCode 冒烟测试排除在 `corepack pnpm verify`')
    expect(checklist).toContain('只有在自身发布契约明确要求')
    expect(checklist).toContain('与候选版本绑定的单独授权')
    expect(checklist).toContain('V1.5 不要求也不授权再次进行付费模型冒烟测试')
    expect(checklist).not.toContain('For every future product release')
    expect(checklist).toContain('corepack pnpm --silent test:opencode-smoke')

    expect(releaseGate).toContain('只有当前发布契约明确要求')
    expect(releaseGate).toContain('DEVFLOW_RUN_OPENCODE_SMOKE=1')
    expect(releaseGate).toContain('DEVFLOW_CODING_ENGINE=opencode-http')
    expect(releaseGate).toContain('DEVFLOW_OPENCODE_PROVIDER_ID=double')
    expect(releaseGate).toContain('DEVFLOW_OPENCODE_MODEL_ID=ark-code-latest')
    expect(releaseGate).toContain('ANTHROPIC_AUTH_TOKEN="<set in shell only; never commit>"')
    expect(releaseGate).toContain('必须记录的证据')
    expect(releaseGate).toContain('受管工作树已删除，或 cleanup_failed')
    expect(releaseGate).toContain('docs/releases/v1.4.0/real-opencode.json')
    expect(releaseGate).toContain('"attemptCount": 1')
    expect(releaseGate).toContain('"automaticRetry": false')
    expect(releaseGate).toContain('"costCapUsd": null')
    expect(releaseGate).toContain('不设置硬性服务商费用上限')
    expect(releaseGate).toContain('corepack pnpm --silent test:opencode-smoke')
    expect(releaseGate).toContain('候选拥有的 Responses API 配置')
    expect(releaseGate).toContain('provider_retry_observed')
    expect(releaseGate).toContain('240 秒权限发现期限')
    expect(releaseGate).toContain('持有凭据的出站门禁')
    expect(releaseGate).toContain('精确允许三段获额度请求')
    expect(releaseGate).toContain('仅 bash、仅 edit、仅完成')
    expect(releaseGate.replace(/\s+/g, ' ')).toContain('未获额度拦截、无效请求、失败段均为 0')
    expect(releaseGate).toContain('精确转交两次真实权限')
    expect(releaseGate).toContain('corepack pnpm --silent opencode:release-preflight')
    expect(releaseGate).toContain('不是整个冒烟限时 240 秒')
    expect(releaseGate).toContain('"providerApiMode": "responses"')
    expect(releaseGate).toContain('"resolvedConfigPreflight": "passed"')
    expect(releaseGate).toContain('"armedSegmentCount": 3')
    expect(releaseGate).toContain('"forwardedRequestCount": 3')
    expect(releaseGate).toContain('"completedResponseCount": 3')
    expect(releaseGate).toContain('"blockedUncreditedRequestCount": 0')
    expect(v14ReleasePlan).toContain('精确允许三段获额度的提供方请求')
    expect(v14ReleasePlan).toContain('仅 bash、仅 edit、仅完成')
    expect(v14ReleasePlan).toContain('corepack pnpm --silent test:opencode-smoke')
    expect(v14ReleasePlan).toContain('"armedSegmentCount": 3')
    expect(v14ReleasePlan).toContain('"forwardedRequestCount": 3')
    expect(v14ReleasePlan).toContain('"completedResponseCount": 3')
    expect(v14ReleasePlan).not.toContain('between two and five')
    expect(releaseGate).toContain(
      '第二次顶层付费冒烟必须先有实质修改后的新候选及新的明确授权',
    )
    for (const sentinel of forbiddenSecretSentinels) {
      expect(releaseGate).not.toContain(sentinel)
    }
  })
})
