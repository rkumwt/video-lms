import { reactConfig } from '@vlp/config/eslint/react';
import { defineConfig } from 'eslint/config';

export default defineConfig(reactConfig({ tsconfigRootDir: import.meta.dirname }), {
  // shadcn/ui components intentionally co-export variants (e.g. buttonVariants).
  files: ['src/components/ui/**'],
  rules: { 'react-refresh/only-export-components': 'off' },
});
