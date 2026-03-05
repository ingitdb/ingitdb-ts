import { defineConfig } from 'vite'
import dts from 'vite-plugin-dts'
import { resolve } from 'path'

export default defineConfig({
  build: {
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      name: 'IngitDbClient',
      fileName: 'index',
      formats: ['es', 'cjs']
    },
    rollupOptions: {
      external: ['axios', 'js-yaml', 'idb', '@ingr/codec']
    }
  },
  plugins: [dts({ insertTypesEntry: true })]
})
