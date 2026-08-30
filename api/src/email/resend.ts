import type { Correio, Mensagem } from './tipos.js'
import { logger } from '../shared/logger.js'

/**
 * Correio de producao, falando com a API do Resend por HTTP.
 *
 * Sem o pacote `resend`: a chamada e um unico POST com JSON, e o SDK traria
 * uma dependencia inteira para embrulhar um `fetch`. Node 24 tem `fetch`
 * nativo, e o contrato abaixo e a superficie que de fato usamos.
 */
const ENDERECO = 'https://api.resend.com/emails'

/** Tres tentativas, porque uma indisponibilidade momentanea nao pode custar a
 *  unica chance de alguem recuperar a conta. */
const TENTATIVAS = 3
const ESPERA_BASE_MS = 400

const dormir = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms))

export function correioResend(opcoes: {
  apiKey: string
  de: string
  responderPara?: string | undefined
}): Correio {
  return {
    enviar: async (mensagem: Mensagem) => {
      let ultimoErro: Error | null = null

      for (let tentativa = 1; tentativa <= TENTATIVAS; tentativa++) {
        try {
          const res = await fetch(ENDERECO, {
            method: 'POST',
            headers: {
              authorization: `Bearer ${opcoes.apiKey}`,
              'content-type': 'application/json',
            },
            body: JSON.stringify({
              from: opcoes.de,
              to: [mensagem.para],
              subject: mensagem.assunto,
              text: mensagem.texto,
              html: mensagem.html,
              ...(opcoes.responderPara === undefined
                ? {}
                : { reply_to: opcoes.responderPara }),
            }),
          })

          if (res.ok) return

          const corpo = await res.text().catch(() => '')
          // 4xx e configuracao errada — chave invalida, dominio nao verificado,
          // destinatario recusado. Repetir nao conserta nenhuma delas.
          if (res.status < 500) {
            throw new Error(`Resend recusou (${String(res.status)}): ${corpo.slice(0, 200)}`)
          }
          ultimoErro = new Error(`Resend indisponivel (${String(res.status)})`)
        } catch (e) {
          ultimoErro = e instanceof Error ? e : new Error(String(e))
          // Erro de configuracao nao melhora com repeticao.
          if (ultimoErro.message.startsWith('Resend recusou')) break
        }

        if (tentativa < TENTATIVAS) await dormir(ESPERA_BASE_MS * 2 ** (tentativa - 1))
      }

      logger.error({ erro: ultimoErro?.message, para: mensagem.para },
        'falha ao enviar e-mail')
      throw ultimoErro ?? new Error('falha ao enviar e-mail')
    },
  }
}
