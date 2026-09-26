import { app, screen } from 'electron'
import type { BrowserWindow } from 'electron'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { dentroDeAlgumMonitor } from './geometriaDaJanela'

export { dentroDeAlgumMonitor }

/**
 * O tamanho e a posicao da janela, lembrados entre sessoes.
 *
 * Ate aqui a janela abria sempre em 1280 por 800, no meio da tela, todo dia,
 * independentemente de a pessoa ter deixado o Altcast encostado na lateral do
 * monitor ontem a tarde.
 *
 * Um JSON escrito a mao, e nao `electron-store`: este pacote tem UMA
 * dependencia de runtime hoje, e `electron-store` traz uma duzia de pacotes
 * transitivos para dentro de um instalador assinado — por quarenta linhas de
 * comportamento. O processo principal e pequeno de proposito.
 */

export type EstadoDaJanela = {
  x?: number
  y?: number
  width: number
  height: number
  maximizada: boolean
}

export const PADRAO: EstadoDaJanela = { width: 1280, height: 800, maximizada: false }

/** O mesmo minimo do `BrowserWindow`: abaixo disto controles somem atras de rolagem. */
const MIN_LARGURA = 760
const MIN_ALTURA = 520

/** Gravar so depois que o arrasto parar. */
const ATRASO_MS = 400

function arquivo(): string {
  return join(app.getPath('userData'), 'janela.json')
}

function sanear(bruto: unknown): EstadoDaJanela {
  const o = (bruto ?? {}) as Partial<EstadoDaJanela>
  const num = (v: unknown, padrao: number, minimo: number): number =>
    typeof v === 'number' && Number.isFinite(v) && v >= minimo ? Math.round(v) : padrao

  const estado: EstadoDaJanela = {
    width: num(o.width, PADRAO.width, MIN_LARGURA),
    height: num(o.height, PADRAO.height, MIN_ALTURA),
    maximizada: o.maximizada === true,
  }
  // Posicao so entra se as DUAS coordenadas vierem: meia posicao abriria a
  // janela num canto que ninguem escolheu.
  if (typeof o.x === 'number' && Number.isFinite(o.x)
    && typeof o.y === 'number' && Number.isFinite(o.y)) {
    estado.x = Math.round(o.x)
    estado.y = Math.round(o.y)
  }
  return estado
}

/**
 * O que foi guardado, ja validado contra os monitores que existem AGORA.
 *
 * Nunca lanca: uma janela que nao abre por causa de um JSON corrompido e pior
 * do que uma janela no tamanho errado.
 */
export function lerEstado(): EstadoDaJanela {
  let estado: EstadoDaJanela
  try {
    estado = sanear(JSON.parse(readFileSync(arquivo(), 'utf8')))
  } catch {
    return PADRAO
  }

  try {
    const monitores = screen.getAllDisplays().map(d => d.workArea)
    if (!dentroDeAlgumMonitor(estado, monitores)) {
      // O monitor de ontem nao existe mais. Esquecer a POSICAO e manter o
      // tamanho: a janela volta ao centro, do jeito que a pessoa a
      // dimensionou.
      delete estado.x
      delete estado.y
    }
  } catch {
    // `screen` so responde depois de o app estar pronto. Sem resposta, a
    // posicao e descartada por seguranca — centralizar e sempre recuperavel.
    delete estado.x
    delete estado.y
  }

  return estado
}

let pendente: NodeJS.Timeout | null = null

export function guardarEstado(
  janela: BrowserWindow, opcoes: { agora?: boolean } = {},
): void {
  const escrever = (): void => {
    pendente = null
    try {
      // Minimizada nao tem tamanho que valha a pena guardar.
      if (janela.isDestroyed() || janela.isMinimized()) return

      /**
       * `getNormalBounds`, e NUNCA `getBounds`.
       *
       * Com a janela maximizada, `getBounds` devolve o tamanho da tela — e
       * guardar isso como o tamanho "restaurado" apaga para sempre o tamanho
       * que a pessoa escolheu. Ela desmaximiza e a janela ocupa o monitor
       * inteiro, sem jeito de voltar. E o erro classico de toda implementacao
       * feita a mao disto.
       */
      const b = janela.getNormalBounds()
      const estado: EstadoDaJanela = {
        x: b.x, y: b.y, width: b.width, height: b.height,
        maximizada: janela.isMaximized(),
      }
      writeFileSync(arquivo(), JSON.stringify(estado), 'utf8')
    } catch {
      // Guardar e um agrado, nao um requisito: a sessao segue igual.
    }
  }

  if (opcoes.agora === true) {
    if (pendente !== null) clearTimeout(pendente)
    return escrever()
  }

  // `resize` dispara dezenas de vezes por arrasto, e escrever em disco de
  // forma sincrona a cada quadro, no meio de uma chamada de voz, e exatamente
  // o tipo de coisa que faz o audio estalar.
  if (pendente !== null) clearTimeout(pendente)
  pendente = setTimeout(escrever, ATRASO_MS)
  pendente.unref()
}
