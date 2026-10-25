import type { NextConfig } from 'next'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const webDir = path.dirname(fileURLToPath(import.meta.url))
const e2eDistDir = process.env.DEVFLOW_E2E_NEXT_DIST_DIR
if (e2eDistDir && !/^\.tmp\/next-e2e-[a-zA-Z0-9_-]+$/u.test(e2eDistDir)) throw new Error('Invalid isolated E2E build directory')

const nextConfig: NextConfig = {
  output: 'standalone',
  outputFileTracingRoot: path.resolve(webDir, '../..'),
  transpilePackages: ['@ai-devflow/shared'],
  ...(e2eDistDir ? { distDir: e2eDistDir } : {}),
}

export default nextConfig
