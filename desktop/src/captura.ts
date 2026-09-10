import { desktopCapturer, ipcMain } from 'electron'
import type { Session } from 'electron'
import { CANAIS } from './ponte'
import type { EscolhaDeFonte, FonteDeTela, SomDaTela } from './ponte'

/**
 * O compartilhamento de tela nativo, com som.
 *
 * Esta e a razao pela qual o app existe. Tres coisas que o navegador nao
 * entrega e que passam a existir aqui:
 *
 * 1. **O som.** No Chrome em Windows, compartilhar uma JANELA nunca leva
 *    audio: a caixa "compartilhar audio" so aparece para aba e para tela
 *    inteira. Quem compartilhava a janela de um jogo subia video e silencio,
 *    sem erro em lugar nenhum. `audio: 'loopback'` na resposta abaixo e a
 *    correcao inteira.
 * 2. **O seletor.** A lista sai de `desktopCapturer`, e `types` nao inclui
 *    aba de navegador — e assim que "a aba do Google" desaparece da escolha:
 *    ela nao e oferecida.
 * 3. **A qualidade.** A captura continua passando por `getDisplayMedia`, o que
 *    preserva inteira a afinacao de `web/src/lib/midia.ts`: os 60 quadros
 *    pedidos em `resolution`, o `screenShareEncoding` e a camada de reserva
 *    continuam valendo, porque nada nesse caminho foi substituido.
 *
 * O que o LiveKit publica tambem nao muda: a faixa de som chega como
 * `Track.Source.ScreenShareAudio`, que `papelDe` (midia.ts) ja classifica como
 * `'audio-tela'` — entao o volume por fonte que a interface ja tem passa a
 * valer para o som do jogo sem uma linha nova.
 */

/**
 * A escolha da pessoa, esperando pela captura que vem em seguida.
 *
 * O fluxo e deliberadamente "escolher primeiro, capturar depois", e nao o
 * inverso. O caminho oposto — o handler pedir ao renderer que mostre o seletor
 * e esperar a resposta — funciona, mas paga um preco de interface: cancelar o
 * seletor faz o `getDisplayMedia` REJEITAR, o que em `midia.ts` cai no `catch`
 * que escreve "O navegador nao liberou o dispositivo". Desistir de escolher
 * uma janela nao e um erro, e nao deve produzir a mensagem de um.
 *
 * Escolhendo antes, cancelar simplesmente nao chama a captura, e nenhum erro
 * chega a existir.
 */
let pendente: (EscolhaDeFonte & { em: number }) | null = null

/**
 * Quanto tempo a escolha continua valendo.
 *
 * Existe para que uma escolha abandonada — a pessoa escolhe, a chamada cai
 * antes de publicar — nao seja usada por uma captura disparada minutos depois,
 * transmitindo uma janela que ninguem pediu naquele momento.
 */
const VALIDADE_DA_ESCOLHA_MS = 60_000

/** Le e descarta. Uma escolha vale para UMA captura. */
function consumirEscolha(): EscolhaDeFonte | null {
  const atual = pendente
  pendente = null
  if (atual === null) return null
  if (Date.now() - atual.em > VALIDADE_DA_ESCOLHA_MS) return null
  return { id: atual.id, som: atual.som }
}

function tipoDe(id: string): 'tela' | 'janela' {
  return id.startsWith('screen:') ? 'tela' : 'janela'
}

/**
 * Liga o seletor e a captura nesta sessao.
 *
 * `idsProprios` devolve as janelas do proprio Altcast. Elas sao removidas da
 * lista porque compartilhar a propria janela produz o tunel infinito de
 * espelhos — e, pior, um laco de video que consome CPU sem nunca mostrar nada
 * util.
 */
export function registrarCaptura(sessao: Session, idsProprios: () => string[]): void {
  ipcMain.handle(CANAIS.fontes, async (): Promise<FonteDeTela[]> => {
    const proprios = new Set(idsProprios())
    const fontes = await desktopCapturer.getSources({
      types: ['screen', 'window'],
      // A miniatura e o unico jeito de reconhecer uma janela pelo titulo
      // ambiguo que o Windows costuma dar. 320x180 e o suficiente para
      // reconhecer e barato o bastante para uma lista de vinte janelas.
      thumbnailSize: { width: 320, height: 180 },
      fetchWindowIcons: true,
    })

    return fontes
      .filter(f => !proprios.has(f.id))
      .map(f => ({
        id: f.id,
        // Uma janela sem titulo existe — e uma linha vazia na lista nao e
        // escolhivel. O rotulo generico pelo menos e clicavel.
        nome: f.name.trim() === '' ? 'Janela sem titulo' : f.name,
        tipo: tipoDe(f.id),
        miniatura: f.thumbnail.toDataURL(),
        // `isEmpty()` e a checagem que importa: o Electron devolve um
        // NativeImage VAZIO, e nao `null`, quando nao ha icone. Um data URL de
        // imagem vazia renderiza como o icone quebrado do navegador.
        icone: f.appIcon !== null && !f.appIcon.isEmpty() ? f.appIcon.toDataURL() : null,
      }))
  })

  ipcMain.handle(CANAIS.escolherFonte, (_evento, id: unknown, som: unknown): void => {
    // Validacao no processo PRINCIPAL, e nao so no renderer. O renderer carrega
    // conteudo remoto; tudo que atravessa a ponte e entrada, nao promessa.
    if (typeof id !== 'string' || id === '') return
    const comSom: SomDaTela = som === 'nenhum' ? 'nenhum' : 'sistema'
    pendente = { id, som: comSom, em: Date.now() }
  })

  /**
   * `useSystemPicker` fica de fora de proposito.
   *
   * Ele existe para usar o seletor do proprio sistema operacional, e onde esta
   * disponivel o handler abaixo nem e chamado. Isso derrubaria justamente o
   * ponto do app: o seletor proprio, sem abas de navegador, com a aparencia do
   * produto.
   */
  sessao.setDisplayMediaRequestHandler(async (pedido, responder) => {
    const escolha = consumirEscolha()
    // Sem escolha nao ha captura. Nenhum outro caminho no produto chama
    // `getDisplayMedia`, entao isto aqui e uma requisicao que nao veio do botao
    // de compartilhar — negar e a resposta certa, e a unica segura numa janela
    // que carrega conteudo remoto.
    if (escolha === null) {
      responder({})
      return
    }

    // Sem miniatura: aqui a fonte serve para CAPTURAR, e gerar vinte thumbnails
    // para descartar dezenove atrasaria o inicio da transmissao sem motivo.
    const fontes = await desktopCapturer.getSources({
      types: ['screen', 'window'],
      thumbnailSize: { width: 0, height: 0 },
    })
    const fonte = fontes.find(f => f.id === escolha.id)
    // A janela foi fechada entre a escolha e a captura. Acontece, e negar e
    // melhor do que transmitir uma fonte parecida.
    if (fonte === undefined) {
      responder({})
      return
    }

    responder({
      video: fonte,
      // `audioRequested` e respeitado em vez de ignorado: se o pedido nao quer
      // som, mandar uma faixa de audio criaria uma publicacao que ninguem
      // consome. Hoje `midia.ts` sempre pede `{ audio: true }`, mas essa e uma
      // decisao dele, e nao uma invariante daqui.
      ...(pedido.audioRequested && escolha.som === 'sistema'
        ? { audio: 'loopback' as const }
        : {}),
    })
  })
}
