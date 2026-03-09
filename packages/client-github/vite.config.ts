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
  plugins: [dts({ insertTypesEntry: true })]
})
