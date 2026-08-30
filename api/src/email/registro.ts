import type { Correio, Mensagem } from './tipos.js'
import { logger } from '../shared/logger.js'

/**
 * Correio que nao envia nada: registra e segue.
 *
 * E o adaptador de desenvolvimento e de teste. Em desenvolvimento, o link de
 * recuperacao aparece no log do container e o fluxo inteiro funciona sem
 * credencial nenhuma. Em teste, `enviadas` e onde a asserção olha.
 */
export function correioDeRegistro(): Correio & { enviadas: Mensagem[] } {
  const enviadas: Mensagem[] = []
  return {
    enviadas,
    enviar: async (mensagem: Mensagem) => {
      enviadas.push(mensagem)
      // O corpo inteiro, e nao so o assunto: em desenvolvimento este log e o
      // unico lugar onde o link existe.
      logger.info({ para: mensagem.para, assunto: mensagem.assunto, texto: mensagem.texto },
        'e-mail nao enviado (correio de registro)')
      return Promise.resolve()
    },
  }
}
