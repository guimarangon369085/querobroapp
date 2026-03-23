const path = require('path');
const js = require('@eslint/js');
const { FlatCompat } = require('@eslint/eslintrc');

const compat = new FlatCompat({
  baseDirectory: __dirname,
  recommendedConfig: js.configs.recommended
});

const webCompat = new FlatCompat({
  baseDirectory: path.join(__dirname, 'apps/web'),
  recommendedConfig: js.configs.recommended
});

module.exports = [
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/.next*/**',
      '**/.playwright-cli/**',
      'apps/web/next-env.d.ts'
    ]
  },
  ...compat.config({
    env: { es2022: true, node: true, browser: true },
    parser: '@typescript-eslint/parser',
    plugins: ['@typescript-eslint'],
    extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended'],
    parserOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      ecmaFeatures: { jsx: true }
    },
    rules: {
      'no-unused-vars': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }
      ]
    }
  }),
  ...webCompat.config({
    extends: ['next/core-web-vitals']
  }).map((config) => ({
    ...config,
    files: ['apps/web/**/*.{ts,tsx,js,cjs,mjs}'],
    ignores: ['apps/web/next-env.d.ts']
  })),
  {
    files: ['**/*.cjs', 'apps/mobile/metro.config.js'],
    rules: {
      '@typescript-eslint/no-require-imports': 'off'
    }
  }
];
