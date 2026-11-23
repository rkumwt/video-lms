import { fileURLToPath, URL } from 'node:url';

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: {
    port: 5173,
    // Same-origin `/api` in dev, mirroring CloudFront -> ALB routing in AWS (no CORS needed).
    proxy: { '/api': { target: 'http://localhost:4000', changeOrigin: true } },
  },
  build: { sourcemap: true },
  test: {
    environment: 'jsdom',
    // user-event interaction tests can exceed 5s when CI runs every package in parallel
    testTimeout: 15_000,
    setupFiles: ['./src/test/setup.ts'],
    css: false,
  },
});
