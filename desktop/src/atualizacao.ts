import { app, ipcMain } from 'electron'
import type { BrowserWindow } from 'electron'
import { autoUpdater } from 'electron-updater'
import { CANAIS } from './ponte'
import type { EstadoDaAtualizacao, LeituraDaAtualizacao } from './ponte'
import { criarAtualizador } from './atualizador'
import type { Atualizador } from './atualizador'

/**
 * Liga a atualizacao automatica ao processo principal.
 *
 * O electron-updater le `resources/app-update.yml` (gerado pelo `publish` do
 * `electron-builder.yml`) e consulta `/baixar/latest.yml` na VPS. Baixa sozinho
 * e instala ao fechar o app (`autoInstallOnAppQuit`), em silencio. O instalador
 * nao e assinado e o `app-update.yml` nao tem `publisherName`, entao nao ha
 * verificacao de assinatura; a integridade vem do `sha512` do `latest.yml`.
 */
export function registrarAtualizacao(
  ehNossa: (url: string) => boolean,
  janela: () => BrowserWindow | null,
): void {
  let atualizador: Atualizador | null = null
  let parado: EstadoDaAtualizacao = { fase: 'indisponivel' }

  const ler = (): LeituraDaAtualizacao => ({
    versao: app.getVersion(),
    estado: atualizador?.estado() ?? parado,
  })

  ipcMain.handle(CANAIS.lerAtualizacao, (evento): LeituraDaAtualizacao | null =>
    (ehNossa(evento.senderFrame?.url ?? '') ? ler() : null))

  ipcMain.handle(CANAIS.procurarAtualizacao, async (evento): Promise<void> => {
    if (!ehNossa(evento.senderFrame?.url ?? '')) return
    await atualizador?.procurar()
  })

  // Fora do instalador nao ha `app-update.yml`, e procurar so produziria erro.
  if (!app.isPackaged) return
  parado = { fase: 'parado' }

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.logger = console

  atualizador = criarAtualizador(autoUpdater as unknown as Parameters<typeof criarAtualizador>[0], estado => {
    const alvo = janela()
    if (alvo !== null && !alvo.isDestroyed()) alvo.webContents.send(CANAIS.atualizacao, estado)
  })
  atualizador.iniciar()

  app.on('will-quit', () => { atualizador?.parar() })
}
