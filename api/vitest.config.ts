import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Testes de integracao sobem um Postgres em container. O primeiro deles
    // paga o custo de baixar a imagem e iniciar; 5s (padrao do vitest) nao
    // cobre isso.
    testTimeout: 60_000,
    hookTimeout: 120_000,

    // env.ts valida no import e mata o processo se faltar variavel — e o que a
    // spec 07 exige em producao. Para que os testes possam importar a API,
    // o runner fornece um ambiente valido aqui. parseEnv() continua sendo
    // testada como funcao pura, com entradas proprias.
    env: {
      NODE_ENV: 'test',
      PORT: '3000',
      DATABASE_URL: 'postgres://altcast:altcast_dev@localhost:5432/altcast',
      ALLOWED_ORIGINS: 'http://localhost:5173',
      PUBLIC_URL: 'http://localhost:5173',
      SESSION_COOKIE_NAME: 'altcast_session',
      SESSION_TTL_DAYS: '30',
      LOG_LEVEL: 'fatal',
    },

    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      include: ['src/**/*.ts'],
      // Os dois arquivos que concentram o risco do sistema: can.ts decide
      // quem pode o que, fanout.ts decide quem recebe o que. Abaixo de 100%
      // o build quebra.
      thresholds: {
        'src/permissions/can.ts': {
          statements: 100, branches: 100, functions: 100, lines: 100,
        },
        'src/realtime/fanout.ts': {
          statements: 100, branches: 100, functions: 100, lines: 100,
        },
        // A autenticacao inteira, e nao um arquivo: senha, sessao e o
        // middleware que decide quem e quem. Um caminho descoberto aqui e um
        // caminho por onde alguem entra sem credencial.
        'src/auth/**': {
          statements: 95, branches: 95, functions: 95, lines: 95,
        },
        // As rotas sao onde as regras viram resposta HTTP. O limiar de ramos e
        // mais baixo de proposito: boa parte deles sao guardas defensivas cujo
        // ramo "impossivel" so seria alcancavel corrompendo o banco.
        'src/routes/**': {
          statements: 85, branches: 78, functions: 85, lines: 85,
        },
      },
    },
  },
})
