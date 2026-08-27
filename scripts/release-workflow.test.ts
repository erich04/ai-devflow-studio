import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const releaseWorkflowPath = join(process.cwd(), '.github/workflows/release.yml')
const verifyWorkflowPath = join(process.cwd(), '.github/workflows/verify.yml')

function readWorkflow(path: string) {
  return readFileSync(path, 'utf8').replace(/\r\n?/g, '\n')
}

function jobBlock(workflow: string, jobId: string) {
  const marker = `  ${jobId}:\n`
  const start = workflow.indexOf(marker)
  if (start < 0) {
    throw new Error(`Missing workflow job: ${jobId}`)
  }

  const contentStart = start + marker.length
  const remaining = workflow.slice(contentStart)
  const nextJob = remaining.match(/^  [a-zA-Z0-9_-]+:\n/m)
  const end = nextJob?.index === undefined ? workflow.length : contentStart + nextJob.index
  return workflow.slice(start, end)
}

describe('GitHub release workflow', () => {
  it('runs every deterministic release gate before publishing artifacts', () => {
    expect(existsSync(releaseWorkflowPath)).toBe(true)

    const workflow = readWorkflow(releaseWorkflowPath)

    expect(workflow).toContain('name: Release')
    expect(workflow).toContain('workflow_dispatch:')
    expect(workflow).toContain('tags:')
    expect(workflow).toContain("'v*'")
    expect(workflow).toContain('contents: read')
    expect(workflow).toContain('actions: read')
    expect(workflow).toContain('corepack pnpm verify')
    expect(workflow).toContain('corepack pnpm audit:production')
    expect(workflow).toContain('corepack pnpm build')
    expect(workflow).toContain('corepack pnpm test:build-output-smoke')
    expect(workflow).toContain('corepack pnpm test:e2e')
    expect(workflow).toContain('corepack pnpm test:electron-smoke')
    expect(workflow).toContain('corepack pnpm test:postgres-smoke')
    expect(workflow).toContain('corepack pnpm test:v15-github-delivery')
    expect(workflow).toContain(
      'dbus-run-session -- node scripts/run-v15-packaged-smoke-linux.mjs',
    )
    expect(workflow).toContain('corepack pnpm test:docker-smoke')
    expect(workflow).toContain('corepack pnpm test:docker-lifecycle-smoke')
    expect(workflow).toContain('corepack pnpm build:desktop-pilot')
    expect(workflow).toContain('corepack pnpm test:desktop-pilot-smoke')
    expect(workflow).toContain('windows-compatibility:')
    expect(workflow).toContain('runs-on: windows-latest')
    expect(workflow).toContain('--mode=pre-tag')
    expect(workflow).toContain('--mode=tagged')
    expect(workflow).toContain('actions/upload-artifact@v7')
    expect(workflow).toContain('gh release create')
    expect(workflow).toContain('gh release upload')
    expect(workflow).not.toContain('DEVFLOW_RUN_OPENCODE_SMOKE=1')
    expect(workflow).not.toContain('test:opencode-smoke')
  })

  it('checks out full completion history and the exact annotated tag object', () => {
    const workflow = readWorkflow(releaseWorkflowPath)
    const windowsJob = jobBlock(workflow, 'windows-compatibility')
    const artifactsJob = jobBlock(workflow, 'release-artifacts')

    expect(windowsJob).toMatch(
      /- uses: actions\/checkout@v5\n\s+with:\n\s+fetch-depth: 0[\s\S]*?corepack pnpm test/,
    )
    expect(artifactsJob).toMatch(
      /- uses: actions\/checkout@v5\n\s+with:\n\s+ref: \$\{\{ github\.ref \}\}\n\s+fetch-depth: 0[\s\S]*?release:status/,
    )
    expect(artifactsJob).not.toContain('fetch-tags: true')
  })

  it('uses a slash-safe artifact label for manual branch dispatches', () => {
    const workflow = readWorkflow(releaseWorkflowPath)

    expect(workflow).toContain('VERSION="$(node scripts/release-artifact-label.mjs)"')
    expect(workflow).not.toContain('VERSION="${GITHUB_REF_NAME:-manual-${GITHUB_RUN_NUMBER}}"')
  })

  it('refuses a manual Release dispatch that is not attached to the recorded signoff commit', () => {
    const workflow = readWorkflow(releaseWorkflowPath)
    const artifactsJob = jobBlock(workflow, 'release-artifacts')

    expect(artifactsJob).toContain('Require exact signoff checkout')
    expect(artifactsJob).toContain('git rev-parse HEAD')
    expect(artifactsJob).toContain('"$(git rev-parse HEAD)" = "${GITHUB_SHA}"')
    expect(artifactsJob).toContain('git rev-parse "v${TARGET_VERSION}^{commit}"')
    expect(artifactsJob).toContain('Manual Release dispatch must use the annotated version tag ref')
  })

  it('publishes the executable Desktop pilot archive and its integrity manifest', () => {
    const workflow = readWorkflow(releaseWorkflowPath)
    const artifactsJob = jobBlock(workflow, 'release-artifacts')

    expect(artifactsJob).toContain('actions/download-artifact@v8')
    expect(artifactsJob).toContain('node scripts/validate-release-verify-run.mjs')
    expect(artifactsJob).toContain('id: recorded-verify')
    expect(artifactsJob).toContain('run-id: ${{ steps.recorded-verify.outputs.run-id }}')
    expect(artifactsJob).not.toContain('fs.readFileSync')
    expect(artifactsJob).not.toContain('Resolve exact-SHA candidate Desktop artifact')
    expect(artifactsJob).toContain('name: ai-devflow-studio-v22-candidate-desktop')
    expect(artifactsJob).toContain(
      'docs/releases/v2.2.0/release-required-gates.json',
    )
    expect(artifactsJob).toContain('path: out/release-candidate-desktop')
    expect(artifactsJob).toContain(
      'DEVFLOW_RELEASE_DESKTOP_ARTIFACT_INDEX: out/release-candidate-desktop/artifact-index.json',
    )
    expect(artifactsJob).toContain(
      'desktop-artifact-trio.mjs verify out/release-candidate-desktop/artifact-index.json --exclusive',
    )
    expect(artifactsJob).toContain(
      'desktop-artifact-trio.mjs stage out/release-candidate-desktop/artifact-index.json release-artifacts --exclusive-source',
    )
    expect(artifactsJob).toContain('out/release-candidate-desktop/artifact-index.json')
    expect(artifactsJob).not.toContain('out/release-candidate-desktop/*.tar.gz')
    expect(artifactsJob).not.toContain('out/release-candidate-desktop/*.manifest.json')
    expect(artifactsJob).not.toMatch(/cp out\/release-candidate-desktop\/\*/)
    expect(artifactsJob).not.toContain('path: candidate-desktop')
    expect(artifactsJob).not.toContain('-desktop-renderer.tar.gz')
    expect(artifactsJob).not.toContain('-desktop-electron.tar.gz')
  })

  it('grants write authority only to a no-checkout publishing job', () => {
    const workflow = readWorkflow(releaseWorkflowPath)
    const defaults = workflow.slice(0, workflow.indexOf('\njobs:\n'))
    const artifactsJob = jobBlock(workflow, 'release-artifacts')
    const publishJob = jobBlock(workflow, 'publish-release')

    expect(defaults).toContain('actions: read')
    expect(defaults).toContain('contents: read')
    expect(defaults).not.toContain('contents: write')
    expect(workflow.match(/contents: write/g)).toHaveLength(1)
    expect(artifactsJob).not.toContain('contents: write')
    expect(artifactsJob).not.toContain('gh release create')
    expect(artifactsJob).not.toContain('gh release upload')
    expect(publishJob).toContain('contents: write')
    expect(publishJob).toContain('actions: read')
    expect(publishJob).toContain('- release-artifacts')
    expect(publishJob).not.toContain('actions/checkout')
    expect(publishJob).not.toContain('uses:')
    expect(publishJob).not.toContain('scripts/')
    expect(publishJob).not.toMatch(/\b(?:node|pnpm|npm|npx|corepack)\b/)
  })

  it('does not persist checkout credentials in repository-code jobs', () => {
    const workflow = readWorkflow(releaseWorkflowPath)
    for (const id of [
      'windows-compatibility',
      'postgres-integration',
      'docker-smoke',
      'docker-lifecycle-smoke',
      'release-artifacts',
    ]) {
      expect(jobBlock(workflow, id)).toMatch(
        /actions\/checkout@v5[\s\S]*?persist-credentials: false/,
      )
    }
  })

  it('publishes only the current-run artifact after remote annotated-tag verification', () => {
    const publishJob = jobBlock(readWorkflow(releaseWorkflowPath), 'publish-release')

    expect(publishJob).toContain('gh run download "${GITHUB_RUN_ID}"')
    expect(publishJob).toContain('--name ai-devflow-studio-release-artifacts')
    expect(publishJob).toContain('/git/ref/tags/${TAG}')
    expect(publishJob).toContain('/git/tags/${TAG_OBJECT_SHA}')
    expect(publishJob).toContain('"${TAG_OBJECT_TYPE}" != "tag"')
    expect(publishJob).toContain('"${TARGET_TYPE}" != "commit"')
    expect(publishJob).toContain('"${PEELED_SHA}" != "${GITHUB_SHA}"')
    expect(publishJob).toContain('EXPECTED_FILE_COUNT=7')
  })

  it('bounds Postgres delivery and Docker smoke jobs so a stuck daemon cannot consume the release runner forever', () => {
    const workflow = readWorkflow(releaseWorkflowPath)
    const postgresJob = jobBlock(workflow, 'postgres-integration')
    const dockerJob = jobBlock(workflow, 'docker-smoke')
    const lifecycleJob = jobBlock(workflow, 'docker-lifecycle-smoke')

    expect(postgresJob).toContain('timeout-minutes: 30')
    expect(dockerJob).toContain('timeout-minutes: 30')
    expect(lifecycleJob).toContain('timeout-minutes: 45')
  })

  it('installs dependencies before Docker lifecycle smoke so setup-node can save its pnpm cache', () => {
    const lifecycleJob = jobBlock(
      readWorkflow(releaseWorkflowPath),
      'docker-lifecycle-smoke',
    )

    expect(lifecycleJob).toMatch(
      /corepack enable[\s\S]*?corepack pnpm install --frozen-lockfile[\s\S]*?corepack pnpm test:docker-lifecycle-smoke/,
    )
  })
})

describe('GitHub verify workflow', () => {
  it('checks out full history before validating immutable completion ancestry', () => {
    const workflow = readWorkflow(verifyWorkflowPath)
    const macosJob = jobBlock(workflow, 'macos-verify')
    const windowsJob = jobBlock(workflow, 'windows-compatibility')

    expect(workflow).toMatch(/on:\n(?:.|\n)*?workflow_dispatch:/)
    expect(macosJob).toMatch(
      /- uses: actions\/checkout@v5\n\s+with:\n\s+fetch-depth: 0[\s\S]*?corepack pnpm verify/,
    )
    expect(windowsJob).toMatch(
      /- uses: actions\/checkout@v5\n\s+with:\n\s+fetch-depth: 0[\s\S]*?corepack pnpm test/,
    )
  })

  it('runs deterministic build, output, browser, desktop, Postgres, and Docker gates', () => {
    expect(existsSync(verifyWorkflowPath)).toBe(true)

    const workflow = readWorkflow(verifyWorkflowPath)
    const postgresJob = jobBlock(workflow, 'postgres-integration')

    expect(workflow).toContain('corepack pnpm verify')
    expect(workflow).toContain('corepack pnpm audit:production')
    expect(workflow).toContain('corepack pnpm test:v20-agent-runtime-evaluator')
    expect(workflow).toContain('corepack pnpm test:v21-retrieval-memory-evaluator')
    expect(workflow).toContain('corepack pnpm test:v22-multi-agent-evaluator')
    expect(workflow).toContain('corepack pnpm build')
    expect(workflow).toContain('corepack pnpm test:build-output-smoke')
    expect(workflow).toContain('corepack pnpm test:e2e')
    expect(workflow).toContain('corepack pnpm test:electron-smoke')
    expect(workflow).toContain('corepack pnpm test:postgres-smoke')
    expect(workflow).toContain('corepack pnpm test:v15-github-delivery')
    expect(workflow).toContain(
      'dbus-run-session -- node scripts/run-v15-packaged-smoke-linux.mjs',
    )
    expect(workflow).toContain('corepack pnpm test:docker-smoke')
    expect(workflow).toContain('corepack pnpm test:docker-lifecycle-smoke')
    expect(workflow).toContain('corepack pnpm build:desktop-pilot')
    expect(workflow).toContain('corepack pnpm test:desktop-pilot-smoke')
    expect(workflow).not.toContain('DEVFLOW_RUN_OPENCODE_SMOKE=1')
    expect(workflow).not.toContain('test:opencode-smoke')
    expect(postgresJob).toContain('timeout-minutes: 30')
  })

  it('uploads the exact-SHA candidate Desktop artifact for signoff and release reuse', () => {
    const workflow = readWorkflow(verifyWorkflowPath)
    const macosJob = jobBlock(workflow, 'macos-verify')

    expect(macosJob).toContain('actions/upload-artifact@v7')
    expect(macosJob).toContain('name: ai-devflow-studio-v22-candidate-desktop')
    expect(macosJob).toContain(
      'desktop-artifact-trio.mjs stage out/desktop-pilot/artifact-index.json out/verify-candidate-desktop',
    )
    expect(macosJob).toContain('path: out/verify-candidate-desktop/')
    expect(macosJob).not.toContain('out/desktop-pilot/*.manifest.json')
    expect(macosJob).not.toContain('out/desktop-pilot/*.tar.gz')
    expect(macosJob).toContain('compression-level: 0')
    expect(macosJob).toContain('if-no-files-found: error')
  })

  it('keeps every Verify checkout read-only and non-persistent', () => {
    const workflow = readWorkflow(verifyWorkflowPath)
    const defaults = workflow.slice(0, workflow.indexOf('\njobs:\n'))
    expect(defaults).toContain('actions: read')
    expect(defaults).toContain('contents: read')
    for (const id of [
      'macos-verify',
      'windows-compatibility',
      'postgres-integration',
      'docker-smoke',
      'docker-lifecycle-smoke',
    ]) {
      expect(jobBlock(workflow, id)).toMatch(
        /actions\/checkout@v5[\s\S]*?persist-credentials: false/,
      )
    }
  })
})
