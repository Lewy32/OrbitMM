import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/__tests__/*.test.ts', 'src/**/*.test.ts'],
    passWithNoTests: true,
    testTimeout: 30000,
    setupFiles: ['src/__tests__/setup.ts'],
  },
});
