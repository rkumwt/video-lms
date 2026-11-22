import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/server.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node24',
  sourcemap: true,
  clean: true,
  // Bundle the pure-TS shared package. @vlp/db stays external: it carries Prisma's generated
  // client and its own runtime deps (pg, @prisma/*), installed by `pnpm deploy` in the image.
  noExternal: ['@vlp/shared'],
});
