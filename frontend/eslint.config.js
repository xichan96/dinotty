import js from '@eslint/js'
import pluginVue from 'eslint-plugin-vue'
import tseslint from 'typescript-eslint'
import eslintConfigPrettier from 'eslint-config-prettier'
import globals from 'globals'

export default tseslint.config(
  // Global ignores
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      '**/*.d.ts',
      // copied plugin bundle fixtures (see builtinKeyboardPlugin.spec.ts)
      'src/keyboard/__tests__/__plugin_bundles__/**',
    ],
  },
  // Base JS recommended rules
  js.configs.recommended,
  // TypeScript recommended rules
  ...tseslint.configs.recommended,
  // Vue 3 recommended rules (flat config)
  ...pluginVue.configs['flat/recommended'],
  // Prettier - disable rules that conflict
  eslintConfigPrettier,
  // Browser globals for all files
  {
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.browser,
      },
    },
  },
  // Project-specific overrides
  {
    files: ['**/*.vue'],
    languageOptions: {
      parserOptions: {
        parser: tseslint.parser,
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
    },
    rules: {
      // Vue-specific adjustments
      'vue/multi-word-component-names': 'off',
      'vue/no-unused-vars': 'off',
    },
  },
  {
    rules: {
      // TypeScript adjustments for existing codebase
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
      // Allow empty catch blocks (common pattern)
      'no-empty': ['error', { allowEmptyCatch: true }],
      // Allow optional chaining expressions like event?.()
      'no-unused-expressions': 'off',
      '@typescript-eslint/no-unused-expressions': ['error', { allowShortCircuit: true, allowTernary: true }],
      // Disable no-undef for TypeScript files (TypeScript handles this)
      'no-undef': 'off',
      // Downgrade to warnings for existing codebase
      'prefer-const': 'warn',
      'no-useless-assignment': 'warn',
      'no-control-regex': 'warn',
      'no-useless-escape': 'warn',
      '@typescript-eslint/no-this-alias': 'warn',
      'vue/no-mutating-props': 'warn',
      'vue/valid-next-tick': 'warn',
    },
  },
)
