import type { NextConfig } from 'next'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const webDir = path.dirname(fileURLToPath(import.meta.url))

const nextConfig: NextConfig = {
  output: 'standalone',
  // Parallel verification servers use their own generated output directory.
  distDir: process.env['DEVFLOW_NEXT_DIST_DIR']?.trim() || '.next',
  outputFileTracingRoot: path.resolve(webDir, '../..'),
  transpilePackages: ['@ai-devflow/shared'],
}

export default nextConfig
