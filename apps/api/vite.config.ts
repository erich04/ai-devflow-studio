import { builtinModules } from 'node:module'
import { defineConfig } from 'vite'

const nodeExternals = builtinModules.flatMap((name) => [name, `node:${name}`])

export default defineConfig({
  build: {
    target: 'node24',
    outDir: 'dist',
    emptyOutDir: true,
    minify: false,
    lib: {
      entry: 'src/server.ts',
      formats: ['es'],
    },
    rollupOptions: {
      external: nodeExternals,
      output: {
        entryFileNames: 'server.js',
        chunkFileNames: 'chunks/[name]-[hash].js',
      },
    },
  },
})
