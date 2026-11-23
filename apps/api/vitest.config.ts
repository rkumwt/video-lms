import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    env: {
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      LOCAL_STORAGE_DIR: '.tmp/test-storage',
      VIDEOS_BUCKET: '',
    },
  },
});
