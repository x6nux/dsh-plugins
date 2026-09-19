import { defineConfig } from 'vitest/config'
export default defineConfig({
  test: {
    include: ['tests/**/*.spec.ts', 'tests/**/*.spec.tsx'],
    testTimeout: 15000,
    // The published primitives bundle ships CSS Modules imports that only
    // resolve when Vite processes it rather than externalizing it.
    server: { deps: { inline: ['@deepseek-ai/dsh-client-ui-primitives'] } },
  },
})
