import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/', 'node_modules/', 'coverage/'] },
  ...tseslint.configs.strictTypeChecked,
  reactHooks.configs.flat['recommended-latest'],
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none', ignoreRestSiblings: true },
      ],
      // onClick={() => setX(v)} is the usual React handler shorthand
      '@typescript-eslint/no-confusing-void-expression': ['error', { ignoreArrowShorthand: true }],
      'no-console': ['error', { allow: ['error', 'warn'] }],
      'react-hooks/exhaustive-deps': 'error',
    },
  },
  { files: ['**/*.js', '**/*.mjs'], extends: [tseslint.configs.disableTypeChecked] },
  {
    files: ['**/*.test.ts', '**/*.test.tsx', 'test/**', 'scripts/**'],
    rules: { '@typescript-eslint/no-non-null-assertion': 'off', 'no-console': 'off' },
  },
);
