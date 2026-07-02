import { defineConfig } from 'vite'
import dts from 'vite-plugin-dts'
import { resolve } from 'path'

export default defineConfig({
  build: {
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      name: 'IngitDbClientFs',
      fileName: 'index',
      formats: ['es', 'cjs']
    },
    rollupOptions: {
      // Externalize the workspace client and all Node built-ins — this is a
      // Node filesystem-backed package and must not bundle `node:*` modules.
      external: [/^@ingitdb\/client$/, /^node:/]
    }
  },
  plugins: [dts({ insertTypesEntry: true })]
})
