import type { Pergunta } from '../cliente.js'

/**
 * Triagem de notificacao — nivel "Inteligente" (super plano, secao 7.3).
 *
 * Uma Score por PERFIL de leitor, e nao por pessoa: quem participou da conversa
 * recente e quem nao participou. Agrupar assim mantem o custo em no maximo duas
 * perguntas por mensagem, qualquer que seja o tamanho do grupo — e mencao
 * direta nunca passa por aqui: ela notifica pela regra do codigo.
 *
 * Instrucoes e criterios em ingles (o idioma dos exemplos da documentacao); o
 * estado vai no idioma original. A versao entra no hash do cache e no
 * registro de decisoes: mudar o texto de uma pergunta e mudar a versao.
 */
export const VERSAO_ATENCAO = 'atencao.v1'

const CRITERIOS = [
  'Casual chatter nobody needs to see now',
  'Mildly relevant, fine to read later',
  'Relevant to the reader, worth a quiet notification',
  'Directly needs the reader: a question, decision or deadline involving them',
]

export function perguntaDeAtencao(participou: boolean): Pergunta {
  return {
    type: 'score',
    instructions: participou
      ? 'How much does `message` call for the attention of a reader who is NOT mentioned but '
        + 'DID write at least one of the lines in `recent_context`? Consider questions addressed '
        + 'to the group, decisions, deadlines, and replies to what the participants said.'
      : 'How much does `message` call for the attention of a group member who is NOT mentioned '
        + 'and did NOT take part in `recent_context`? Consider questions addressed to everyone, '
        + 'decisions, deadlines and announcements that affect the whole group.',
    criteria: CRITERIOS,
  }
}

/** Ponto de partida dos limiares — recalibrados com `ia_decisoes`. */
export const LIMIAR_ATENCAO = { score: 2.0, confianca: 0.6 }
