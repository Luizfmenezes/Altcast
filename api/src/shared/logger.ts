import pino from 'pino'
import { env } from '../env.js'

/** Redacao conforme a spec 06: nunca registrar senha, hash, valor de cookie,
 *  conteudo de mensagem ou codigo de convite.
 *
 *  Atencao ao campo 'code': ele e redigido porque carrega codigo de convite.
 *  Por isso o handler de erro loga 'errorCode', e nao 'code' — caso contrario
 *  o codigo do erro sairia como [redigido] e o requestId perderia serventia. */
export const logger = pino({
  level: env.LOG_LEVEL,
  redact: {
    paths: [
      'req.headers.cookie', 'res.headers["set-cookie"]',
      'password', '*.password', 'passwordHash', '*.passwordHash',
      'content', '*.content', 'code', '*.code',
    ],
    censor: '[redigido]',
  },
})
