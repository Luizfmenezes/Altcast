import { uuidv7 } from 'uuidv7'
import { ApiError, api } from '../../lib/api.js'
import { useStore } from '../../lib/store.js'
import type { Anexo, Mensagem } from '../../lib/tipos.js'

export const LIMITE_DE_CARACTERES = 4000

/**
 * Envia uma mensagem com eco otimista.
 *
 * O ID e gerado aqui, no cliente, e vai no corpo do POST. E o que permite a
 * mensagem aparecer na tela antes de qualquer resposta e depois se reconhecer
 * no evento que volta pelo socket - a reconciliacao e por ID, nunca por
 * conteudo, porque duas mensagens iguais sao duas falas de verdade.
 *
 * Reenviar reaproveita o mesmo ID de proposito: se a primeira tentativa chegou
 * ao servidor e so a resposta se perdeu, o segundo POST leva 409 em vez de
 * criar uma segunda mensagem identica.
 */
export async function enviarMensagem(
  channelId: string,
  conteudo: string,
  idExistente?: string,
  anexos: Anexo[] = [],
  /** A mensagem citada, se esta for uma resposta. */
  replyToId?: string,
): Promise<void> {
  const { user, registrarEco, marcarEnvio } = useStore.getState()
  const id = idExistente ?? uuidv7()

  registrarEco({
    id,
    channelId,
    authorId: user?.id ?? null,
    content: conteudo,
    createdAt: new Date().toISOString(),
    editedAt: null,
    // Os anexos ja existem no servidor quando a mensagem sai, entao o eco
    // otimista mostra a imagem de verdade e nao um espaco vazio que salta
    // quando a confirmacao chega.
    attachments: anexos,
    // No eco tambem: sem isto a linha de citacao so apareceria quando a
    // confirmacao chegasse, e a mensagem saltaria de lugar na tela.
    replyToId: replyToId ?? null,
    envio: 'enviando',
  })

  try {
    const confirmada = await api.post<Mensagem>(`/channels/${channelId}/messages`, {
      id,
      content: conteudo,
      attachmentIds: anexos.map(a => a.id),
      ...(replyToId === undefined ? {} : { replyToId }),
    })
    // A versao do servidor substitui o eco pelo mesmo ID: horario real, autor
    // canonico, e sem o marcador de envio.
    registrarEco(confirmada)
  } catch (erro) {
    // 409 no mesmo ID e SUCESSO atrasado: a primeira tentativa chegou e so a
    // resposta se perdeu. A mensagem existe no servidor, e marca-la como falha
    // convidaria a pessoa a reenviar o que todo mundo ja leu.
    if (erro instanceof ApiError && erro.code === 'message_id_taken') {
      marcarEnvio(id, undefined)
      return
    }
    // Nunca some em silencio. O texto continua na tela, marcado como falho e
    // recuperavel - a pessoa achar que falou sem ninguem ter recebido e a
    // falha mais corrosiva de confianca num chat.
    marcarEnvio(id, 'falhou')
  }
}

/**
 * Reenvia um eco que falhou, com TUDO o que ele levava.
 *
 * O botao "Tentar de novo" chamava `enviarMensagem` so com o texto: a segunda
 * tentativa saia sem os anexos e sem a citacao, e a foto que era o motivo da
 * mensagem sumia justamente na hora em que a pessoa insistiu em manda-la. O
 * eco ja guarda os anexos e o `replyToId` — reenviar e repetir o eco inteiro.
 */
export function reenviarMensagem(mensagem: Mensagem): Promise<void> {
  return enviarMensagem(
    mensagem.channelId,
    mensagem.content,
    mensagem.id,
    mensagem.attachments ?? [],
    mensagem.replyToId ?? undefined,
  )
}
