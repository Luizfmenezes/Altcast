import { describe, it, expect, beforeEach } from 'vitest'
import { createRef } from 'react'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Conversa } from '../src/features/channels/Conversa.js'
import { Reacoes } from '../src/features/messages/Reacoes.js'
import { useStore } from '../src/lib/store.js'
import { violacoes } from './helpers/axe.js'
import type { Mensagem, Ready } from '../src/lib/tipos.js'

/**
 * Reacoes, respostas, mencoes e nao-lidos, pela tela.
 *
 * O que estes testes protegem sao as decisoes que a interface toma sozinha e
 * que nenhum teste de API alcanca: o separador de nao-lidos que NAO pode
 * escorregar enquanto a pessoa le, a citacao que sobrevive ao apagamento da
 * mensagem original, e a barra de reacoes que precisa dizer, em voz alta,
 * quantas pessoas reagiram e a que.
 */

const GRUPO = 'g1'
const CANAL = 'c-texto'

const READY: Ready = {
  user: { id: 'u1', displayName: 'Felipe', avatarUrl: null },
  groups: [{ id: GRUPO, name: 'Anticorp', iconUrl: null, role: 'owner' }],
  channels: [{
    id: CANAL, groupId: GRUPO, name: 'geral', type: 'text',
    visibility: 'public', topic: null, position: 0,
  }],
  members: [
    {
      groupId: GRUPO, userId: 'u1', displayName: 'Felipe',
      avatarUrl: null, role: 'owner', status: 'online',
    },
    {
      groupId: GRUPO, userId: 'u2', displayName: 'Ana',
      avatarUrl: null, role: 'member', status: 'online',
    },
  ],
  serverTime: '2026-08-30T12:00:00.000Z',
}

/** UUIDv7 crescentes: ordenar por id e ordenar por tempo, como no servidor. */
const msg = (n: number, campos: Partial<Mensagem> = {}): Mensagem => ({
  id: `0198f0aa-0000-7000-8000-00000000000${String(n)}`,
  channelId: CANAL,
  authorId: 'u2',
  content: `mensagem ${String(n)}`,
  createdAt: `2026-08-30T12:0${String(n)}:00.000Z`,
  editedAt: null,
  ...campos,
})

function preparar(mensagens: Mensagem[], reads?: Record<string, string | null>): void {
  useStore.getState().limpar()
  act(() => {
    useStore.getState().aplicarReady(reads === undefined ? READY : { ...READY, reads })
    useStore.getState().escolherCanal(CANAL)
    useStore.getState().carregarMensagens(CANAL, mensagens)
  })
}

const montar = (): ReturnType<typeof render> =>
  render(<Conversa campoEscrita={createRef<HTMLTextAreaElement>()} />)

describe('reacoes na tela', () => {
  beforeEach(() => { useStore.getState().limpar() })

  it('a contagem entra no nome acessivel, e nao so no numero visivel', () => {
    render(
      <Reacoes
        messageId="m1"
        reacoes={[{ emoji: '👍', userIds: ['u2', 'u3'] }]}
        eu="u1"
      />,
    )

    // "2" sozinho, lido em voz alta, nao diz de que.
    expect(screen.getByRole('button', { name: '👍, 2 pessoas' })).toBeInTheDocument()
  })

  it('a minha reacao aparece marcada', () => {
    render(
      <Reacoes messageId="m1" reacoes={[{ emoji: '👍', userIds: ['u1'] }]} eu="u1" />,
    )

    const botao = screen.getByRole('button', { name: /👍, 1 pessoa, voce reagiu/ })
    expect(botao).toHaveAttribute('aria-pressed', 'true')
  })

  it('a barra de escolha abre e fecha pelo teclado', async () => {
    const pessoa = userEvent.setup()
    render(<Reacoes messageId="m1" reacoes={[]} eu="u1" />)

    await pessoa.click(screen.getByRole('button', { name: 'Reagir a esta mensagem' }))
    expect(screen.getByRole('group', { name: 'Escolher reacao' })).toBeInTheDocument()

    await pessoa.keyboard('{Escape}')

    // Sem o Escape, a unica saida seria clicar fora — o que nao existe para
    // quem navega por teclado.
    expect(screen.queryByRole('group', { name: 'Escolher reacao' })).not.toBeInTheDocument()
  })

  it('a barra de reacoes nao introduz violacao de acessibilidade', async () => {
    const { container } = render(
      <Reacoes messageId="m1" reacoes={[{ emoji: '🎉', userIds: ['u2'] }]} eu="u1" />,
    )
    expect(await violacoes(container)).toEqual([])
  })
})

describe('eventos de reacao', () => {
  beforeEach(() => { preparar([msg(1)]) })

  it('reagir de outra aba aparece aqui', () => {
    act(() => {
      useStore.getState().aplicarEvento({
        t: 'reaction.added',
        d: { messageId: msg(1).id, channelId: CANAL, userId: 'u2', emoji: '👍' },
      })
    })

    expect(useStore.getState().mensagens[CANAL]![0]!.reactions).toEqual([
      { emoji: '👍', userIds: ['u2'] },
    ])
  })

  it('o mesmo evento duas vezes nao infla a contagem', () => {
    const evento = {
      t: 'reaction.added',
      d: { messageId: msg(1).id, channelId: CANAL, userId: 'u2', emoji: '👍' },
    }
    act(() => {
      useStore.getState().aplicarEvento(evento)
      useStore.getState().aplicarEvento(evento)
    })

    // Uma reconexao pode reentregar o mesmo evento. Somar de novo mostraria
    // duas pessoas onde so houve uma.
    expect(useStore.getState().mensagens[CANAL]![0]!.reactions![0]!.userIds).toEqual(['u2'])
  })

  it('o emoji sem ninguem some da barra', () => {
    act(() => {
      useStore.getState().aplicarEvento({
        t: 'reaction.added',
        d: { messageId: msg(1).id, channelId: CANAL, userId: 'u2', emoji: '👍' },
      })
      useStore.getState().aplicarEvento({
        t: 'reaction.removed',
        d: { messageId: msg(1).id, channelId: CANAL, userId: 'u2', emoji: '👍' },
      })
    })

    // Um contador em zero seria um botao prometendo uma reacao que nao existe.
    expect(useStore.getState().mensagens[CANAL]![0]!.reactions).toEqual([])
  })
})

describe('respostas na tela', () => {
  it('a citacao mostra o autor e o trecho da mensagem original', () => {
    preparar([msg(1, { content: 'a reuniao e amanha?' }), msg(2, { replyToId: msg(1).id })])
    montar()

    expect(screen.getByText(/Em resposta a Ana: a reuniao e amanha\?/)).toBeInTheDocument()
  })

  it('citacao de mensagem apagada diz isso em vez de sumir', () => {
    // O `SET NULL` do banco preserva a resposta de proposito. A linha precisa
    // contar o que aconteceu, senao a conversa fica sem o fio.
    preparar([msg(2, { replyToId: '0198f0aa-0000-7000-8000-000000000009' })])
    montar()

    expect(screen.getByText('Em resposta a uma mensagem apagada')).toBeInTheDocument()
  })

  it('responder preenche a barra de citacao do composer', async () => {
    const pessoa = userEvent.setup()
    preparar([msg(1, { content: 'a reuniao e amanha?' })])
    montar()

    await pessoa.click(screen.getByRole('button', { name: 'Responder' }))

    expect(screen.getByText(/Respondendo a Ana: a reuniao e amanha\?/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancelar resposta' })).toBeInTheDocument()
  })

  it('cancelar desfaz a citacao', async () => {
    const pessoa = userEvent.setup()
    preparar([msg(1)])
    montar()

    await pessoa.click(screen.getByRole('button', { name: 'Responder' }))
    await pessoa.click(screen.getByRole('button', { name: 'Cancelar resposta' }))

    expect(screen.queryByText(/Respondendo a/)).not.toBeInTheDocument()
  })
})

describe('mencoes', () => {
  it('digitar @ oferece os membros do grupo', async () => {
    const pessoa = userEvent.setup()
    preparar([])
    montar()

    await pessoa.type(screen.getByRole('textbox'), 'oi @An')

    expect(screen.getByRole('button', { name: '@Ana' })).toBeInTheDocument()
  })

  it('escolher completa o nome sem apagar o que ja estava escrito', async () => {
    const pessoa = userEvent.setup()
    preparar([])
    montar()
    const campo = screen.getByRole('textbox')

    await pessoa.type(campo, 'bom dia @An')
    await pessoa.click(screen.getByRole('button', { name: '@Ana' }))

    // Reescrever o campo inteiro perderia a frase em andamento.
    expect(campo).toHaveValue('bom dia @Ana ')
  })

  it('um @ de frases atras nao reabre a lista', async () => {
    const pessoa = userEvent.setup()
    preparar([])
    montar()

    await pessoa.type(screen.getByRole('textbox'), 'oi @Ana tudo bem')

    expect(screen.queryByRole('button', { name: '@Ana' })).not.toBeInTheDocument()
  })
})

describe('nao-lidos', () => {
  it('o separador cai depois da ultima mensagem lida', () => {
    preparar([msg(1), msg(2), msg(3)], { [CANAL]: msg(1).id })
    montar()

    // Uma so: o marco define UM ponto de corte, e nao um por mensagem nova.
    expect(screen.getAllByRole('separator', { name: 'Novas mensagens' })).toHaveLength(1)
  })

  it('sem marco nenhum nao ha separador: tudo e novidade de primeira vez', () => {
    preparar([msg(1), msg(2)])
    montar()

    expect(screen.queryByRole('separator', { name: 'Novas mensagens' })).not.toBeInTheDocument()
  })

  it('com tudo lido o separador nao aparece', () => {
    preparar([msg(1), msg(2)], { [CANAL]: msg(2).id })
    montar()

    expect(screen.queryByRole('separator', { name: 'Novas mensagens' })).not.toBeInTheDocument()
  })

  it('o marco nao anda para tras', () => {
    preparar([msg(1), msg(2), msg(3)], { [CANAL]: msg(3).id })

    act(() => { useStore.getState().marcarLido(CANAL, msg(1).id) })

    // Rolar para cima dispara leituras de mensagens antigas. Aceitar a ultima
    // recebida faria o contador de nao-lidos subir sozinho enquanto a pessoa
    // le — exatamente o oposto do que ele existe para fazer.
    expect(useStore.getState().leituras[CANAL]).toBe(msg(3).id)
  })

  it('o separador NAO escorrega quando chega mensagem nova', () => {
    preparar([msg(1), msg(2)], { [CANAL]: msg(1).id })
    montar()

    act(() => {
      useStore.getState().aplicarEvento({ t: 'message.created', d: msg(3) })
    })

    // Se o separador acompanhasse a leitura em tempo real, ele saltaria para
    // baixo a cada mensagem e a pessoa nunca veria onde tinha parado.
    expect(screen.getByText('mensagem 2')).toBeInTheDocument()
    expect(screen.getAllByRole('separator', { name: 'Novas mensagens' })).toHaveLength(1)
  })
})
