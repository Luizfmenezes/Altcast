import { create } from 'zustand'
import type { Canal, Grupo, Membro, Mensagem, Ready, Usuario } from './tipos.js'
import type { ServerEvent, SocketStatus } from './socket.js'

/**
 * Estado da aplicacao.
 *
 * A regra que sustenta a seguranca no cliente: a interface exibe o que recebeu
 * e nunca deduz o que nao recebeu. Canal privado do qual o usuario nao
 * participa simplesmente nao chega - e a interface nao inventa cadeado, nem
 * espaco reservado, nem aviso de acesso negado.
 */
type Estado = {
  user: Usuario | null
  groups: Grupo[]
  channels: Canal[]
  members: Membro[]
  /** Historico por canal, do mais antigo para o mais novo. */
  mensagens: Record<string, Mensagem[]>
  grupoAtivo: string | null
  canalAtivo: string | null
  conexao: SocketStatus

  aplicarReady: (ready: Ready) => void
  aplicarEvento: (evento: ServerEvent) => void
  definirConexao: (s: SocketStatus) => void
  escolherGrupo: (groupId: string) => void
  escolherCanal: (channelId: string) => void
  carregarMensagens: (channelId: string, mensagens: Mensagem[]) => void
  registrarEco: (mensagem: Mensagem) => void
  marcarEnvio: (id: string, envio: Mensagem['envio']) => void
  descartarEco: (id: string) => void
  limpar: () => void
}

/** Ordem estavel: posicao e, no empate, o ID - que e UUIDv7, portanto criacao. */
const porPosicao = (a: Canal, b: Canal): number =>
  a.position - b.position || a.id.localeCompare(b.id)

/** Insere mantendo a ordem cronologica e sem duplicar o eco otimista. */
function fundirMensagem(lista: Mensagem[], nova: Mensagem): Mensagem[] {
  const existente = lista.findIndex(m => m.id === nova.id)
  // O eco otimista ja ocupa o lugar com o mesmo UUIDv7 gerado no cliente:
  // substituir e o que faz a confirmacao do servidor nao virar duplicata.
  if (existente >= 0) {
    const copia = [...lista]
    copia[existente] = nova
    return copia
  }
  const posicao = lista.findIndex(m => m.id > nova.id)
  if (posicao < 0) return [...lista, nova]
  return [...lista.slice(0, posicao), nova, ...lista.slice(posicao)]
}

function primeiroCanalDoGrupo(channels: Canal[], groupId: string): string | null {
  return channels.filter(c => c.groupId === groupId).sort(porPosicao)[0]?.id ?? null
}

export const useStore = create<Estado>(set => ({
  user: null,
  groups: [],
  channels: [],
  members: [],
  mensagens: {},
  grupoAtivo: null,
  canalAtivo: null,
  conexao: 'reconectando',

  aplicarReady: ready => set(estado => {
    const grupoAtivo = estado.grupoAtivo !== null
      && ready.groups.some(g => g.id === estado.grupoAtivo)
      ? estado.grupoAtivo
      : ready.groups[0]?.id ?? null

    // O canal ativo pode ter sumido do ready porque a pessoa foi removida dele
    // enquanto estava desconectada. Cair no primeiro visivel e melhor do que
    // manter a tela apontando para algo que ela nao pode mais ler.
    const aindaVisivel = estado.canalAtivo !== null
      && ready.channels.some(c => c.id === estado.canalAtivo)

    return {
      user: ready.user,
      groups: ready.groups,
      channels: [...ready.channels].sort(porPosicao),
      members: ready.members,
      grupoAtivo,
      canalAtivo: aindaVisivel
        ? estado.canalAtivo
        : grupoAtivo === null ? null : primeiroCanalDoGrupo(ready.channels, grupoAtivo),
    }
  }),

  aplicarEvento: evento => {
    const d = evento.d as Record<string, unknown>
    switch (evento.t) {
      case 'message.created':
      case 'message.updated': {
        const mensagem = d as unknown as Mensagem
        return set(estado => ({
          mensagens: {
            ...estado.mensagens,
            [mensagem.channelId]: fundirMensagem(
              estado.mensagens[mensagem.channelId] ?? [], mensagem,
            ),
          },
        }))
      }
      case 'message.deleted': {
        const { id, channelId } = d as { id: string; channelId: string }
        return set(estado => ({
          mensagens: {
            ...estado.mensagens,
            [channelId]: (estado.mensagens[channelId] ?? []).filter(m => m.id !== id),
          },
        }))
      }
      case 'channel.created':
      case 'channel.updated': {
        const canal = d as unknown as Canal
        return set(estado => ({
          channels: [...estado.channels.filter(c => c.id !== canal.id), canal].sort(porPosicao),
        }))
      }
      case 'channel.deleted': {
        const { id } = d as { id: string }
        return set(estado => {
          const restantes = estado.channels.filter(c => c.id !== id)
          const { [id]: _descartado, ...mensagens } = estado.mensagens
          return {
            channels: restantes,
            // As mensagens daquele canal saem da memoria do cliente junto: o
            // acesso acabou, e o cache nao pode sobreviver a ele.
            mensagens,
            canalAtivo: estado.canalAtivo === id
              ? (estado.grupoAtivo === null
                ? null
                : primeiroCanalDoGrupo(restantes, estado.grupoAtivo))
              : estado.canalAtivo,
          }
        })
      }
      case 'member.joined': {
        const membro = d as unknown as Membro
        return set(estado => ({
          members: [...estado.members.filter(
            m => !(m.groupId === membro.groupId && m.userId === membro.userId),
          ), { ...membro, status: membro.status ?? 'offline' }],
        }))
      }
      case 'member.left': {
        const { groupId, userId } = d as { groupId: string; userId: string }
        return set(estado => ({
          members: estado.members.filter(
            m => !(m.groupId === groupId && m.userId === userId),
          ),
        }))
      }
      case 'member.updated': {
        const alvo = d as { groupId: string; userId: string; role: Membro['role'] }
        return set(estado => ({
          members: estado.members.map(m =>
            m.groupId === alvo.groupId && m.userId === alvo.userId
              ? { ...m, role: alvo.role }
              : m),
        }))
      }
      case 'presence.update': {
        const { userId, status } = d as { userId: string; status: Membro['status'] }
        return set(estado => ({
          members: estado.members.map(m => m.userId === userId ? { ...m, status } : m),
        }))
      }
      default:
        // Evento desconhecido - inclusive o prefixo `voice.` da Fatia 2 - e
        // ignorado em silencio, para que um servidor mais novo nunca quebre um
        // cliente mais velho.
        return
    }
  },

  definirConexao: conexao => set({ conexao }),

  escolherGrupo: groupId => set(estado => ({
    grupoAtivo: groupId,
    canalAtivo: primeiroCanalDoGrupo(estado.channels, groupId),
  })),

  escolherCanal: channelId => set({ canalAtivo: channelId }),

  carregarMensagens: (channelId, mensagens) => set(estado => ({
    mensagens: {
      ...estado.mensagens,
      [channelId]: mensagens.reduce(fundirMensagem, estado.mensagens[channelId] ?? []),
    },
  })),

  registrarEco: mensagem => set(estado => ({
    mensagens: {
      ...estado.mensagens,
      [mensagem.channelId]: fundirMensagem(estado.mensagens[mensagem.channelId] ?? [], mensagem),
    },
  })),

  marcarEnvio: (id, envio) => set(estado => ({
    mensagens: Object.fromEntries(Object.entries(estado.mensagens).map(([canal, lista]) => [
      canal,
      lista.map(m => m.id === id ? { ...m, ...(envio === undefined ? {} : { envio }) } : m),
    ])),
  })),

  descartarEco: id => set(estado => ({
    mensagens: Object.fromEntries(Object.entries(estado.mensagens).map(([canal, lista]) => [
      canal, lista.filter(m => m.id !== id),
    ])),
  })),

  limpar: () => set({
    user: null, groups: [], channels: [], members: [], mensagens: {},
    grupoAtivo: null, canalAtivo: null,
  }),
}))

/**
 * Mapa de canal para o ID da ultima mensagem conhecida - exatamente o que o
 * socket precisa para curar buracos por REST na reconexao. Eco ainda nao
 * confirmado nao serve de marco: o servidor nao sabe que ele existe.
 */
export function canaisComHistorico(): Record<string, string | null> {
  const { mensagens } = useStore.getState()
  return Object.fromEntries(Object.entries(mensagens).map(([canal, lista]) => [
    canal, lista.filter(m => m.envio === undefined).at(-1)?.id ?? null,
  ]))
}
