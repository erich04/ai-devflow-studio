import { builtinModules } from 'node:module'
import { defineConfig } from 'vite'

const nodeExternals = builtinModules.flatMap((name) => [name, `node:${name}`])

export default defineConfig({
  build: {
    outDir: 'dist-electron',
    emptyOutDir: true,
    lib: {
      entry: 'electron/main.ts',
      formats: ['es'],
    },
    rollupOptions: {
      external: ['electron', 'sql.js', ...nodeExternals],
      output: {
        entryFileNames: 'main.js',
      },
    },
  },
})
