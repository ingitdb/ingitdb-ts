import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  resolve: {
    alias: {
      '@ingitdb/client': resolve(__dirname, '../client/src/index.ts'),
    }
  },
  test: {
    environment: 'happy-dom',
    globals: true,
    passWithNoTests: true,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.spec.ts', 'src/index.ts'],
      reporter: ['text', 'html', 'lcov'],
      all: true
    }
  }
})
