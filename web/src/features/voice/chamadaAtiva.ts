import { create } from 'zustand'
import {
  criarChamada, ESTADO_INICIAL, guardarProcessamento, lerProcessamento,
} from '../../lib/midia.js'
import type {
  Chamada, EstadoDaChamada, PapelSonoro, QualidadeDaTela, QualidadeDeRecepcao,
  AjusteDoTratamento, Supressao, TipoDeDispositivo,
} from '../../lib/midia.js'
import { useStore } from '../../lib/store.js'
import { destravarSons, tocar } from '../../lib/sons.js'

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
  /** Repete a entrada no mesmo canal depois de uma falha. */
  tentarDeNovo: () => Promise<void>
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
   * A supressao de ruido. Com chamada, vale na hora; sem, fica guardada para
   * a proxima — o mesmo contrato de escolher o microfone antes de entrar.
   */
  definirSupressao: (modo: Supressao) => void
  /** Intensidade, sensibilidade, nivelador e limpeza do que chega — mesmo contrato. */
  definirTratamento: (mudanca: AjusteDoTratamento) => void
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
    // O navegador so libera audio dentro de um gesto, e entrar numa chamada
    // nasce de um clique. Idempotente e barato — por isso vale a pena estar no
    // topo das acoes em vez de depender do botao de destravar, que so aparece
    // quando o som JA foi bloqueado.
    destravarSons()

    // Ja estamos nesta chamada: entrar de novo abriria uma segunda sala para o
    // mesmo canal e mandaria o audio duas vezes. A excecao e a chamada que
    // FALHOU — ela nao e uma sala, e um cadaver, e "Tentar de novo" precisa
    // passar por aqui.
    if (get().canal === channelId && viva !== null && get().chamada.fase !== 'erro') return

    // Uma chamada por vez, em todo o sistema. Duas salas abertas mandariam o
    // microfone para um canal que a pessoa acha que deixou — e agora que a
    // navegacao nao derruba mais nada, este e o unico lugar que impede isso.
    if (viva !== null) await viva.sair()

    // `let` e declarado antes: o `aoMudar` abaixo compara contra a instancia,
    // e ele pode ser chamado antes de `criarChamada` devolver.
    let nova: Chamada | null = null
    nova = criarChamada({
      channelId,
      // Lido da store a cada quadro, e nao capturado uma vez: o socket cai e
      // volta, e uma funcao capturada na criacao enviaria para sempre pela
      // conexao morta.
      enviar: quadro => useStore.getState().enviarQuadro(quadro),
      /**
       * As deixas sonoras saem daqui — da TRANSICAO de estado, e nunca do
       * clique.
       *
       * `definir()` so muda o estado depois de o navegador entregar o
       * dispositivo. Um som no clique confirmaria um microfone que a permissao
       * acabou de negar, e ensinaria a pessoa a confiar num sinal falso.
       */
      aoMudar: chamada => {
        // Uma instancia que ja foi substituida ou encerrada nao fala mais pela
        // chamada. Sem esta guarda, o `Disconnected` tardio de uma sala velha
        // apagava o estado da sala nova.
        if (nova !== null && viva !== nova) return
        const antes = get().chamada

        // A sala caiu SOZINHA — o SFU derrubou, a rede morreu de vez — com a
        // pessoa ainda "na chamada". Voltar para "fora" em silencio era a
        // contradicao que a interface exibia: a barra dizia "na chamada" e o
        // painel dizia "fora". Uma queda e uma falha, com saida.
        if (antes.fase === 'dentro' && chamada.fase === 'fora') {
          set({
            chamada: {
              ...chamada, fase: 'erro', erro: 'A conexão com a chamada caiu.',
            },
          })
          return
        }
        set({ chamada })

        if (antes.fase !== 'dentro' && chamada.fase === 'dentro') tocar('entrei')

        // As guardas de `fase` nao sao zelo: `sair()` reseta para o estado
        // inicial, que poe microfone e tela em false. Sem elas, sair de uma
        // chamada com os dois ligados dispararia tres sons de uma vez.
        if (antes.fase === 'dentro' && chamada.fase === 'dentro') {
          if (chamada.microfone !== antes.microfone) {
            tocar(chamada.microfone ? 'desmudo' : 'mudo')
          }
          if (chamada.tela !== antes.tela) {
            tocar(chamada.tela ? 'tela-ligou' : 'tela-desligou')
          }
        }
      },
      // A sala que o token descreve, aplicada assim que o token chega — antes
      // de carregar o SDK e de conectar ao SFU.
      aoConhecerSala: participantes => {
        useStore.getState().semearSala(channelId, participantes)
      },
    })
    const instancia = nova
    viva = instancia
    set({ canal: channelId, chamada: ESTADO_INICIAL })

    /**
     * Aparecer na propria lista ANTES da ida ao servidor.
     *
     * `entrar()` so manda `voice.join` depois do token, do carregamento do SDK
     * e da conexao de midia — de um a quatro segundos em que quem clicou
     * "entrar" nao se ve em lugar nenhum e conclui que o botao nao funcionou.
     *
     * Passa por `aplicarEvento`, e nao por uma acao propria, para que o
     * caminho otimista e o caminho do servidor atravessem exatamente o mesmo
     * redutor e nao possam divergir. O eco do servidor cai por cima depois:
     * `fundirParticipante` dedupa por `userId`.
     */
    const eu = useStore.getState().user?.id
    const desfazer = (): void => {
      if (eu === undefined) return
      useStore.getState().aplicarEvento({
        t: 'voice.participant_left', d: { channelId, userId: eu },
      })
    }
    if (eu !== undefined) {
      useStore.getState().aplicarEvento({
        t: 'voice.participant_joined',
        d: { channelId, userId: eu, microfone: false, camera: false, tela: false },
      })
    }

    try {
      await instancia.entrar()
    } catch (erro) {
      // Nao deixar o otimismo virar mentira permanente.
      desfazer()
      throw erro
    }
    // `entrar()` nao lanca na maioria das falhas: ele as engole e poe
    // `fase: 'erro'`. Sem esta segunda checagem o `catch` acima cobriria so o
    // caso raro (o import do SDK rejeitar) e deixaria o comum passar.
    if (get().chamada.fase === 'erro') desfazer()
  },

  tentarDeNovo: async () => {
    const canal = get().canal
    if (canal === null) return
    await get().entrar(canal)
  },

  sair: async () => {
    const atual = viva
    // Antes do reset: o estado inicial apaga `fase`, e o som de saida sairia
    // pela guarda de transicao la em cima sem nunca tocar.
    if (atual !== null) tocar('sai')
    viva = null
    set({ canal: null, chamada: ESTADO_INICIAL })
    await atual?.sair()
  },

  alternarMicrofone: () => {
    destravarSons()
    void viva?.definirMicrofone(!get().chamada.microfone)
  },
  definirMicrofone: ligado => { void viva?.definirMicrofone(ligado) },
  alternarSurdo: () => { void viva?.definirSurdo(!get().chamada.surdo) },
  definirSupressao: modo => {
    if (viva !== null) {
      viva.definirSupressao(modo)
      return
    }
    guardarProcessamento({ ...lerProcessamento(), supressao: modo })
  },
  definirTratamento: mudanca => {
    if (viva !== null) {
      viva.definirTratamento(mudanca)
      return
    }
    guardarProcessamento({ ...lerProcessamento(), ...mudanca })
  },
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
/**
 * Reanuncia a chamada quando o socket volta.
 *
 * Mora aqui, e nao em `socket.ts`, por camada: o socket nao conhece chamada
 * nenhuma, e ensina-lo sobre voz para resolver isto faria o transporte
 * depender de uma feature. `reconciliar()` cuida do buraco das MENSAGENS;
 * este cuida do buraco da PRESENCA — dois buracos com a mesma causa.
 *
 * So na TRANSICAO para conectado: o `subscribe` do zustand dispara a cada
 * `set` da store, e sem a deteccao de borda o medidor de nivel sozinho
 * produziria dez `voice.join` por segundo.
 */
export function registrarReanuncioDaChamada(): () => void {
  let anterior = useStore.getState().conexao
  return useStore.subscribe(estado => {
    const agora = estado.conexao
    if (agora === 'conectado' && anterior !== 'conectado') viva?.reanunciar()
    anterior = agora
  })
}

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
