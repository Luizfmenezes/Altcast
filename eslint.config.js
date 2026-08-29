import js from '@eslint/js'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  {
    ignores: ['**/node_modules/**', '**/dist/**', '**/coverage/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // A invariante da spec 03 secao 10: nenhuma comparacao direta de papel
    // fora de permissions/can.ts. Verificacao espalhada pelo codigo e
    // exatamente como, seis meses depois, um endpoint novo esquece a checagem.
    files: ['api/src/**/*.ts'],
    ignores: ['api/src/permissions/can.ts'],
    rules: {
      'no-restricted-syntax': ['error', {
        selector: "BinaryExpression[operator='===']  > MemberExpression[property.name='role']",
        message: 'Comparacao de papel fora de permissions/can.ts. Use can().',
      }, {
        selector: "BinaryExpression[operator='!=='] > MemberExpression[property.name='role']",
        message: 'Comparacao de papel fora de permissions/can.ts. Use can().',
      }],
    },
  },
  {
    // O frontend compartilha as regras base; a invariante de papel e da API,
    // onde a autorizacao acontece — o cliente so exibe o que recebeu.
    files: ['web/**/*.{ts,tsx}'],
    rules: {
      // Descartar uma chave por desestruturacao e a forma idiomatica de
      // remove-la de um objeto sem mutar; o nome descartado existe so para
      // dar lugar a ela.
      '@typescript-eslint/no-unused-vars': ['error', {
        varsIgnorePattern: '^_', argsIgnorePattern: '^_', ignoreRestSiblings: true,
      }],
    },
    languageOptions: {
      globals: {
        document: 'readonly', window: 'readonly', localStorage: 'readonly',
        matchMedia: 'readonly', fetch: 'readonly', WebSocket: 'readonly',
        setTimeout: 'readonly', clearTimeout: 'readonly', console: 'readonly',
        HTMLElement: 'readonly', Event: 'readonly', AbortController: 'readonly',
      },
    },
  },
  {
    files: ['api/test/**/*.ts', 'web/test/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
)
