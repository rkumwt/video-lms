import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node24',
  sourcemap: true,
  clean: true,
  // Bundle the pure-TS shared package; @vlp/db stays external (Prisma client + its own deps).
  noExternal: ['@vlp/shared'],
});
