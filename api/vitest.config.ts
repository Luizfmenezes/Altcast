import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
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
  },
})
