import js from '@eslint/js'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  {
    ignores: ['**/node_modules/**', '**/dist/**', '**/coverage/**', 'web/**'],
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
    files: ['api/test/**/*.ts'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
)
