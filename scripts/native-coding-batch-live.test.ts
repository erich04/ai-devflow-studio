// @vitest-environment node
import { expect, it } from 'vitest'
// @ts-expect-error Standalone Node evaluator has no declaration file.
import { protectedEvaluationPath } from './native-coding-batch-live.mjs'

it('protects package/test configuration and acceptance files without masking production changes', () => {
  for (const file of ['package.json', 'apps/web/package.json', 'pnpm-lock.yaml', 'vitest.config.ts', 'vitest.setup.ts', 'apps/desktop/tsconfig.json', 'apps/api/src/a.test.ts', 'apps/web/src/a.spec.tsx']) expect(protectedEvaluationPath(file), file).toBe(true)
  for (const file of ['apps/desktop/electron/native-coding-loop.ts', 'packages/shared/src/domain.ts', 'README.md']) expect(protectedEvaluationPath(file), file).toBe(false)
})
