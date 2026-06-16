import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    include: ['packages/**/*.test.ts', 'apps/**/*.test.ts', 'apps/**/*.test.tsx'],
    coverage: {
      reporter: ['text', 'html'],
      exclude: ['**/node_modules/**', '**/dist/**', '**/.next/**'],
    },
  },
  resolve: {
    alias: {
      '@ai-devflow/shared': '/Users/erich/File/claude/10-showcase/ai-devflow-studio/packages/shared/src',
    },
  },
})
