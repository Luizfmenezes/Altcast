import { create } from 'zustand'
import { criarChamada, ESTADO_INICIAL } from '../../lib/midia.js'
import type {
  Chamada, EstadoDaChamada, PapelSonoro, QualidadeDaTela, QualidadeDeRecepcao,
  TipoDeDispositivo,
} from '../../lib/midia.js'
import { useStore } from '../../lib/store.js'

/**
 * A chamada como estado da APLICACAO, e nao de um componente.
 *
 * Ate aqui a chamada morava dentro de `useChamada`, e o desmonte a derrubava. O
 * comentario que defendia isso estava certo sobre o risco — microfone aberto
 * por engano e um defeito serio — e errado sobre o preco: ler outro canal
 * custava a chamada inteira. No Discord voce navega o servidor todo e a
 * conversa segue numa barra no rodape.
 *
 * Este modulo existe separado de `lib/store.ts` de proposito. A chamada
 * precisa de vida propria acima da arvore de componentes, que e o que a store
 * daria — mas nao precisa morar dentro do estado que a aplicacao inteira le e
 * que todo teste monta. Um `set` errado aqui derruba uma chamada; dentro da
 * store, derrubaria a lista de canais junto.
 *
 * A garantia perdida com o fim do desmonte e reposta por tres caminhos, e os
 * tres sao condicao de aceite, nao enfeite:
 *
 * 1. `registrarSaidaDaAba` derruba a chamada ao fechar a aba.
 * 2. Entrar num segundo canal de voz derruba o primeiro, explicitamente.
 * 3. A barra de chamada mostra o microfone em TODA tela do sistema. E ela que
 *    substitui a protecao antiga: um microfone aberto fica visivel o tempo
 *    todo, em vez de depender de a pessoa estar olhando o canal certo.
 */

/**
 * A instancia viva. Fica fora do estado reativo porque nao e um valor a
 * pintar: e um objeto com ciclo de vida, e coloca-lo no `set` faria cada
 * medicao de nivel do microfone — dez por segundo — comparar uma sala inteira.
 */
let viva: Chamada | null = null

export type EstadoDaChamadaAtiva = {
  /** O canal onde a chamada esta. `null` quando nao ha chamada nenhuma. */
  canal: string | null
  chamada: EstadoDaChamada

  entrar: (channelId: string) => Promise<void>
  sair: () => Promise<void>
  alternarMicrofone: () => void
  alternarCamera: () => void
  alternarTela: () => void
  trocarDispositivo: (tipo: TipoDeDispositivo, deviceId: string) => void
  destravarAudio: () => void
  definirVolume: (userId: string, papel: PapelSonoro, volume: number) => void
  restaurarVolumes: () => void
  definirQualidade: (qualidade: QualidadeDaTela) => void
  definirQualidadeDeRecepcao: (sid: string, nivel: QualidadeDeRecepcao) => void
  alternarSurdo: () => void
  /**
   * Liga e desliga o microfone SEM alternar: o push-to-talk precisa dizer
   * "agora ligado" e "agora desligado", e nao "o contrario do que estiver" —
   * duas teclas soltas em sequencia rapida inverteriam o estado errado.
   */
  definirMicrofone: (ligado: boolean) => void
}

export const useChamadaAtiva = create<EstadoDaChamadaAtiva>((set, get) => ({
  canal: null,
  chamada: ESTADO_INICIAL,

  entrar: async (channelId: string) => {
    // Ja estamos nesta chamada: entrar de novo abriria uma segunda sala para o
    // mesmo canal e mandaria o audio duas vezes.
    if (get().canal === channelId && viva !== null) return

    // Uma chamada por vez, em todo o sistema. Duas salas abertas mandariam o
    // microfone para um canal que a pessoa acha que deixou — e agora que a
    // navegacao nao derruba mais nada, este e o unico lugar que impede isso.
    if (viva !== null) await viva.sair()

    const nova = criarChamada({
      channelId,
      // Lido da store a cada quadro, e nao capturado uma vez: o socket cai e
      // volta, e uma funcao capturada na criacao enviaria para sempre pela
      // conexao morta.
      enviar: quadro => useStore.getState().enviarQuadro(quadro),
      aoMudar: chamada => { set({ chamada }) },
    })
    viva = nova
    set({ canal: channelId, chamada: ESTADO_INICIAL })
    await nova.entrar()
  },

  sair: async () => {
    const atual = viva
    viva = null
    set({ canal: null, chamada: ESTADO_INICIAL })
    await atual?.sair()
  },

  alternarMicrofone: () => { void viva?.definirMicrofone(!get().chamada.microfone) },
  definirMicrofone: ligado => { void viva?.definirMicrofone(ligado) },
  alternarSurdo: () => { void viva?.definirSurdo(!get().chamada.surdo) },
  alternarCamera: () => { void viva?.definirCamera(!get().chamada.camera) },
  alternarTela: () => { void viva?.definirTela(!get().chamada.tela) },
  trocarDispositivo: (tipo, deviceId) => { void viva?.trocarDispositivo(tipo, deviceId) },
  destravarAudio: () => { void viva?.destravarAudio() },
  definirVolume: (userId, papel, volume) => { viva?.definirVolume(userId, papel, volume) },
  restaurarVolumes: () => { viva?.restaurarVolumes() },
  definirQualidade: qualidade => { viva?.definirQualidade(qualidade) },
  definirQualidadeDeRecepcao: (sid, nivel) => { viva?.definirQualidadeDeRecepcao(sid, nivel) },
}))

/**
 * Derruba a chamada quando a aba fecha.
 *
 * E metade da protecao que o desmonte dava, e a metade que NENHUMA interface
 * repoe: quem fecha a aba nao ve barra nenhuma. Sem isto, o microfone ficaria
 * aberto no SFU ate o tempo de saida do servidor expirar, e a sala continuaria
 * mostrando alguem que ja foi embora.
 *
 * Os dois eventos, e nao um: `beforeunload` nao dispara de forma confiavel em
 * navegador movel, onde a aba costuma ser descartada em segundo plano —
 * `pagehide` e o que cobre esse caminho. Disparar duas vezes e inofensivo: a
 * segunda encontra `viva` ja nulo.
 */
export function registrarSaidaDaAba(): () => void {
  const derrubar = (): void => { void useChamadaAtiva.getState().sair() }
  window.addEventListener('beforeunload', derrubar)
  window.addEventListener('pagehide', derrubar)
  return () => {
    window.removeEventListener('beforeunload', derrubar)
    window.removeEventListener('pagehide', derrubar)
  }
}

/** So para teste: devolve o modulo ao estado de quem nunca entrou numa sala. */
export function zerarChamadaParaTeste(): void {
  viva = null
  useChamadaAtiva.setState({ canal: null, chamada: ESTADO_INICIAL })
}

/**
 * So para teste: planta uma chamada duble no lugar da instancia viva.
 *
 * O ciclo de vida — quem derruba quem, e quando — e justamente a parte desta
 * fase que nao da para provar sem um SFU de pe, e e a parte que mais importa:
 * ela substitui uma garantia que foi removida de proposito. Uma costura aqui
 * custa tres linhas; a alternativa seria deixar sem prova exatamente o risco
 * que a fase introduz.
 */
export function plantarChamadaParaTeste(duble: Chamada, channelId: string): void {
  viva = duble
  useChamadaAtiva.setState({ canal: channelId, chamada: ESTADO_INICIAL })
}
