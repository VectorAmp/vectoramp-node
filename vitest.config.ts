import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'cobertura'],
      thresholds: { statements: 90, branches: 82, functions: 90, lines: 90 }
    }
  }
});
