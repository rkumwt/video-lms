import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Each test synthesizes the full CDK app + cdk-nag; under parallel CI load that can exceed 5s.
    testTimeout: 30_000,
  },
});
