import { builtinModules } from 'node:module'
import { defineConfig } from 'vite'

const nodeExternals = builtinModules.flatMap((name) => [name, `node:${name}`])

export default defineConfig({
  build: {
    outDir: 'dist-electron',
    emptyOutDir: false,
    lib: {
      entry: 'electron/preload.ts',
      formats: ['cjs'],
    },
    rollupOptions: {
      external: ['electron', ...nodeExternals],
      output: {
        entryFileNames: 'preload.cjs',
      },
    },
  },
})
