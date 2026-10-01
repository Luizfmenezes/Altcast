import { useEffect } from 'react'
import { create } from 'zustand'
import { ehConversa, useStore } from './store.js'
import { MOSTRAR_CANAL } from './instalacao.js'
import { decidir, meMenciona, canalSilenciado } from './atencao.js'
import { tocar } from './sons.js'
import { irPara } from './rota.js'
import { nativo } from './nativo.js'
import type { Mensagem } from './tipos.js'

/**
 * Notificacoes do sistema, som de mensagem e o numero no titulo (Etapa 2).
 *
 * A permissao do navegador e pedida no PRIMEIRO MOMENTO UTIL — logo depois da
 * primeira mencao recebida, com uma frase explicando por que — e nunca no
 * carregamento. Pedir de cara, sem contexto, e o jeito mais eficiente de
 * ganhar um "bloquear" permanente: a pessoa ainda nao sabe para que serve.
 */

const CHAVE_RECUSA = 'altcast:notificacoes-recusadas'

type EstadoDoPedido = {
  /** Mostrar a faixa "Quer ser avisado quando alguem mencionar voce?" */
  oferecer: boolean
  definirOferta: (oferecer: boolean) => void
}

export const usePedidoDeNotificacao = create<EstadoDoPedido>(set => ({
  oferecer: false,
  definirOferta: oferecer => set({ oferecer }),
}))

export function permissao(): NotificationPermission | 'indisponivel' {
  if (typeof Notification === 'undefined') return 'indisponivel'
  return Notification.permission
}

function recusouAntes(): boolean {
  try { return localStorage.getItem(CHAVE_RECUSA) === '1' } catch { return false }
}

export function recusarNotificacoes(): void {
  usePedidoDeNotificacao.getState().definirOferta(false)
  try { localStorage.setItem(CHAVE_RECUSA, '1') } catch { /* so nesta visita */ }
}

/** Pede a permissao — so dentro do clique da faixa, que e o gesto que o navegador exige. */
export async function ativarNotificacoes(): Promise<void> {
  usePedidoDeNotificacao.getState().definirOferta(false)
  if (permissao() !== 'default') return
  try {
    const r = await Notification.requestPermission()
    if (r === 'denied') recusarNotificacoes()
  } catch { /* navegador antigo: fica sem */ }
}

/**
 * A conversa do canal ativo esta mesmo na tela?
 *
 * No desktop sempre esta: o canal ativo e a coluna do meio. No celular nao —
 * o canal ativo continua escolhido enquanto a pessoa olha a lista de grupos,
 * e calar o aviso ali seria engolir justamente a mensagem que ela nao viu.
 * O shell do celular avisa por aqui quando a conversa sai e volta.
 */
let conversaNaTela = true
export function definirConversaNaTela(naTela: boolean): void {
  conversaNaTela = naTela
}

/** A pagina esta na frente, com foco, olhando este canal? */
function estaOlhando(channelId: string): boolean {
  const visivel = typeof document !== 'undefined' && document.visibilityState === 'visible'
    && document.hasFocus()
  return visivel && conversaNaTela && useStore.getState().canalAtivo === channelId
}

/**
 * Uma mensagem nova chegou pelo socket: som e notificacao, se for o caso.
 *
 * Chamado DEPOIS de a store aplicar o evento, do mesmo lugar onde nascem as
 * deixas sonoras de voz — o unico ponto do sistema em que "veio do servidor"
 * e fato, e nao suposicao.
 */
export function avisarMensagem(mensagem: Mensagem): void {
  const estado = useStore.getState()
  const canal = estado.channels.find(c => c.id === mensagem.channelId)
  if (canal === undefined) return
  const decisao = decidir(estado, canal, mensagem)
  const mencao = meMenciona(mensagem, estado.user?.id ?? null)

  // A primeira mencao e o momento de oferecer as notificacoes do sistema.
  if (mencao && !canalSilenciado(estado, canal) && permissao() === 'default' && !recusouAntes()) {
    usePedidoDeNotificacao.getState().definirOferta(true)
  }

  if (decisao !== 'notificar') return
  if (estaOlhando(mensagem.channelId)) return

  // Numa conversa direta toda mensagem e dirigida a mim: soa como mencao.
  const direta = ehConversa(estado.groups.find(g => g.id === canal.groupId))
  tocar(mencao || direta ? 'mencao' : 'mensagem')
  mostrarNotificacao(mensagem, canal.groupId, direta ? null : canal.name)
}

/**
 * O aviso do sistema. `nomeDoCanal` nulo e conversa direta: o titulo e so a
 * pessoa, como em todo mensageiro.
 */
export function mostrarNotificacao(mensagem: Mensagem, grupo: string, nomeDoCanal: string | null): void {
  if (permissao() !== 'granted') return
  const estado = useStore.getState()
  const autor = estado.members.find(m => m.userId === mensagem.authorId)
  const nome = autor?.displayName ?? 'Alguém'
  const titulo = nomeDoCanal === null ? nome : `${nome} em #${nomeDoCanal}`
  const opcoes: NotificationOptions = {
    body: mensagem.content === '' ? 'Enviou um arquivo' : mensagem.content.slice(0, 180),
    // Uma notificacao por canal, que se substitui: dez mensagens seguidas
    // num canal viram um aviso atualizado, e nao uma pilha de dez.
    tag: mensagem.channelId,
    icon: autor?.avatarUrl ?? '/android-chrome-192x192.png',
    data: { url: `/g/${grupo}/c/${mensagem.channelId}/m/${mensagem.id}` },
  }
  try {
    const aviso = new Notification(titulo, opcoes)
    aviso.onclick = () => {
      window.focus()
      irPara({ nome: 'canal', grupo, canal: mensagem.channelId, mensagem: mensagem.id })
      window.dispatchEvent(new Event(MOSTRAR_CANAL))
      aviso.close()
    }
  } catch {
    // O Chrome do Android so notifica pelo Service Worker — e e la que o app
    // instalado mora. O clique e tratado em `sw.js`, que foca a janela.
    void navigator.serviceWorker?.getRegistration()
      .then(r => r?.showNotification(titulo, opcoes))
      .catch(() => undefined)
  }
}

/** A contagem que aparece no titulo, no favicon e no icone do app. */
export function resumoDeAtencao(): { mencoes: number; canaisNaoLidos: number } {
  const e = useStore.getState()
  let mencoes = 0
  let canaisNaoLidos = 0
  for (const c of e.channels) {
    const n = e.naoLidas[c.id]
    if (n === undefined) continue
    mencoes += n.mentions
    if (n.n > 0 && !canalSilenciado(e, c)) canaisNaoLidos += 1
  }
  return { mencoes, canaisNaoLidos }
}

const TITULO_BASE = 'Altcast'
let faviconOriginal: string | null = null

/** O favicon com um ponto azul no canto, desenhado uma vez por mudanca. */
function desenharFavicon(comPonto: boolean): void {
  const link = document.querySelector<HTMLLinkElement>('link[rel~="icon"]')
  if (link === null) return
  faviconOriginal ??= link.href
  if (!comPonto) { link.href = faviconOriginal; return }
  const img = new Image()
  img.onload = () => {
    const canvas = document.createElement('canvas')
    canvas.width = 32
    canvas.height = 32
    const ctx = canvas.getContext('2d')
    if (ctx === null) return
    ctx.drawImage(img, 0, 0, 32, 32)
    ctx.beginPath()
    ctx.arc(24, 8, 7, 0, Math.PI * 2)
    ctx.fillStyle = '#3b82f6'
    ctx.fill()
    ctx.lineWidth = 2
    ctx.strokeStyle = '#06070a'
    ctx.stroke()
    link.href = canvas.toDataURL('image/png')
  }
  img.src = faviconOriginal
}

/**
 * Mantem titulo, favicon e badge em dia com as nao lidas.
 *
 * Mencao mostra o numero: `(3) Altcast`. Nao lida sem mencao mostra so o
 * ponto: `• Altcast`. O numero de mensagens num canal movimentado nao muda
 * decisao nenhuma; "alguem falou comigo" muda.
 */
export function useIndicadorDeAtencao(ativo: boolean): void {
  const naoLidas = useStore(e => e.naoLidas)
  const preferencias = useStore(e => e.preferencias)
  useEffect(() => {
    if (!ativo) { document.title = TITULO_BASE; return }
    const { mencoes, canaisNaoLidos } = resumoDeAtencao()
    document.title = mencoes > 0
      ? `(${mencoes > 99 ? '99+' : String(mencoes)}) ${TITULO_BASE}`
      : canaisNaoLidos > 0 ? `• ${TITULO_BASE}` : TITULO_BASE
    try { desenharFavicon(mencoes > 0 || canaisNaoLidos > 0) } catch { /* sem canvas */ }

    const nav = navigator as Navigator & {
      setAppBadge?: (n?: number) => Promise<void>
      clearAppBadge?: () => Promise<void>
    }
    if (mencoes > 0) void nav.setAppBadge?.(mencoes).catch(() => undefined)
    else if (canaisNaoLidos > 0) void nav.setAppBadge?.().catch(() => undefined)
    else void nav.clearAppBadge?.().catch(() => undefined)

    // No app de desktop, o contador vai para o icone da barra de tarefas.
    void nativo()?.pedirAtencao?.(mencoes > 0
      ? { tipo: 'nao-lidos', quantidade: mencoes }
      : { tipo: 'nenhum' }).catch(() => undefined)
  }, [ativo, naoLidas, preferencias])
}
