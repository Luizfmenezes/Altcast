import { useState } from 'react'
import type { ReactNode } from 'react'
import * as AlertDialog from '@radix-ui/react-alert-dialog'
import { Botao } from './Botao.js'

/**
 * Confirmacao para acao destrutiva.
 *
 * O primitivo do Radix e usado porque ele ja resolve o que quase toda
 * implementacao manual erra: prender o foco enquanto aberto, devolve-lo ao
 * gatilho ao fechar, fechar no Escape e marcar o dialogo como `alertdialog`
 * para o leitor de tela. Reimplementar isso a mao e precisamente como os
 * requisitos de acessibilidade morrem na pratica.
 *
 * ## Por que o `z-[60]`/`z-[70]`
 *
 * Esta confirmacao quase sempre nasce DENTRO de outro dialogo — encerrar uma
 * sessao em Configuracoes, apagar um canal, revogar um convite. Esses dialogos
 * pintam o proprio veu em `z-40` e o conteudo em `z-50`. Sem camada declarada,
 * a confirmacao cai em `z-index: auto` e vai para TRAS do veu de quem a abriu:
 * ela aparece na tela, o leitor de tela a anuncia, e o clique no botao que
 * consuma e engolido pelo veu. O defeito nao aparece em jsdom — ali nao existe
 * pintura nem teste de acerto —, so em navegador de verdade; foi
 * `e2e/fluxos.spec.ts` quem o pegou. As camadas ficam ACIMA das de qualquer
 * dialogo hospedeiro de proposito: uma confirmacao que nao se pode confirmar
 * e pior do que nenhuma.
 */
export function ConfirmarAcao({
  gatilho, titulo, descricao, confirmar, aoConfirmar,
  aberto: abertoControlado, aoMudarAberto, tom = 'perigo',
}: {
  /**
   * Opcional desde que a confirmacao passou a existir sem botao proprio.
   *
   * Trocar de sala de voz e pedido por um clique na LISTA DE CANAIS, e nao por
   * um botao ao lado da pergunta. Exigir um gatilho ali obrigaria a inventar um
   * segundo botao para a mesma acao — que e exatamente o excesso que a mudanca
   * veio remover.
   */
  gatilho?: ReactNode
  titulo: string
  descricao: string
  /** Rotulo do botao que consuma: diz o que vai acontecer, nunca apenas "OK". */
  confirmar: string
  aoConfirmar: () => void | Promise<void>
  /** Quando presente, quem manda no aberto/fechado e quem chamou. */
  aberto?: boolean
  aoMudarAberto?: (aberto: boolean) => void
  /**
   * Vermelho e a cor de "isto destroi algo".
   *
   * Nem toda confirmacao e destrutiva: trocar de sala de voz interrompe uma
   * chamada, o que merece a pergunta, mas nao apaga nada. Pintar as duas
   * iguais gasta o sinal — se tudo e alarme, nada e.
   */
  tom?: 'perigo' | 'padrao'
}): ReactNode {
  const [abertoLocal, setAbertoLocal] = useState(false)
  const aberto = abertoControlado ?? abertoLocal
  const setAberto = (v: boolean): void => {
    if (abertoControlado === undefined) setAbertoLocal(v)
    aoMudarAberto?.(v)
  }

  return (
    <AlertDialog.Root open={aberto} onOpenChange={setAberto}>
      {gatilho !== undefined && <AlertDialog.Trigger asChild>{gatilho}</AlertDialog.Trigger>}
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 z-[60] bg-black/50" />
        <AlertDialog.Content
          className="fixed left-1/2 top-1/2 z-[70] w-[min(92vw,28rem)] -translate-x-1/2
                     -translate-y-1/2 rounded border border-border bg-bg-raised p-4
                     text-fg shadow-dialog"
        >
          <AlertDialog.Title className="text-sm font-semibold">{titulo}</AlertDialog.Title>
          <AlertDialog.Description className="mt-2 text-sm text-fg-muted">
            {descricao}
          </AlertDialog.Description>

          <div className="mt-4 flex justify-end gap-2">
            <AlertDialog.Cancel asChild>
              <Botao variante="discreto">Cancelar</Botao>
            </AlertDialog.Cancel>
            <AlertDialog.Action asChild>
              <Botao variante={tom === 'perigo' ? 'perigo' : 'primario'} onClick={() => void aoConfirmar()}>
                {confirmar}
              </Botao>
            </AlertDialog.Action>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  )
}
