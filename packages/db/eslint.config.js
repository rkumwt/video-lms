import { baseConfig } from '@vlp/config/eslint/base';
import { defineConfig, globalIgnores } from 'eslint/config';

export default defineConfig(
  globalIgnores(['src/generated/**']),
  baseConfig({ tsconfigRootDir: import.meta.dirname }),
);
