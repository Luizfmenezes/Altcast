import { useEffect } from 'react'
import { create } from 'zustand'
import { useStore } from './store.js'
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

function permissao(): NotificationPermission | 'indisponivel' {
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

/** A pagina esta na frente, com foco, olhando este canal? */
function estaOlhando(channelId: string): boolean {
  const visivel = typeof document !== 'undefined' && document.visibilityState === 'visible'
    && document.hasFocus()
  return visivel && useStore.getState().canalAtivo === channelId
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

  // Nivel Inteligente sem mencao: quem decide e o servidor (ver `ia/`), que
  // manda `attention.suggested` quando a triagem julga que vale.
  if (decisao !== 'notificar') return
  if (estaOlhando(mensagem.channelId)) return

  tocar(mencao ? 'mencao' : 'mensagem')
  mostrarNotificacao(mensagem, canal.groupId, canal.name)
}

/**
 * A triagem do servidor julgou que esta mensagem merece a atencao desta
 * pessoa, que escolheu o nivel Inteligente (secao 7.3). A mensagem ja esta na
 * store (chegou antes, pelo `message.created`); aqui so se decide o aviso,
 * pelas mesmas regras de silencio, foco e "nao perturbe".
 */
export function avisarAtencaoSugerida(d: { channelId: string; messageId: string }): void {
  const estado = useStore.getState()
  const canal = estado.channels.find(c => c.id === d.channelId)
  const mensagem = estado.mensagens[d.channelId]?.find(m => m.id === d.messageId)
  if (canal === undefined || mensagem === undefined) return
  if (estado.user?.status === 'dnd' || canalSilenciado(estado, canal)) return
  if (estaOlhando(d.channelId)) return
  tocar('mensagem')
  mostrarNotificacao(mensagem, canal.groupId, canal.name)
}

export function mostrarNotificacao(mensagem: Mensagem, grupo: string, nomeDoCanal: string): void {
  if (permissao() !== 'granted') return
  const estado = useStore.getState()
  const autor = estado.members.find(m => m.userId === mensagem.authorId)
  try {
    const aviso = new Notification(`${autor?.displayName ?? 'Alguém'} em #${nomeDoCanal}`, {
      body: mensagem.content === '' ? 'Enviou um arquivo' : mensagem.content.slice(0, 180),
      // Uma notificacao por canal, que se substitui: dez mensagens seguidas
      // num canal viram um aviso atualizado, e nao uma pilha de dez.
      tag: mensagem.channelId,
      icon: autor?.avatarUrl ?? '/android-chrome-192x192.png',
    })
    aviso.onclick = () => {
      window.focus()
      irPara({ nome: 'canal', grupo, canal: mensagem.channelId, mensagem: mensagem.id })
      aviso.close()
    }
  } catch { /* alguns navegadores so notificam via Service Worker: fica sem */ }
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

/** O favicon com um ponto ambar no canto, desenhado uma vez por mudanca. */
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
    ctx.fillStyle = '#f59e0b'
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
