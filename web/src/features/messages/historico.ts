import { create } from 'zustand'
import { api } from '../../lib/api.js'
import { useStore } from '../../lib/store.js'
import type { Mensagem } from '../../lib/tipos.js'

/**
 * O historico de cada canal: a primeira pagina, as anteriores, e o que deu
 * errado no caminho.
 *
 * A primeira pagina era buscada em `App.tsx` com um `.catch(() => undefined)`:
 * falhar deixava a conversa em "Nenhuma mensagem ainda", que e uma MENTIRA num
 * canal com trezentas mensagens. E as paginas anteriores nunca foram buscadas
 * — a lista tinha o gancho `carregarAnteriores`, e ninguem o ligava. Rolar ate
 * o topo nao trazia nada.
 */

export const TAMANHO_DA_PAGINA = 50

export type EstadoDoHistorico = {
  /** A primeira pagina: sem ela a lista nao sabe se o canal esta vazio. */
  primeira: 'carregando' | 'pronto' | 'falhou'
  /** As paginas acima. `ocioso` inclui "nunca pedida". */
  anteriores: 'ocioso' | 'carregando' | 'falhou'
  /** A pagina mais antiga ja chegou: rolar ate o topo nao pede mais nada. */
  inicio: boolean
}

type Estado = {
  porCanal: Record<string, EstadoDoHistorico>
  mexer: (channelId: string, mudanca: Partial<EstadoDoHistorico>) => void
}

const NOVO: EstadoDoHistorico = { primeira: 'carregando', anteriores: 'ocioso', inicio: false }

export const useHistorico = create<Estado>(set => ({
  porCanal: {},
  mexer: (channelId, mudanca) => set(estado => ({
    porCanal: {
      ...estado.porCanal,
      [channelId]: { ...(estado.porCanal[channelId] ?? NOVO), ...mudanca },
    },
  })),
}))

export const estadoDe = (porCanal: Record<string, EstadoDoHistorico>, channelId: string):
  EstadoDoHistorico => porCanal[channelId] ?? NOVO

/**
 * A pagina mais recente de um canal.
 *
 * Devolve uma funcao de cancelamento para o `useEffect` de quem chama: trocar
 * de canal no meio da resposta nao pode despejar as mensagens de #geral no
 * estado de carregamento de #avisos.
 */
export function carregarHistorico(channelId: string): () => void {
  let vigente = true
  const { mexer } = useHistorico.getState()
  mexer(channelId, { primeira: 'carregando' })

  api.get<Mensagem[]>(`/channels/${channelId}/messages?limit=${String(TAMANHO_DA_PAGINA)}`)
    .then(pagina => {
      if (!vigente) return
      // A API devolve do mais novo para o mais antigo; a lista exibe ao
      // contrario.
      useStore.getState().carregarMensagens(channelId, [...pagina].reverse())
      mexer(channelId, {
        primeira: 'pronto',
        // Pagina incompleta e o fim: nao ha nada antes dela.
        ...(pagina.length < TAMANHO_DA_PAGINA ? { inicio: true } : {}),
      })
    })
    .catch(() => { if (vigente) mexer(channelId, { primeira: 'falhou' }) })

  return () => { vigente = false }
}

/**
 * A pagina anterior a mensagem mais antiga em memoria.
 *
 * A trava e o estado `carregando`: o evento de rolagem dispara dezenas de vezes
 * por segundo com a caixa encostada no topo, e sem ela cada disparo pedia a
 * MESMA pagina — o servidor respondia trinta vezes, e a lista fundia trinta
 * copias por cima umas das outras.
 */
export async function carregarAnteriores(channelId: string): Promise<number> {
  const { porCanal, mexer } = useHistorico.getState()
  const atual = estadoDe(porCanal, channelId)
  if (atual.anteriores === 'carregando' || atual.inicio || atual.primeira !== 'pronto') return 0

  const maisAntiga = (useStore.getState().mensagens[channelId] ?? [])
    .find(m => m.envio === undefined)
  if (maisAntiga === undefined) return 0

  mexer(channelId, { anteriores: 'carregando' })
  try {
    const pagina = await api.get<Mensagem[]>(
      `/channels/${channelId}/messages?before=${maisAntiga.id}&limit=${String(TAMANHO_DA_PAGINA)}`,
    )
    useStore.getState().carregarMensagens(channelId, [...pagina].reverse())
    mexer(channelId, {
      anteriores: 'ocioso',
      ...(pagina.length < TAMANHO_DA_PAGINA ? { inicio: true } : {}),
    })
    return pagina.length
  } catch {
    mexer(channelId, { anteriores: 'falhou' })
    return 0
  }
}
