import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/', 'node_modules/'] },
  ...tseslint.configs.strictTypeChecked,
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
      '@typescript-eslint/no-confusing-void-expression': ['error', { ignoreArrowShorthand: true }],
      // Fastify handlers are async without await: Fastify takes the answer from the returned value
      '@typescript-eslint/require-await': 'off',
      // The server logs through Fastify's logger (pino)
      'no-console': 'error',
    },
  },
  { files: ['**/*.js'], extends: [tseslint.configs.disableTypeChecked] },
  {
    files: ['test/**'],
    // expect.any() and friends are typed `any`
    rules: { '@typescript-eslint/no-non-null-assertion': 'off', '@typescript-eslint/no-unsafe-assignment': 'off' },
  },
);
