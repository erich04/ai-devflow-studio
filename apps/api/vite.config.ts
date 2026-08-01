import { builtinModules } from 'node:module'
import { cp } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

const nodeExternals = builtinModules.flatMap((name) => [name, `node:${name}`])
const apiDir = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  plugins: [
    {
      name: 'copy-team-migration-assets',
      async writeBundle() {
        await cp(
          path.join(apiDir, 'src/db/migrations'),
          path.join(apiDir, 'dist/migrations'),
          { recursive: true },
        )
      },
    },
  ],
  build: {
    target: 'node24',
    outDir: 'dist',
    emptyOutDir: true,
    minify: false,
    lib: {
      entry: {
        server: path.join(apiDir, 'src/server.ts'),
        migrate: path.join(apiDir, 'src/db/migrate.ts'),
        'seed-demo': path.join(apiDir, 'src/db/seed-demo.ts'),
      },
      formats: ['es'],
    },
    rollupOptions: {
      external: nodeExternals,
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name]-[hash].js',
      },
    },
  },
})
