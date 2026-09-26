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
      // Quinze segundos de graca sao certos em producao e insuportaveis num
      // teste: o caso que fecha o socket e espera o `voice.participant_left`
      // esperaria quinze segundos por asserção. O que os testes provam e a
      // ORDEM dos acontecimentos, nunca a duracao.
      //
      // Mas nao pode ser pequeno demais. Cinquenta milissegundos, o valor
      // anterior, nao cabiam a reconexao: antes de cancelar a saida adiada o
      // servidor monta a fotografia do `ready`, que sao quatro idas a um
      // Postgres de verdade. Com a suite inteira carregando a maquina isso
      // passava de 50ms, a graca expirava e o caso "voltar dentro da janela"
      // falhava vendo um `participant_left` que o servidor tinha toda razao de
      // emitir. Um segundo da folga de sobra e custa um segundo.
      //
      // `voice-reconexao.test.ts` LE este valor em vez de repeti-lo — as
      // esperas dele sao "a janela mais uma margem", e nao um numero solto.
      VOICE_RECONNECT_GRACE_MS: '1000',
      LOG_LEVEL: 'fatal',
      LIVEKIT_API_KEY: 'chave-de-teste',
      LIVEKIT_API_SECRET: 'segredo-de-teste-com-32-bytes-ou-mais',
      LIVEKIT_URL: 'ws://localhost:7880',
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
