import { create } from 'zustand'
import type { Canal, Grupo, Membro, Mensagem, Ready, Usuario } from './tipos.js'
import type { QuadroCliente, ServerEvent, SocketStatus } from './socket.js'

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
  /**
   * Quem esta em chamada, por canal. Espelha `calls.ts` do servidor e some no
   * refresh de proposito: uma chamada e um fato sobre sockets abertos agora, e
   * o proximo `voice.participant_joined` reconstroi a lista.
   */
  chamadas: Record<string, ParticipanteDeVoz[]>
  /**
   * Ate onde EU li cada canal. Um marco, e nao uma contagem: o numero de
   * nao-lidos e derivado comparando ids, que sao UUIDv7 e ordenam por tempo.
   * Guardar o numero exigiria recalcula-lo a cada mensagem que chegasse.
   */
  leituras: Record<string, string | null>
  marcarLido: (channelId: string, ateMensagem: string) => void

  /**
   * Manda um quadro pelo socket. O padrao devolve `false` porque antes de a
   * conexao existir a resposta honesta e "nao foi enviado" — e nao uma fila que
   * entregaria um estado de microfone ja vencido.
   */
  enviarQuadro: (quadro: QuadroCliente) => boolean

  aplicarReady: (ready: Ready) => void
  aplicarEvento: (evento: ServerEvent) => void
  definirConexao: (s: SocketStatus) => void
  definirEnvio: (enviar: (quadro: QuadroCliente) => boolean) => void
  escolherGrupo: (groupId: string) => void
  escolherCanal: (channelId: string) => void
  carregarMensagens: (channelId: string, mensagens: Mensagem[]) => void
  registrarEco: (mensagem: Mensagem) => void
  marcarEnvio: (id: string, envio: Mensagem['envio']) => void
  descartarEco: (id: string) => void
  limpar: () => void
}

/** O que a sala sabe sobre uma pessoa sem precisar assinar a faixa dela. */
export type ParticipanteDeVoz = {
  userId: string
  microfone: boolean
  camera: boolean
  tela: boolean
}

/**
 * Substitui quem ja estava, ou acrescenta. O `voice.participant_joined` pode
 * chegar duas vezes — reconexao, segunda aba — e a lista nao pode ganhar a
 * mesma pessoa duas vezes por causa disso.
 */
function fundirParticipante(
  lista: ParticipanteDeVoz[], novo: ParticipanteDeVoz,
): ParticipanteDeVoz[] {
  const i = lista.findIndex(p => p.userId === novo.userId)
  if (i < 0) return [...lista, novo]
  const copia = [...lista]
  copia[i] = novo
  return copia
}

/**
 * Aplica uma mudanca a UMA mensagem, deixando o resto do mapa intacto.
 *
 * Existe para que os dois eventos de reacao nao repitam a mesma escalada de
 * `{...estado.mensagens, [canal]: lista.map(...)}` — que e onde e facil trocar
 * um canal por outro sem o compilador reclamar.
 */
function mexerNaReacao(
  mapa: Record<string, Mensagem[]>,
  channelId: string,
  messageId: string,
  mexer: (m: Mensagem) => Mensagem,
): Record<string, Mensagem[]> {
  const lista = mapa[channelId]
  // Reacao a uma mensagem que este cliente nunca carregou. Ignorar e certo: a
  // contagem chega correta quando a pagina for buscada.
  if (lista === undefined) return mapa
  return { ...mapa, [channelId]: lista.map(m => m.id === messageId ? mexer(m) : m) }
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
  chamadas: {},
  leituras: {},
  enviarQuadro: () => false,

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
      leituras: ready.reads ?? {},
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
      case 'voice.participant_joined':
      case 'voice.track_published': {
        // Os dois eventos carregam o mesmo formato e a mesma verdade: o estado
        // completo da pessoa na sala. Trata-los junto e o que faz "entrou" e
        // "ligou a camera" nao precisarem de dois caminhos que podem divergir.
        const { channelId, ...participante } = d as unknown as
          ParticipanteDeVoz & { channelId: string }
        return set(estado => ({
          chamadas: {
            ...estado.chamadas,
            [channelId]: fundirParticipante(estado.chamadas[channelId] ?? [], participante),
          },
        }))
      }
      case 'reaction.added': {
        const { messageId, channelId, userId, emoji } = d as {
          messageId: string; channelId: string; userId: string; emoji: string
        }
        return set(estado => ({
          mensagens: mexerNaReacao(estado.mensagens, channelId, messageId, m => {
            const atuais = m.reactions ?? []
            const existente = atuais.find(r => r.emoji === emoji)
            // O mesmo evento pode chegar duas vezes numa reconexao. Somar de
            // novo inflaria a contagem sem que ninguem tivesse reagido.
            if (existente?.userIds.includes(userId) === true) return m
            return {
              ...m,
              reactions: existente === undefined
                ? [...atuais, { emoji, userIds: [userId] }]
                : atuais.map(r => r.emoji === emoji
                  ? { ...r, userIds: [...r.userIds, userId] }
                  : r),
            }
          }),
        }))
      }
      case 'reaction.removed': {
        const { messageId, channelId, userId, emoji } = d as {
          messageId: string; channelId: string; userId: string; emoji: string
        }
        return set(estado => ({
          mensagens: mexerNaReacao(estado.mensagens, channelId, messageId, m => ({
            ...m,
            // O emoji sem ninguem some da barra: um contador em zero seria um
            // botao que promete uma reacao que nao existe mais.
            reactions: (m.reactions ?? [])
              .map(r => r.emoji === emoji
                ? { ...r, userIds: r.userIds.filter(u => u !== userId) }
                : r)
              .filter(r => r.userIds.length > 0),
          })),
        }))
      }
      case 'voice.participant_left': {
        const { channelId, userId } = d as { channelId: string; userId: string }
        return set(estado => ({
          chamadas: {
            ...estado.chamadas,
            [channelId]: (estado.chamadas[channelId] ?? []).filter(p => p.userId !== userId),
          },
        }))
      }
      default:
        // Evento desconhecido e ignorado em silencio, para que um servidor mais
        // novo nunca quebre um cliente mais velho.
        return
    }
  },

  definirConexao: conexao => set({ conexao }),

  definirEnvio: enviar => set({ enviarQuadro: enviar }),

  escolherGrupo: groupId => set(estado => ({
    grupoAtivo: groupId,
    canalAtivo: primeiroCanalDoGrupo(estado.channels, groupId),
  })),

  escolherCanal: channelId => set({ canalAtivo: channelId }),

  marcarLido: (channelId, ateMensagem) => set(estado => (
    // Nunca ANDA PARA TRAS. Rolar para cima no historico dispara leituras de
    // mensagens antigas, e aceitar a ultima recebida faria o contador de
    // nao-lidos subir sozinho enquanto a pessoa le.
    (estado.leituras[channelId] ?? '') >= ateMensagem
      ? {}
      : { leituras: { ...estado.leituras, [channelId]: ateMensagem } }
  )),

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
    grupoAtivo: null, canalAtivo: null, chamadas: {}, leituras: {},
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
