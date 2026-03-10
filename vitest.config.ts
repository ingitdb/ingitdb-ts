import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  resolve: {
    alias: {
      '@ingitdb/client': resolve(__dirname, './packages/client/src/index.ts'),
      '@ingitdb/client-github': resolve(__dirname, './packages/client-github/src/index.ts'),
      '@ingitdb/client-fs': resolve(__dirname, './packages/client-fs/src/index.ts'),
    }
  }
})
