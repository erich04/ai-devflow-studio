import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const roadmapPath = join(process.cwd(), 'docs/roadmap.md')
const releaseEvidencePaths = [
  'docs/releases/v1.5.0/walkthrough.json',
  'docs/releases/v1.5.0/required-gates.json',
  'docs/releases/v1.5.0/github-sandbox.json',
]
const hasV20CompletionEvidence = existsSync(
  join(process.cwd(), 'docs/releases/v2.0.0/required-gates.json'),
) && existsSync(
  join(process.cwd(), 'docs/releases/v2.0.0/agent-runtime-evaluation.json'),
)
const hasV21CompletionEvidence = existsSync(
  join(process.cwd(), 'docs/releases/v2.1.0/required-gates.json'),
) && existsSync(
  join(process.cwd(), 'docs/releases/v2.1.0/retrieval-memory-evaluation.json'),
)
const hasV22CompletionEvidence = existsSync(
  join(process.cwd(), 'docs/releases/v2.2.0/required-gates.json'),
) && existsSync(
  join(process.cwd(), 'docs/releases/v2.2.0/multi-agent-evaluation.json'),
)

describe('product roadmap source of truth', () => {
  it('keeps one roadmap with explicit major-version charters', () => {
    const markdown = readFileSync(roadmapPath, 'utf8')

    expect(markdown).toContain('唯一事实来源')
    expect(markdown).toContain('## 产品方向')
    expect(markdown).toContain('## 大版本范围')
    expect(markdown).toContain('小团队自行托管的 AI 开发流程工作台')
    expect(markdown).toContain('| 0.x | 工程基础')
    expect(markdown).toContain('| 1.x | 受治理的自托管交付')
    expect(markdown).toContain('| 2.x | DevFlow 原生 Agent 运行时')
    expect(markdown).toContain('不建并行路线图')
  })

  it('records the released v1.5 truth instead of the former candidate state', () => {
    const markdown = readFileSync(roadmapPath, 'utf8')
    const currentRelease = markdown.match(
      /## 当前发布[\s\S]*?(?=\n## (?:当前 \/ 下一步 \/ 后续|已完成里程碑))/u,
    )?.[0]

    expect(currentRelease).toBeDefined()
    expect([...markdown.matchAll(/^## 当前发布$/gmu)]).toHaveLength(1)
    expect([...markdown.matchAll(/^### 当前：/gmu)]).toHaveLength(1)
    expect(currentRelease).toContain('`v2.3.0` 是已发布基线')
    expect(currentRelease).toContain('docs/releases/v2.3.0/release-*')
    expect(currentRelease).toContain('3b50144b473595d9764139068e312224a393bd82')
    expect(currentRelease).toContain('9cec16052149c2a11749f28458152e423bca260b')
    expect(currentRelease).not.toContain('V2.3 候选签收中')
    expect(currentRelease).toContain('docs/releases/v1.5.0/')
    expect(currentRelease).toContain('f461f9d9de300b8e4a15fe31be8f518bde37b2b8')
    expect(currentRelease).toContain('bd7de6f82c3a60092816bd947f5590e9f148c3ae')
    expect(currentRelease).not.toContain('`v1.4.0` 是已发布基线')
    expect(currentRelease).not.toContain('发布和 1.x 完成门禁仍待完成')

    for (const name of ['required-gates', 'walkthrough', 'github-sandbox']) {
      const evidence = JSON.parse(readFileSync(
        join(process.cwd(), 'docs/releases/v2.3.0/release-' + name + '.json'), 'utf8',
      )) as { candidateSha?: unknown; status?: unknown }
      expect(evidence.candidateSha).toBe('9cec16052149c2a11749f28458152e423bca260b')
      expect(evidence.status).toBe('passed')
    }

    for (const relativePath of releaseEvidencePaths) {
      const evidence = JSON.parse(readFileSync(join(process.cwd(), relativePath), 'utf8')) as {
        candidateSha?: unknown
        status?: unknown
      }

      expect(evidence.candidateSha).toBe('f461f9d9de300b8e4a15fe31be8f518bde37b2b8')
      expect(evidence.status).toBe('passed')
    }
  })

  it('separates one-shot model work, the Agent Runtime, and coding executors', () => {
    const markdown = readFileSync(roadmapPath, 'utf8')
    const executionModel = markdown.match(
      /## 2\.x Agent 执行模型[\s\S]*?(?=\n## 2\.x 规划里程碑)/u,
    )?.[0]

    expect(executionModel).toBeDefined()
    expect(executionModel).toContain('单次 LLM 操作')
    expect(executionModel).toContain('DevFlow Agent 运行时')
    expect(executionModel).toContain('编码执行器')
    expect(executionModel).toContain('确定性工作流仍是外层权威')
    expect(executionModel).toContain('OpenCode')
    expect(executionModel).toContain('自有编码 Agent')
    expect(executionModel).toContain('其他 CLI 适配器')
    expect(executionModel).toContain('是候选，不是已承诺集成')
    expect(executionModel).toContain('本身不足以满足 V2.2 多 Agent 声明')
    expect(executionModel).toContain('明确演进并替代 ADR 0009')
  })

  it('defines finite 1.x and 2.x lines with the Agent Runtime direction', () => {
    const markdown = readFileSync(roadmapPath, 'utf8')

    expect(markdown).toContain('## 当前 / 下一步 / 后续')
    expect(markdown).toContain('## 1.x 完成门禁')
    expect(markdown).toContain('## 2.x 规划里程碑')
    expect(markdown).toContain('### v2.0：原生 Agent 运行时基础')
    expect(markdown).toContain('### v2.1：经评估的检索与记忆')
    expect(markdown).toContain('### v2.2：多 Agent 与执行租户隔离')
    expect(markdown).toContain('## 2.x 完成门禁')
    expect(markdown).toContain(
      'V1.5 和有限 1.x 线已发布并完成',
    )
    if (hasV22CompletionEvidence) {
      expect(markdown).toContain('### 当前：验证并交付已报告问题的修复')
      expect(markdown).toContain('| 2.x | DevFlow 原生 Agent 运行时')
      expect(markdown).toContain('V2.2 完成。')
    } else if (hasV21CompletionEvidence) {
      expect(markdown).toMatch(/^### 当前： .*V2\.2/gmu)
    } else if (hasV20CompletionEvidence) {
      expect(markdown).toMatch(/^### 当前： .*V2\.1/gmu)
    } else {
      expect(markdown).toContain('### 当前： 执行 V2.0 评估与完成门禁')
    }
    expect(markdown).not.toContain('绑定候选的切片 7 完成门禁仍在进行')
    expect(markdown).toContain('v1.5-github-delivery-prd.md')
    expect(markdown).toContain('0013-github-app-delivery-authority.md')
    expect(markdown).toContain('公共 SaaS、计费、企业 SSO')
    expect(markdown).not.toContain('### v1.6 候选：')
    expect(markdown).not.toContain('### v1.7 候选：')
  })

  it('records V1.5 as released and keeps exactly one 2.x active priority', () => {
    const markdown = readFileSync(roadmapPath, 'utf8')
    const currentRelease = markdown.match(
      /## 当前发布[\s\S]*?(?=\n## 当前 \/ 下一步 \/ 后续)/u,
    )?.[0]
    const priorities = markdown.match(
      /## 当前 \/ 下一步 \/ 后续[\s\S]*?(?=\n## 已完成里程碑)/u,
    )?.[0]

    expect(currentRelease).toContain('`v2.3.0` 是已发布基线')
    expect(currentRelease).toContain('有限 1.x 产品线已完成')
    expect(currentRelease).not.toContain('发布和 1.x 完成门禁仍待完成')
    if (hasV22CompletionEvidence) {
      expect(priorities).toContain('### 当前：验证并交付已报告问题的修复')
      expect(priorities).toContain('V2.0、V2.1 和 V2.2 均已完成')
      expect(priorities).toContain('docs/releases/v2.2.0/')
      expect(priorities).toContain('另行发布的 `v2.2.0`')
      expect(priorities).toContain('docs/plans/v2.2-release-signoff.md')
      expect(priorities).toContain('不自动发布后续 2.x 功能里程碑')
    } else if (hasV21CompletionEvidence) {
      expect(priorities).toMatch(/^### 当前： .*V2\.2/gmu)
      expect(priorities).toContain('V2.0 已完成')
      expect(priorities).toContain('V2.1 切片 1–6 已完成')
      expect(priorities).toContain('docs/releases/v2.1.0/')
    } else if (hasV20CompletionEvidence) {
      expect(priorities).toMatch(/^### 当前： .*V2\.1/gmu)
      expect(priorities).toContain('V2.0 已完成')
      expect(priorities).toContain('V2.1 切片 1–6 已完成')
    } else {
      expect(priorities).toContain('### 当前： 执行 V2.0 评估与完成门禁')
      expect(priorities).toContain('切片 1–7 已完成')
      expect(priorities).toMatch(/切片 7\s*已完成/)
      expect(priorities).toContain(
        '### 下一步：V2.0 完成后启动 V2.1 经评估检索与记忆',
      )
    }
    expect(markdown).not.toContain('当前 V1.4 运行时已实现每一层')
    expect(currentRelease).toContain('真实私有 GitHub 沙箱')
    expect(markdown).toContain('### v1.5：GitHub 交付集成')
    expect(markdown).not.toContain('已实现里程碑等待发布')
    expect(markdown).not.toContain('2.x 实施仍被阻断')
    expect(markdown).not.toContain('v1.5 已计划')
    expect(markdown).not.toContain('实施前决定 GitHub App 或限定用户令牌')
  })
})
