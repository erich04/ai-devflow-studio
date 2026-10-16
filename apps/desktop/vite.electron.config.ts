import { builtinModules } from 'node:module'
import { defineConfig } from 'vite'

const nodeExternals = builtinModules.flatMap((name) => [name, `node:${name}`])

export default defineConfig({
  // Bundled CommonJS dependencies (TypeScript's language service) still consult
  // these globals. Electron's Node 24 main entry is ESM, including in packages.
  define: { __filename: 'import.meta.filename', __dirname: 'import.meta.dirname' },
  build: {
    outDir: 'dist-electron',
    emptyOutDir: true,
    lib: {
      entry: {
        main: 'electron/main.ts',
        'local-mcp-fixture-server': 'electron/local-mcp-fixture-server.ts',
      },
      formats: ['es'],
    },
    rollupOptions: {
      external: ['electron', 'sql.js', ...nodeExternals],
      output: {
        entryFileNames: '[name].js',
      },
    },
  },
})
