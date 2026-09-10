import { app, BrowserWindow, session, shell } from 'electron'
import { join } from 'node:path'
import { origemDoAltcast, urlDoAltcast } from './config'
import { registrarCaptura } from './captura'

/**
 * O processo principal.
 *
 * O trabalho dele e pequeno de proposito: abrir UMA janela apontada para o
 * Altcast, conceder as capacidades que o navegador nao concede, e nao virar um
 * segundo lugar onde a aplicacao mora. Toda regra de produto continua no
 * `web/`; aqui ficam so as coisas que exigem estar fora da pagina.
 */

const empacotado = app.isPackaged
const URL_INICIAL = urlDoAltcast(empacotado)
const ORIGEM = origemDoAltcast(empacotado)

let janela: BrowserWindow | null = null

/**
 * Uma instancia, e nao duas.
 *
 * Sem isto, abrir o atalho com o app ja rodando sobe um SEGUNDO processo — com
 * uma segunda conexao ao SFU, um segundo microfone publicado e a pessoa
 * aparecendo duas vezes na mesma sala. `requestSingleInstanceLock` devolve
 * falso na segunda, e a segunda morre antes de criar janela.
 */
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (janela === null) return
    if (janela.isMinimized()) janela.restore()
    janela.show()
    janela.focus()
  })

  app.whenReady().then(prepararApp).catch((erro: unknown) => {
    // Falhar no arranque em silencio deixa um icone que nao abre nada. O log
    // e o unico rastro possivel antes de existir janela para mostrar erro.
    console.error('[altcast] falha no arranque', erro)
    app.quit()
  })
}

function prepararApp(): void {
  const sessao = session.defaultSession

  /**
   * As permissoes de midia, concedidas aqui porque no Electron ninguem as
   * concede.
   *
   * No navegador o proprio Chrome pergunta a pessoa. Numa janela do Electron
   * NAO existe essa caixa: sem este handler, `getUserMedia` e negado em
   * silencio e a chamada entra sem microfone, sem erro em lugar nenhum.
   *
   * A lista e fechada e a origem e conferida: a permissao vale para o Altcast,
   * e nao para qualquer pagina que a janela venha a carregar.
   */
  const PERMITIDAS = new Set(['media', 'notifications', 'fullscreen', 'clipboard-sanitized-write'])
  sessao.setPermissionRequestHandler((conteudo, permissao, responder) => {
    const daOrigem = ehNossa(conteudo.getURL())
    responder(daOrigem && PERMITIDAS.has(permissao))
  })
  // O caminho SINCRONO da mesma decisao. O Chromium consulta um ou outro
  // dependendo da API; responder so ao assincrono deixa metade das checagens
  // caindo no padrao, que e negar.
  sessao.setPermissionCheckHandler((_conteudo, permissao, origem) =>
    origem === ORIGEM && PERMITIDAS.has(permissao))

  registrarCaptura(sessao, () => (janela === null ? [] : [janela.getMediaSourceId()]))

  criarJanela()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) criarJanela()
  })
}

/** A URL pertence ao Altcast? */
function ehNossa(url: string): boolean {
  try {
    return new URL(url).origin === ORIGEM
  } catch {
    // URL invalida — `about:blank`, um esquema desconhecido. Nao e nossa.
    return false
  }
}

function criarJanela(): void {
  janela = new BrowserWindow({
    width: 1280,
    height: 800,
    // Uma janela pequena demais nao "fica apertada": ela esconde controles da
    // chamada atras de rolagem, e o botao de sair e um dos que desaparece.
    minWidth: 760,
    minHeight: 520,
    // Sem isto a janela aparece branca e depois pisca para o tema do produto.
    // O valor acompanha o `--color-bg` escuro dos tokens do `web/`.
    backgroundColor: '#0b0e14',
    title: 'Altcast',
    // Mostrar so quando houver o que mostrar. Uma janela vazia por dois
    // segundos parece travamento no arranque.
    show: false,
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      /**
       * Os tres que nao se negociam, porque esta janela carrega HTML de um
       * servidor. Juntos, eles fazem com que o codigo da pagina rode num
       * contexto sem Node, sem `require` e sem acesso ao sistema — sobrando
       * como unica superficie a ponte estreita do `preload`.
       */
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  })

  janela.once('ready-to-show', () => { janela?.show() })

  /**
   * Navegar para fora do Altcast nao acontece DENTRO do app.
   *
   * Um link para um site qualquer postado no chat, clicado sem isto,
   * substituiria a aplicacao por uma pagina de terceiro rodando com o nosso
   * `preload` anexado. Vai para o navegador do sistema, que e onde uma pagina
   * de terceiro pertence.
   */
  janela.webContents.on('will-navigate', (evento, url) => {
    if (ehNossa(url)) return
    evento.preventDefault()
    void shell.openExternal(url)
  })

  // `target="_blank"` e `window.open` seguem a mesma regra, por um caminho
  // diferente: aqui o Chromium nem dispara `will-navigate`.
  janela.webContents.setWindowOpenHandler(({ url }) => {
    if (ehNossa(url)) return { action: 'allow' }
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  // Um `webview` ou um iframe nunca deveria receber `preload` nenhum. O
  // Electron ainda permite anexar por atributo; isto recusa.
  janela.webContents.on('will-attach-webview', (evento) => { evento.preventDefault() })

  janela.on('closed', () => { janela = null })

  void janela.loadURL(URL_INICIAL)

  /**
   * A pagina nao carregou.
   *
   * Sem este ramo, um servidor fora do ar produz uma janela BRANCA sem uma
   * palavra — indistinguivel de um app quebrado. A mensagem diz qual URL
   * falhou, que e a informacao de que quem instalou precisa para saber se o
   * problema e o dominio, a internet dele ou o servidor.
   */
  janela.webContents.on('did-fail-load', (_e, codigo, descricao, urlQueFalhou, principal) => {
    if (!principal) return
    const pagina = `
      <meta charset="utf-8">
      <title>Altcast</title>
      <body style="background:#0b0e14;color:#e6e8ee;font:14px/1.6 system-ui;
                   display:grid;place-items:center;height:100vh;margin:0">
        <div style="max-width:34rem;padding:2rem">
          <h1 style="font-size:1rem;margin:0 0 .75rem">Nao foi possivel abrir o Altcast</h1>
          <p style="color:#9aa4b8;margin:0 0 .5rem">${escaparHtml(urlQueFalhou)}</p>
          <p style="color:#9aa4b8;margin:0">${escaparHtml(descricao)} (${String(codigo)})</p>
        </div>
      </body>`
    void janela?.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(pagina)}`)
  })
}

/**
 * A URL e a mensagem de erro entram numa pagina montada por concatenacao, e
 * portanto passam por aqui primeiro. Nenhuma das duas e confiavel: a URL pode
 * vir de um redirecionamento, e a descricao vem do Chromium.
 */
function escaparHtml(texto: string): string {
  return texto
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

/**
 * Fechar a ultima janela encerra o app — POR ENQUANTO.
 *
 * Na fase da bandeja isto muda: fechar passa a esconder, para que a chamada
 * continue de pe com a janela fora do caminho. Enquanto a bandeja nao existe,
 * esconder sem icone nenhum deixaria um processo invisivel que a pessoa nao
 * tem como trazer de volta nem como encerrar.
 */
app.on('window-all-closed', () => { app.quit() })
