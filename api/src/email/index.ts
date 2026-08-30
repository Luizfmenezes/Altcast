import { env } from '../env.js'
import { correioResend } from './resend.js'
import { correioDeRegistro } from './registro.js'
import type { Correio } from './tipos.js'
import { logger } from '../shared/logger.js'

/**
 * Escolhe o correio a partir do ambiente.
 *
 * Sem `RESEND_API_KEY` cai no correio de registro, e AVISA. O aviso importa:
 * uma producao que suba sem chave manda todo link de recuperacao para o log do
 * container, e quem esqueceu de configurar precisa descobrir isso agora, e nao
 * quando alguem perder a senha.
 */
export function correioPadrao(): Correio {
  if (env.RESEND_API_KEY === undefined) {
    if (env.NODE_ENV === 'production') {
      logger.warn('RESEND_API_KEY ausente: e-mails vao para o log, nao para as pessoas')
    }
    return correioDeRegistro()
  }
  return correioResend({
    apiKey: env.RESEND_API_KEY,
    de: env.EMAIL_FROM,
    responderPara: env.EMAIL_REPLY_TO,
  })
}
