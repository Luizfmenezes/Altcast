import { create } from 'zustand'
import { irPara, lerRota } from './rota.js'

/**
 * O app instalavel (PWA): registro do service worker e o convite para instalar.
 *
 * O Chrome so oferece instalar por um evento que dispara UMA vez, cedo, e
 * quase sempre antes de qualquer tela que queira usa-lo existir. Por isso ele
 * e capturado aqui, no arranque, e guardado numa store: o botao "Instalar" da
 * aba "Voce" pode aparecer minutos depois e ainda ter o que chamar.
 */

/** O evento que o Chrome entrega; o TypeScript ainda nao o declara. */
type PedidoDeInstalacao = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

type Estado = {
  /** O Chrome deixou instalar, e a pessoa ainda nao respondeu. */
  pedido: PedidoDeInstalacao | null
  /** Ja esta rodando como app (tela inicial, janela propria). */
  instalado: boolean
  instalar: () => Promise<boolean>
}

/** Rodando como app, e nao numa aba? Cobre o Android e o iOS. */
export function rodandoComoApp(): boolean {
  if (typeof window === 'undefined') return false
  const ios = (navigator as Navigator & { standalone?: boolean }).standalone === true
  return ios || (typeof matchMedia === 'function' && matchMedia('(display-mode: standalone)').matches)
}

/**
 * iPhone e iPad no Safari: nao ha evento de instalacao — o caminho e o menu
 * Compartilhar. A tela precisa saber disso para ensinar, em vez de calar.
 */
export function ehIos(): boolean {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent
  return /iPhone|iPad|iPod/.test(ua) || (ua.includes('Macintosh') && navigator.maxTouchPoints > 1)
}

export const useInstalacao = create<Estado>((set, get) => ({
  pedido: null,
  instalado: rodandoComoApp(),
  instalar: async () => {
    const pedido = get().pedido
    if (pedido === null) return false
    await pedido.prompt()
    const { outcome } = await pedido.userChoice
    // O mesmo evento nao serve duas vezes: o Chrome manda outro se quiser.
    set({ pedido: null })
    return outcome === 'accepted'
  },
}))

/** Pede a tela que mostre a conversa que a URL acabou de apontar (no celular). */
export const MOSTRAR_CANAL = 'altcast:mostrar-canal'

/**
 * Liga tudo no arranque. Chamado uma vez, em `main.tsx`.
 *
 * O service worker so em producao: em desenvolvimento ele serviria o index de
 * cache por cima do servidor do Vite, e o recarregamento a quente pararia de
 * funcionar sem erro nenhum na tela.
 */
export function ligarApp(opcoes: { registrar: boolean }): void {
  window.addEventListener('beforeinstallprompt', evento => {
    // Sem isto o Chrome mostra a propria faixa, na hora dele. O convite e
    // nosso, no lugar certo da interface.
    evento.preventDefault()
    useInstalacao.setState({ pedido: evento as PedidoDeInstalacao })
  })
  window.addEventListener('appinstalled', () => {
    useInstalacao.setState({ pedido: null, instalado: true })
  })

  if (!opcoes.registrar || !('serviceWorker' in navigator)) return
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js').catch(() => undefined)
  })
  // A notificacao clicada no Android chega como mensagem do service worker.
  navigator.serviceWorker.addEventListener('message', (evento: MessageEvent) => {
    const dados = evento.data as { tipo?: string; url?: string } | null
    if (dados?.tipo !== 'abrir' || typeof dados.url !== 'string') return
    const destino = new URL(dados.url, window.location.origin)
    irPara(lerRota(destino))
    window.dispatchEvent(new Event(MOSTRAR_CANAL))
  })
}
