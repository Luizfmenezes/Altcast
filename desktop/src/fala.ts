import { app, globalShortcut, ipcMain } from 'electron'
import type { BrowserWindow } from 'electron'
import { CANAIS } from './ponte'

/**
 * A tecla de microfone que funciona com a janela em segundo plano.
 *
 * `web/src/features/voice/atalhos.ts` documenta a limitacao que isto levanta:
 * no navegador, a tecla de falar so responde com a aba focada — ou seja,
 * justamente quando ela e menos necessaria, porque quem esta numa reuniao
 * costuma estar olhando outra coisa. Esta e, depois do audio de sistema na
 * partilha de janela, a segunda razao de existir um app instalado.
 *
 * ## A restricao que muda o produto
 *
 * `globalShortcut` dispara SO no pressionar. Nao existe evento de soltar.
 * Logo, fora da janela nao da para fazer "segurar para falar" — nao ha como
 * saber quando a tecla foi solta.
 *
 * Havia duas saidas honestas: alternar (aperta abre, aperta fecha) ou nao
 * oferecer nada fora da janela. Escolhemos a primeira, e ela aparece na tela
 * com outro NOME — "tecla global de microfone (alterna)" —, separada do
 * push-to-talk de janela.
 *
 * O que NAO se faz e degradar "segurar" para "alternar" em silencio: o
 * microfone passaria a se comportar de um jeito diferente conforme o foco da
 * janela, que e o pior comportamento possivel para um microfone. Quem acha que
 * soltou a tecla e fechou o microfone, e nao fechou, fala sozinho achando que
 * esta calado.
 */

let registrado: string | null = null

/** A origem do pedido e nossa? Mesma disciplina do manipulador de permissoes. */
type Verificador = (url: string) => boolean

export function registrarFalaGlobal(janela: BrowserWindow, ehNossa: Verificador): void {
  ipcMain.handle(CANAIS.registrarFala, (evento, acelerador: unknown) => {
    if (!ehNossa(evento.senderFrame?.url ?? '')) return false

    // Soltar a tecla anterior SEMPRE, inclusive quando a nova falhar: deixar
    // duas registradas faria a antiga continuar abrindo o microfone depois de
    // a pessoa ter escolhido outra.
    if (registrado !== null) {
      globalShortcut.unregister(registrado)
      registrado = null
    }

    if (acelerador === null || typeof acelerador !== 'string' || acelerador === '') {
      return true
    }

    let deuCerto: boolean
    try {
      deuCerto = globalShortcut.register(acelerador, () => {
        janela.webContents.send(CANAIS.fala, true)
      })
    } catch {
      // Acelerador malformado. O `false` abaixo faz a tela dizer isso.
      deuCerto = false
    }

    if (deuCerto) registrado = acelerador
    // Devolver o resultado, e nao engolir: sem ele a tela nao teria como
    // distinguir "registrei" de "outro programa ja tem essa tecla", e o
    // recurso pareceria quebrado sem explicacao.
    return deuCerto
  })

  /**
   * OBRIGATORIO.
   *
   * Um atalho global vazado nao morre com a janela: se o app sair sem soltar
   * um `Space` registrado, o sistema inteiro fica sem barra de espaco ate o
   * proximo logon. E o tipo de defeito que ninguem associa ao Altcast.
   */
  app.on('will-quit', () => { globalShortcut.unregisterAll() })
}
