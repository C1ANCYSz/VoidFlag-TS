import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    exclude: ['dist/**', './testSuite/connection.test.ts'],
    include: ['./testSuite/**/*.ts'],
  },
});
