import { defineConfig } from 'vite'
import dts from 'vite-plugin-dts'
import { resolve } from 'path'

export default defineConfig({
  build: {
    lib: {
      entry: {
        index: resolve(__dirname, 'src/index.ts'),
        testing: resolve(__dirname, 'src/testing.ts'),
      },
      formats: ['es', 'cjs']
    },
    rollupOptions: {
      external: ['axios', 'idb', '@ingr/codec', '@ingitdb/client']
    }
  },
  // aliasesExclude keeps `@ingitdb/client` as a bare import specifier in the
  // emitted .d.ts. Without it, vite-plugin-dts follows the tsconfig `paths`
  // alias (@ingitdb/client -> ../client/src/index.ts) and bakes that relative
  // source path into the published types, which doesn't exist in the tarball —
  // breaking every downstream consumer's type resolution.
  plugins: [dts({ insertTypesEntry: true, aliasesExclude: ['@ingitdb/client'] })]
})
