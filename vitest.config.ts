import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    exclude: ['dist/**'],
    include: ['./testSuite/**/*.test.ts'],
  },
});
