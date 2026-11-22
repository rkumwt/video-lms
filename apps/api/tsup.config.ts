import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/server.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node24',
  sourcemap: true,
  clean: true,
  // Bundle internal workspace packages; keep npm deps external (installed in the image).
  noExternal: [/^@vlp\//],
});
