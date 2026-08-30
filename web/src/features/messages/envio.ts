import { uuidv7 } from 'uuidv7'
import { api } from '../../lib/api.js'
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
  channelId: string, conteudo: string, idExistente?: string, anexos: Anexo[] = [],
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
    envio: 'enviando',
  })

  try {
    const confirmada = await api.post<Mensagem>(`/channels/${channelId}/messages`, {
      id, content: conteudo, attachmentIds: anexos.map(a => a.id),
    })
    // A versao do servidor substitui o eco pelo mesmo ID: horario real, autor
    // canonico, e sem o marcador de envio.
    registrarEco(confirmada)
  } catch {
    // Nunca some em silencio. O texto continua na tela, marcado como falho e
    // recuperavel - a pessoa achar que falou sem ninguem ter recebido e a
    // falha mais corrosiva de confianca num chat.
    marcarEnvio(id, 'falhou')
  }
}
