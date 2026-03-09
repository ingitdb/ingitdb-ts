import { defineConfig } from 'vite'
import dts from 'vite-plugin-dts'
import { resolve } from 'path'

export default defineConfig({
  build: {
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      name: 'IngitDbClientGithub',
      fileName: 'index',
      formats: ['es', 'cjs']
    },
    rollupOptions: {
      external: ['axios', 'idb', '@ingr/codec', '@ingitdb/client']
    }
  },
  plugins: [dts({ insertTypesEntry: true })]
})
