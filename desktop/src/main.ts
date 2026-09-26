import { app, BrowserWindow, session, shell } from 'electron'
import { join } from 'node:path'
import { origemDoAltcast, urlDoAltcast } from './config'
import { registrarCaptura } from './captura'
import { guardarEstado, lerEstado } from './estadoDaJanela'

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

/**
 * Os hosts da tela de entrada do Google.
 *
 * Lista fechada, e nao "qualquer coisa .google.com": o que precisa abrir aqui
 * dentro e a tela de escolher a conta, e mais nada. `youtube.com` e
 * `drive.google.com` sao do mesmo dono e nao tem o que fazer nesta janela.
 */
const HOSTS_DO_GOOGLE = new Set([
  'accounts.google.com',
  'accounts.youtube.com',
])

/**
 * A entrada pelo Google e a UNICA excecao a regra de navegar para fora.
 *
 * Sem ela o fluxo quebra de um jeito silencioso: o clique no botao abriria o
 * Google no navegador do SISTEMA, a pessoa entraria la, e o cookie de sessao
 * nasceria no navegador — nao nesta janela. O app continuaria na tela de
 * login, sem erro nenhum, e ninguem entenderia por que.
 *
 * O risco que a regra original evita continua coberto: um link de terceiro
 * postado no chat nao esta nesta lista, e as permissoes de midia sao
 * concedidas so para `ORIGEM` — a pagina do Google roda sem microfone e sem
 * camera.
 */
function ehEntradaPeloGoogle(url: string): boolean {
  try {
    const u = new URL(url)
    return u.protocol === 'https:' && HOSTS_DO_GOOGLE.has(u.hostname)
  } catch {
    return false
  }
}

function criarJanela(): void {
  // O tamanho e a posicao de ontem, ja conferidos contra os monitores que
  // existem hoje — restaurar numa tela que foi desconectada nao produz uma
  // janela "fora do lugar": produz uma janela INVISIVEL, com o audio tocando e
  // sem jeito de ser trazida de volta.
  const guardado = lerEstado()

  janela = new BrowserWindow({
    ...(guardado.x === undefined ? {} : { x: guardado.x, y: guardado.y }),
    width: guardado.width,
    height: guardado.height,
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

  if (guardado.maximizada) janela.maximize()

  janela.once('ready-to-show', () => { janela?.show() })

  const alvo = janela
  // Um a um, e nao num laco: as sobrecargas de `on` sao por nome de evento, e
  // uma uniao delas nao resolve para nenhuma.
  const anotar = (): void => { guardarEstado(alvo) }
  alvo.on('resize', anotar)
  alvo.on('move', anotar)
  alvo.on('maximize', anotar)
  alvo.on('unmaximize', anotar)
  // `close`, e nao `closed`: em `closed` a janela ja morreu e perguntar o
  // tamanho dela lanca.
  alvo.on('close', () => { guardarEstado(alvo, { agora: true }) })

  /**
   * Navegar para fora do Altcast nao acontece DENTRO do app.
   *
   * Um link para um site qualquer postado no chat, clicado sem isto,
   * substituiria a aplicacao por uma pagina de terceiro rodando com o nosso
   * `preload` anexado. Vai para o navegador do sistema, que e onde uma pagina
   * de terceiro pertence.
   */
  janela.webContents.on('will-navigate', (evento, url) => {
    if (ehNossa(url) || ehEntradaPeloGoogle(url)) return
    evento.preventDefault()
    void shell.openExternal(url)
  })

  // `target="_blank"` e `window.open` seguem a mesma regra, por um caminho
  // diferente: aqui o Chromium nem dispara `will-navigate`.
  janela.webContents.setWindowOpenHandler(({ url }) => {
    // O Google abre a tela de consentimento numa janela nova em alguns
    // caminhos; manda-la para o navegador do sistema perderia o cookie do
    // mesmo jeito que em `will-navigate`.
    if (ehNossa(url) || ehEntradaPeloGoogle(url)) return { action: 'allow' }
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
