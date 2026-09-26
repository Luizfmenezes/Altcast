import { app, Menu, nativeImage, Tray } from 'electron'
import type { BrowserWindow, NativeImage } from 'electron'
import { join } from 'node:path'
import { CANAIS } from './ponte'
import type { PedidoDeAtencao } from './ponte'

/**
 * O icone perto do relogio, e o que ele muda no ciclo de vida do app.
 *
 * Isto NAO e um icone: e uma mudanca de ciclo de vida. Fechar passa a
 * esconder, o que significa que alguem que "fechou" o Altcast pode continuar
 * numa chamada de voz, com o microfone aberto, sem nenhuma janela mostrando
 * isso. Toda a justificativa de `registrarSaidaDaAba`, no lado web, e que
 * chamada escondida com microfone aberto e inaceitavel.
 *
 * Por isso a bandeja entra COM tres travas, e nao sem elas:
 *
 * 1. o icone e a dica mudam enquanto houver chamada;
 * 2. o menu tem "Sair da chamada" sempre que houver uma;
 * 3. a primeira vez que alguem fecha a janela recebe um aviso de que o app
 *    continua rodando.
 */

let bandeja: Tray | null = null
let emChamada = false
let avisouDaPrimeiraVez = false
/** `true` a partir do `before-quit`: o `close` deixa de esconder e deixa sair. */
let saindoDeVerdade = false

function icone(): NativeImage {
  // `recursos/icon.ico` ja acompanha o instalador. Um icone vazio e melhor do
  // que uma excecao no arranque: sem ele a bandeja simplesmente nao aparece.
  const img = nativeImage.createFromPath(join(__dirname, '..', 'recursos', 'icon.ico'))
  return img.isEmpty() ? nativeImage.createEmpty() : img
}

function montarMenu(janela: BrowserWindow): Menu {
  return Menu.buildFromTemplate([
    {
      label: 'Abrir o Altcast',
      click: () => {
        janela.show()
        janela.focus()
      },
    },
    ...(emChamada
      ? [
        { type: 'separator' as const },
        {
          // A trava que torna a bandeja aceitavel: sem uma saida daqui, uma
          // chamada com a janela escondida so termina reabrindo a janela — e
          // quem escondeu pode nem lembrar que ela existe.
          label: 'Sair da chamada',
          click: () => { janela.webContents.send(CANAIS.sairDaChamada) },
        },
      ]
      : []),
    { type: 'separator' },
    {
      label: 'Sair do Altcast',
      click: () => {
        saindoDeVerdade = true
        app.quit()
      },
    },
  ])
}

function atualizar(janela: BrowserWindow): void {
  if (bandeja === null) return
  bandeja.setToolTip(emChamada ? 'Altcast — em chamada' : 'Altcast')
  bandeja.setContextMenu(montarMenu(janela))
}

export function registrarBandeja(janela: BrowserWindow): void {
  bandeja = new Tray(icone())
  atualizar(janela)

  bandeja.on('click', () => {
    if (janela.isVisible()) return janela.focus()
    janela.show()
  })

  app.on('before-quit', () => { saindoDeVerdade = true })

  janela.on('close', evento => {
    // Sair de verdade — pelo menu, ou pelo sistema encerrando — passa direto.
    if (saindoDeVerdade) return

    evento.preventDefault()
    janela.hide()

    if (!avisouDaPrimeiraVez) {
      avisouDaPrimeiraVez = true
      // Balao, e nao dialogo: quem fechou a janela quis se livrar dela, e uma
      // caixa modal no lugar seria justamente o oposto. No Linux o Electron
      // ignora e nao acontece nada, que tambem esta bem.
      bandeja?.displayBalloon({
        title: 'O Altcast continua rodando',
        content: 'Ele esta aqui perto do relogio. Para sair de vez, use "Sair do Altcast".',
      })
    }
  })
}

/** Ha chamada em curso? Muda o icone e o menu. */
export function definirEmChamada(janela: BrowserWindow, valor: boolean): void {
  emChamada = valor
  atualizar(janela)
}

/**
 * Pisca a barra de tarefas, ou poe o contador sobre o icone.
 *
 * Nunca com a janela ja focada: piscar por cada mensagem do canal que a pessoa
 * esta lendo naquele instante seria a definicao de ruido.
 */
export function pedirAtencao(janela: BrowserWindow, pedido: PedidoDeAtencao): void {
  if (pedido.tipo === 'nenhum') {
    janela.flashFrame(false)
    if (process.platform === 'win32') janela.setOverlayIcon(null, '')
    return
  }

  if (janela.isFocused()) return

  if (pedido.tipo === 'chamada') {
    janela.flashFrame(true)
    return
  }

  // `setOverlayIcon` so existe no Windows. Em outros sistemas o flash resolve.
  if (process.platform !== 'win32') {
    janela.flashFrame(true)
    return
  }

  const n = Math.min(pedido.quantidade, 99)
  if (n <= 0) return janela.setOverlayIcon(null, '')

  janela.setOverlayIcon(icone(), `${String(n)} nao lidas`)
}

/** Limpa o pedido de atencao quando a janela volta ao foco. */
export function registrarLimpezaDeAtencao(janela: BrowserWindow): void {
  janela.on('focus', () => {
    janela.flashFrame(false)
    if (process.platform === 'win32') janela.setOverlayIcon(null, '')
  })
}
