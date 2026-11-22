import { baseConfig } from '@vlp/config/eslint/base';
import { defineConfig } from 'eslint/config';

export default defineConfig(baseConfig({ tsconfigRootDir: import.meta.dirname }), {
  // CDK constructs are instantiated for their side effects (`new Foo(this, 'Id', ...)`).
  rules: { 'no-new': 'off' },
});
