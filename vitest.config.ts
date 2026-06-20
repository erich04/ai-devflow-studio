import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

const sharedSrcPath = fileURLToPath(new URL('./packages/shared/src', import.meta.url))

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    include: ['packages/**/*.test.ts', 'apps/**/*.test.ts', 'apps/**/*.test.tsx', 'scripts/**/*.test.ts'],
    coverage: {
      reporter: ['text', 'html'],
      exclude: ['**/node_modules/**', '**/dist/**', '**/.next/**'],
    },
  },
  resolve: {
    alias: {
      '@ai-devflow/shared': sharedSrcPath,
    },
  },
})
