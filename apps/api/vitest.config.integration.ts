import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['test/**/*.integration-spec.ts'],
    fileParallelism: false,
    hookTimeout: 10_000,
    testTimeout: 10_000,
  },
});
