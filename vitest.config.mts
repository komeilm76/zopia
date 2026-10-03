import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // The suite shells out to the CLI and waits on real filesystem watchers.
    // Vitest's 5 s default is shorter than two legitimate `vi.waitFor` windows
    // in tests/watch-mode.test.ts, which made that file fail at random under
    // parallel load. The generous ceiling only affects how long a genuinely
    // stuck test hangs; healthy runs finish in milliseconds.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      reporter: ['text', 'json-summary'],
      reportsDirectory: 'coverage',
      thresholds: {
        lines: 90,
        functions: 90,
        branches: 85,
      },
    },
  },
});
