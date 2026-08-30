import { describe, it, expect, beforeEach } from 'vitest'
import { createRef } from 'react'
import { act, render, screen } from '@testing-library/react'
import { Conversa } from '../src/features/channels/Conversa.js'
import { useStore } from '../src/lib/store.js'
import type { Mensagem, Ready } from '../src/lib/tipos.js'

/**
 * A conversa DURANTE a transmissao.
 *
 * O que estes testes protegem e uma decisao revertida, e por isso vale
 * registrar: ate a Fatia 2, canal de voz nao tinha historico nem escrita, e o
 * argumento era bom — um composer desabilitado embaixo da chamada ofereceria
 * uma acao que o canal nao tem. So que a premissa era uma decisao nossa, nao
 * uma lei. Quando a chamada virou transmissao, conversar durante ela passou a
 * ser metade do produto.
 */

const GRUPO = 'g1'
const CANAL_DE_VOZ = 'c-voz'

const READY: Ready = {
  user: { id: 'u1', displayName: 'Felipe', avatarUrl: null },
  groups: [{ id: GRUPO, name: 'Anticorp', iconUrl: null, role: 'owner' }],
  channels: [{
    id: CANAL_DE_VOZ, groupId: GRUPO, name: 'sala-de-voz', type: 'voice',
    visibility: 'public', topic: null, position: 0,
  }],
  members: [{
    groupId: GRUPO, userId: 'u1', displayName: 'Felipe',
    avatarUrl: null, role: 'owner', status: 'online',
  }],
  serverTime: '2026-08-30T12:00:00.000Z',
}

const MENSAGEM: Mensagem = {
  id: '0198f0aa-0000-7000-8000-000000000001',
  channelId: CANAL_DE_VOZ,
  authorId: 'u1',
  content: 'da para ver minha tela?',
  createdAt: '2026-08-30T12:00:05.000Z',
  editedAt: null,
}

/**
 * Larguras diferentes produzem layouts diferentes, e as duas precisam de
 * prova. `matchMedia` nao existe no jsdom, entao a consulta e respondida aqui:
 * `true` monta o chat AO LADO do palco, `false` monta as abas.
 */
function larguraQueResponde(ladoALado: boolean): void {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: (consulta: string) => ({
      matches: ladoALado,
      media: consulta,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }),
  })
}

const montar = (): ReturnType<typeof render> =>
  render(<Conversa campoEscrita={createRef<HTMLTextAreaElement>()} />)

describe('conversa num canal de voz', () => {
  beforeEach(() => {
    useStore.getState().limpar()
    act(() => {
      useStore.getState().aplicarReady(READY)
      useStore.getState().escolherCanal(CANAL_DE_VOZ)
      useStore.getState().carregarMensagens(CANAL_DE_VOZ, [MENSAGEM])
    })
  })

  it('mostra a chamada e a conversa juntas quando a largura permite', () => {
    larguraQueResponde(true)
    montar()

    // Nao e um chat novo nem efemero: e o mesmo `messages`, com o mesmo
    // `channelId`, que ja estava na store antes de a chamada existir.
    expect(screen.getByLabelText(/Chamada de sala-de-voz/)).toBeInTheDocument()
    expect(screen.getByText('da para ver minha tela?')).toBeInTheDocument()
    expect(screen.getByRole('textbox')).toBeInTheDocument()
  })

  it('o composer nao aparece desabilitado: escrever num canal de voz e permitido', () => {
    larguraQueResponde(true)
    montar()

    // Nenhuma rota da API recusa escrita em canal de voz — a unica checagem de
    // tipo esta na rota do token de chamada. Desabilitar aqui seria a
    // interface inventando uma restricao que o servidor nao tem.
    expect(screen.getByRole('textbox')).not.toBeDisabled()
  })

  it('em tela estreita vira aba, e a chamada e a que abre', () => {
    larguraQueResponde(false)
    montar()

    // Dividir 360px entre video e conversa nao entrega nenhum dos dois. E a
    // chamada abre primeiro porque quem entrou num canal de voz veio pela
    // transmissao.
    expect(screen.getByRole('tab', { name: /chamada/i })).toHaveAttribute(
      'aria-selected', 'true',
    )
    expect(screen.getByLabelText(/Chamada de sala-de-voz/)).toBeInTheDocument()
    expect(screen.queryByText('da para ver minha tela?')).not.toBeInTheDocument()
  })

  it('a aba de conversa troca o palco pelo historico', async () => {
    larguraQueResponde(false)
    const { getByRole } = montar()

    await act(async () => {
      getByRole('tab', { name: /conversa/i }).click()
    })

    expect(screen.getByText('da para ver minha tela?')).toBeInTheDocument()
    expect(screen.queryByLabelText(/Chamada de sala-de-voz/)).not.toBeInTheDocument()
  })
})
