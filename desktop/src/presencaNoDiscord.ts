import { app, ipcMain } from 'electron'
import { CANAIS } from './ponte'
import { montarAtividade } from './atividade'
import { criarClienteDoDiscord } from './discord'

/**
 * Liga o cartao do Discord ao processo principal.
 *
 * A pagina diz o que esta acontecendo (em chamada, transmitindo, em qual
 * grupo); `montarAtividade` confere e escreve o cartao; o cliente o entrega ao
 * Discord. Pedido que nao passa na conferencia limpa o cartao — mostrar o
 * anterior seria mentir sobre o agora.
 */
export function registrarPresencaNoDiscord(origem: string, ehNossa: (url: string) => boolean): void {
  const cliente = criarClienteDoDiscord()

  ipcMain.handle(CANAIS.atividade, (evento, pedido: unknown): void => {
    if (!ehNossa(evento.senderFrame?.url ?? '')) return
    cliente.definir(pedido === null ? null : montarAtividade(pedido, origem))
  })

  app.on('will-quit', () => { cliente.encerrar() })
}
