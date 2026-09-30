import { useEffect, useRef } from 'react'
import { create } from 'zustand'
import { useStore } from './store.js'
import { irPara, trocarPor, type Rota } from './rota.js'

/**
 * A mensagem que um link pediu para mostrar, e ate quando realca-la.
 *
 * Mora fora da lista porque quem PEDE e o roteador (um link, uma notificacao,
 * um resultado de busca) e quem MOSTRA e a lista, que talvez nem esteja
 * montada ainda quando o pedido chega.
 */
type Realce = {
  channelId: string | null
  messageId: string | null
  pedir: (channelId: string, messageId: string) => void
  concluir: () => void
}

export const useRealce = create<Realce>(set => ({
  channelId: null,
  messageId: null,
  pedir: (channelId, messageId) => set({ channelId, messageId }),
  concluir: () => set({ channelId: null, messageId: null }),
}))

/** O endereco de uma mensagem, para "copiar link" e para a notificacao. */
export function enderecoDaMensagem(grupo: string, canal: string, mensagem: string): string {
  return `${window.location.origin}/g/${grupo}/c/${canal}/m/${mensagem}`
}

/**
 * A URL e o canal aberto andam juntos, nos dois sentidos (D2-A).
 *
 * - URL -> tela: ao chegar o `ready`, e a cada Voltar/Avancar, a rota `canal`
 *   escolhe o grupo e o canal — se a pessoa ainda os enxerga. Um link para um
 *   canal que ela perdeu nao abre nada, e a tela fica onde estava.
 * - tela -> URL: trocar de canal empilha o endereco novo, e e isso que faz o
 *   Voltar do navegador voltar ao canal anterior. A PRIMEIRA escolha substitui
 *   em vez de empilhar: abrir o app nao pode deixar um "voltar" que so leva
 *   para a propria raiz.
 */
export function useRotaDoCanal(rota: Rota, ativo: boolean): void {
  const canalAtivo = useStore(e => e.canalAtivo)
  const grupoAtivo = useStore(e => e.grupoAtivo)
  const temCanais = useStore(e => e.channels.length > 0)
  /** O canal que a URL acabou de impor: nao vira um novo `pushState`. */
  const vindoDaUrl = useRef<string | null>(null)
  const jaSincronizou = useRef(false)

  // URL -> tela
  useEffect(() => {
    if (!ativo || !temCanais || rota.nome !== 'canal') return
    const { channels, escolherGrupo, escolherCanal } = useStore.getState()
    const canal = channels.find(c => c.id === rota.canal && c.groupId === rota.grupo)
    if (canal === undefined) return
    vindoDaUrl.current = canal.id
    if (useStore.getState().grupoAtivo !== canal.groupId) escolherGrupo(canal.groupId)
    escolherCanal(canal.id)
    if (rota.mensagem !== undefined) useRealce.getState().pedir(canal.id, rota.mensagem)
  }, [ativo, temCanais, rota])

  // tela -> URL
  useEffect(() => {
    if (!ativo || canalAtivo === null || grupoAtivo === null) return
    const destino: Rota = { nome: 'canal', grupo: grupoAtivo, canal: canalAtivo }
    const jaEstaLa = rota.nome === 'canal' && rota.canal === canalAtivo && rota.grupo === grupoAtivo
    if (vindoDaUrl.current === canalAtivo || jaEstaLa) {
      vindoDaUrl.current = null
      jaSincronizou.current = true
      return
    }
    // Rotas que tem tela propria por cima do app (convite, verificacao) nao
    // sao atropeladas: elas saem sozinhas quando terminam.
    if (rota.nome !== 'app' && rota.nome !== 'canal' && rota.nome !== 'entrar') return
    if (rota.nome === 'entrar' && rota.convite !== undefined) return
    if (jaSincronizou.current) irPara(destino)
    else trocarPor(destino)
    jaSincronizou.current = true
  }, [ativo, canalAtivo, grupoAtivo, rota])
}
