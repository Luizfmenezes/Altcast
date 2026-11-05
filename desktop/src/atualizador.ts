import type { EstadoDaAtualizacao } from './ponte'

/**
 * A atualizacao automatica, sem Electron dentro — e por isso testavel.
 *
 * A decisao de produto e "tudo sozinho, sem perguntar": o app procura ao abrir
 * e de tempos em tempos, baixa em segundo plano e instala quando a pessoa
 * fecha o Altcast. Nada interrompe uma chamada. O estado existe para a tela de
 * Configuracoes poder MOSTRAR o que aconteceu, e nunca para perguntar.
 */

/** A parte do `autoUpdater` do electron-updater que este modulo usa. */
export type Atualizavel = {
  on: (evento: string, ouvinte: (...args: never[]) => void) => unknown
  checkForUpdates: () => Promise<unknown>
}

export type OpcoesDoAtualizador = {
  /** Espera antes da primeira procura: o arranque nao divide banda com o download. */
  esperaInicialMs?: number
  intervaloMs?: number
}

export type Atualizador = {
  estado: () => EstadoDaAtualizacao
  procurar: () => Promise<void>
  iniciar: () => void
  parar: () => void
}

export function criarAtualizador(
  updater: Atualizavel,
  aoMudar: (estado: EstadoDaAtualizacao) => void,
  opcoes: OpcoesDoAtualizador = {},
): Atualizador {
  const esperaInicialMs = opcoes.esperaInicialMs ?? 10_000
  const intervaloMs = opcoes.intervaloMs ?? 4 * 60 * 60_000

  let atual: EstadoDaAtualizacao = { fase: 'parado' }
  let primeira: NodeJS.Timeout | null = null
  let periodica: NodeJS.Timeout | null = null

  function mudar(novo: EstadoDaAtualizacao): void {
    atual = novo
    aoMudar(novo)
  }

  const ouvir = (evento: string, fn: (...args: never[]) => void): void => { updater.on(evento, fn) }

  ouvir('checking-for-update', () => {
    // Procurar de novo com uma versao ja baixada nao apaga o "pronta" da tela.
    if (atual.fase !== 'pronta') mudar({ fase: 'procurando' })
  })
  ouvir('update-not-available', () => {
    if (atual.fase !== 'pronta') mudar({ fase: 'em-dia' })
  })
  ouvir('update-available', ((info: { version?: unknown }) => {
    mudar({ fase: 'baixando', versao: String(info.version ?? ''), progresso: 0 })
  }) as (...args: never[]) => void)
  ouvir('download-progress', ((p: { percent?: unknown }) => {
    if (atual.fase !== 'baixando') return
    const progresso = Math.max(0, Math.min(100, Math.round(Number(p.percent) || 0)))
    // Um evento por ponto percentual, e nao um por pacote: a ponte nao precisa
    // de cem mensagens por segundo para mover uma barra.
    if (progresso !== atual.progresso) mudar({ ...atual, progresso })
  }) as (...args: never[]) => void)
  ouvir('update-downloaded', ((info: { version?: unknown }) => {
    mudar({ fase: 'pronta', versao: String(info.version ?? '') })
  }) as (...args: never[]) => void)
  ouvir('error', ((erro: unknown) => {
    console.warn('[altcast] atualizacao falhou', erro)
    // A versao ja baixada continua valendo: um erro numa procura posterior nao
    // desfaz o que vai ser instalado ao fechar.
    if (atual.fase !== 'pronta') mudar({ fase: 'erro' })
  }) as (...args: never[]) => void)

  async function procurar(): Promise<void> {
    if (atual.fase === 'procurando' || atual.fase === 'baixando') return
    try {
      await updater.checkForUpdates()
    } catch {
      // O evento `error` ja chegou (ou vai chegar) e e ele quem muda o estado.
    }
  }

  return {
    estado: () => atual,
    procurar,
    iniciar() {
      if (primeira !== null || periodica !== null) return
      primeira = setTimeout(() => {
        primeira = null
        void procurar()
      }, esperaInicialMs)
      periodica = setInterval(() => { void procurar() }, intervaloMs)
      // Nenhum dos dois pode segurar o processo vivo depois de fechar a janela.
      primeira.unref()
      periodica.unref()
    },
    parar() {
      if (primeira !== null) clearTimeout(primeira)
      if (periodica !== null) clearInterval(periodica)
      primeira = null
      periodica = null
    },
  }
}
