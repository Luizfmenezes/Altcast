/**
 * O contrato entre os dois processos.
 *
 * Os nomes de canal vivem numa constante em vez de literais espalhados porque
 * um erro de digitacao num `ipcMain.handle` nao falha: o `invoke` do outro
 * lado simplesmente nunca e atendido, e o sintoma e um botao que nao faz nada.
 *
 * A MESMA forma esta descrita em `web/src/lib/nativo.ts`, do lado do
 * renderer. Sao dois workspaces sem pacote compartilhado entre eles; se um
 * campo mudar aqui, ele muda la. O teste que roda a interface com uma ponte
 * falsa e o que faz a divergencia aparecer.
 */

export const CANAIS = {
  /** Renderer -> principal: as telas e janelas que existem agora. */
  fontes: 'altcast:fontes',
  /** Renderer -> principal: guarda a escolha para a captura que vem a seguir. */
  escolherFonte: 'altcast:escolher-fonte',
  /** Renderer -> principal: registra (ou solta) a tecla global de microfone. */
  registrarFala: 'altcast:registrar-fala',
  /** Principal -> renderer: a tecla global de microfone foi acionada. */
  fala: 'altcast:fala',
  /** Renderer -> principal: peca atencao na barra de tarefas. */
  atencao: 'altcast:atencao',
  /** Renderer -> principal: ha chamada em curso? Muda o icone da bandeja. */
  emChamada: 'altcast:em-chamada',
  /** Principal -> renderer: a bandeja pediu para sair da chamada. */
  sairDaChamada: 'altcast:sair-da-chamada',
} as const

/**
 * O que a barra de tarefas deve mostrar.
 *
 * `chamada` pisca o icone uma vez; `nao-lidos` poe o contador sobreposto;
 * `nenhum` limpa os dois.
 */
export type PedidoDeAtencao =
  | { tipo: 'chamada' }
  | { tipo: 'nao-lidos'; quantidade: number }
  | { tipo: 'nenhum' }

/** Uma tela ou uma janela que pode ser transmitida. */
export type FonteDeTela = {
  id: string
  nome: string
  tipo: 'tela' | 'janela'
  /** PNG em data URL. O renderer so precisa mostrar. */
  miniatura: string
  /** O icone do programa, quando o Windows tem um para dar. */
  icone: string | null
}

/**
 * Como o som do sistema entra na transmissao.
 *
 * `sistema` e o que conserta a queixa que originou este app: no Chrome,
 * compartilhar uma JANELA nunca leva audio — a caixa "compartilhar audio" so
 * aparece para aba e para tela inteira. Aqui o audio vem junto em qualquer
 * caso.
 *
 * O Electron aceita um terceiro valor, `loopbackWithMute`, que transmite e
 * silencia a saida local. Ele NAO e oferecido de proposito: o que ele silencia
 * e a saida do sistema inteiro, e a chamada do Altcast faz parte dela — a
 * pessoa deixaria de ouvir os proprios colegas para nao ouvir o proprio jogo.
 * Um controle cujo efeito colateral e pior do que o problema nao vale a linha
 * que o expoe.
 */
export type SomDaTela = 'sistema' | 'nenhum'

export type EscolhaDeFonte = {
  id: string
  som: SomDaTela
}
