import { useEffect, useState, useSyncExternalStore } from 'react'
import { api } from '../../lib/api.js'
import { nativo } from '../../lib/nativo.js'
import type { PedidoDeAtividade } from '../../lib/nativo.js'
import { possoNoGrupo, useStore } from '../../lib/store.js'
import type { Canal, Grupo } from '../../lib/tipos.js'
import { useChamadaAtiva } from '../voice/chamadaAtiva.js'

/**
 * O cartao "Transmitindo no Altcast" no perfil do Discord.
 *
 * So existe no app de desktop: o Rich Presence fala com o Discord por um pipe
 * local, e uma pagina no navegador nao alcanca pipe nenhum. No navegador este
 * modulo inteiro e inerte — `nativo()?.definirAtividade` nao existe.
 *
 * A pagina diz FATOS (em chamada, transmitindo, qual grupo, o link); o texto e
 * o botao sao montados e conferidos pelo processo principal do desktop.
 */

const CHAVE = 'altcast:discord'
const EVENTO = 'altcast:discord-preferencia'

/** Ligado por padrao; a pessoa desliga em Configuracoes. */
export function lerPreferenciaDoDiscord(): boolean {
  try {
    return window.localStorage.getItem(CHAVE) !== 'nao'
  } catch {
    return true
  }
}

export function definirPreferenciaDoDiscord(ligado: boolean): void {
  try {
    window.localStorage.setItem(CHAVE, ligado ? 'sim' : 'nao')
  } catch {
    // Armazenamento bloqueado: vale so ate fechar o app, e isso basta.
  }
  window.dispatchEvent(new Event(EVENTO))
}

export function usarPreferenciaDoDiscord(): boolean {
  return useSyncExternalStore(
    aviso => {
      window.addEventListener(EVENTO, aviso)
      return () => window.removeEventListener(EVENTO, aviso)
    },
    lerPreferenciaDoDiscord,
  )
}

/** Este app sabe falar com o Discord? (Desktop com versao que tem a ponte.) */
export function temDiscord(): boolean {
  return typeof nativo()?.definirAtividade === 'function'
}

export type FatosDaChamada = {
  clientId: string | null
  ligado: boolean
  emChamada: boolean
  tela: boolean
  canal: Canal | undefined
  grupo: Grupo | undefined
  podeConvidar: boolean
  emailVerificado: boolean
  userId: string | undefined
  origem: string
  inicioDaChamada: number | null
  inicioDaTela: number | null
}

/**
 * A regra inteira, sem React: o que mandar ao Discord, ou `null` para nada.
 *
 * O botao so existe quando o pedido teria como dar certo do outro lado — tela
 * ligada, canal publico, e quem transmite com permissao de convidar e e-mail
 * confirmado. E a mesma conta que `transmissaoAberta` faz no servidor; aqui ela
 * so evita mostrar um botao que levaria a "esta transmissao nao aceita pedidos".
 */
export function montarPedidoDeAtividade(f: FatosDaChamada): PedidoDeAtividade | null {
  if (f.clientId === null || !f.ligado || !f.emChamada || f.inicioDaChamada === null) return null
  if (f.canal === undefined || f.grupo === undefined) return null

  // Numa conversa direta, o nome do "grupo" e quem esta do outro lado. Isso nao
  // vai para o perfil de ninguem.
  const conversa = f.grupo.kind === 'dm'
  const transmitindo = f.tela && f.inicioDaTela !== null
  const aceitaPedido = transmitindo && !conversa && f.canal.visibility === 'public'
    && f.podeConvidar && f.emailVerificado && f.userId !== undefined

  return {
    clientId: f.clientId,
    estado: transmitindo ? 'transmitindo' : 'chamada',
    grupo: conversa ? null : f.grupo.name,
    desde: transmitindo ? f.inicioDaTela! : f.inicioDaChamada,
    linkParaAssistir: aceitaPedido ? `${f.origem}/assistir/${f.userId!}/${f.canal.id}` : null,
  }
}

/**
 * O instante em que `chave` passou a valer, ou `null` enquanto ela e `null`.
 *
 * E o "ha 12:34" do cartao: trocar de canal ou religar a tela recomeca a
 * contagem, e um re-render qualquer nao.
 */
function usarInicio(chave: string | null): number | null {
  const [inicio, setInicio] = useState<{ chave: string; em: number } | null>(null)
  useEffect(() => {
    setInicio(chave === null ? null : { chave, em: Date.now() })
  }, [chave])
  return inicio !== null && inicio.chave === chave ? inicio.em : null
}

/** O Client ID mora no servidor (`DISCORD_CLIENT_ID`); sem ele, nada acontece. */
function usarClientId(ativo: boolean): string | null {
  const [clientId, setClientId] = useState<string | null>(null)
  useEffect(() => {
    if (!ativo) return
    let vigente = true
    api.get<{ clientId: string | null }>('/discord')
      .then(r => { if (vigente) setClientId(typeof r.clientId === 'string' ? r.clientId : null) })
      .catch(() => undefined)
    return () => { vigente = false }
  }, [ativo])
  return clientId
}

export function usarAtividadeNoDiscord(comSessao: boolean): void {
  const ativo = comSessao && temDiscord()
  const clientId = usarClientId(ativo)
  const ligado = usarPreferenciaDoDiscord()

  const canalId = useChamadaAtiva(e => e.canal)
  const fase = useChamadaAtiva(e => e.chamada.fase)
  const telaLigada = useChamadaAtiva(e => e.chamada.tela)
  const emChamada = canalId !== null && fase === 'dentro'
  const tela = emChamada && telaLigada

  const canal = useStore(e => (canalId === null ? undefined : e.channels.find(c => c.id === canalId)))
  const grupo = useStore(e => (canal === undefined ? undefined : e.groups.find(g => g.id === canal.groupId)))
  const podeConvidar = useStore(e => (canal === undefined ? false : possoNoGrupo(e, canal.groupId, 'group.invite')))
  const user = useStore(e => e.user)

  const inicioDaChamada = usarInicio(emChamada ? canalId : null)
  const inicioDaTela = usarInicio(tela ? canalId : null)

  const pedido = ativo
    ? montarPedidoDeAtividade({
      clientId, ligado, emChamada, tela, canal, grupo, podeConvidar,
      // Ausente e servidor anterior a confirmacao de e-mail: la todo mundo convida.
      emailVerificado: user?.emailVerifiedAt !== null,
      userId: user?.id,
      origem: window.location.origin,
      inicioDaChamada, inicioDaTela,
    })
    : null

  // Serializado para a dependencia: um objeto novo a cada render com o mesmo
  // conteudo nao pode virar uma ida ao processo principal.
  const chave = pedido === null ? null : JSON.stringify(pedido)

  useEffect(() => {
    if (!ativo) return
    const ponte = nativo()
    if (typeof ponte?.definirAtividade !== 'function') return
    const atual = chave === null ? null : JSON.parse(chave) as PedidoDeAtividade
    ponte.definirAtividade(atual).catch(() => undefined)
  }, [ativo, chave])

  // Sair da sessao limpa o cartao: o perfil nao pode seguir dizendo "em
  // chamada" de uma conta que ja nao esta aqui.
  useEffect(() => {
    if (!ativo) return
    return () => { nativo()?.definirAtividade?.(null).catch(() => undefined) }
  }, [ativo])
}
