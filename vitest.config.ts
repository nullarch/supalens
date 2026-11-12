import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    environment: 'node',
    // Most of the suite describes hosted-service behaviour (plans, billing, marketing routes), so
    // tests run as the cloud edition unless one stubs NEXT_PUBLIC_SUPALENS_EDITION itself. The
    // repository default is selfhost (src/config/edition.ts).
    env: { NEXT_PUBLIC_SUPALENS_EDITION: 'cloud' },
    include: ['src/**/*.test.ts'],
    exclude: ['node_modules', '.next', 'e2e'],
  },
})
