import { create } from 'zustand'
import type {
  Acao, Canal, Cargo, ConviteRecebido, CotaDeGrupos, Grupo, Membro, Mensagem, Papel,
  Ready, Usuario, VinculoDeCargo,
} from './tipos.js'
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
   * Convites dirigidos a mim, ainda sem resposta.
   *
   * Nao vem no `ready` de proposito: o `ready` e a fotografia do que ja e meu
   * — grupos, canais, membros — e um convite e exatamente o contrario disso.
   * A lista e buscada por REST quando o painel monta, e o evento
   * `invitation.received` a mantem viva enquanto a aba esta aberta.
   */
  convites: ConviteRecebido[]
  /**
   * Quantos grupos esta pessoa ja criou e quantos pode criar.
   *
   * Nulo quando o servidor nao informou (versao anterior): nesse caso a tela
   * nao promete teto nenhum, em vez de inventar um.
   */
  cotaDeGrupos: CotaDeGrupos | null
  /**
   * Os cargos de todos os meus grupos, num mapa unico por id.
   *
   * Um mapa, e nao uma lista por grupo: pintar o autor de uma mensagem exige
   * achar o cargo mais alto de uma pessoa, e isso acontece uma vez por linha
   * de conversa. Varrer uma lista a cada linha seria trabalho por quadro.
   */
  cargos: Record<string, Cargo>
  /** Os cargos de cada pessoa, por `groupId:userId`. */
  cargosDoMembro: Record<string, string[]>
  definirConvites: (lista: ConviteRecebido[]) => void
  removerConvite: (id: string) => void

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
  semearSala: (channelId: string, participantes: ParticipanteDeVoz[]) => void
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

/** A chave do mapa de vinculos. Uma string, e nao um mapa aninhado: o cliente
 *  so pergunta "os cargos desta pessoa neste grupo", nunca "todo mundo deste
 *  grupo", e a chave composta responde isso em um acesso. */
export const chaveDoMembro = (groupId: string, userId: string): string =>
  `${groupId}:${userId}`

function porId(cargos: readonly Cargo[]): Record<string, Cargo> {
  return Object.fromEntries(cargos.map(c => [c.id, c]))
}

function agrupar(vinculos: readonly VinculoDeCargo[]): Record<string, string[]> {
  const mapa: Record<string, string[]> = {}
  for (const v of vinculos) {
    const chave = chaveDoMembro(v.groupId, v.userId)
    ;(mapa[chave] ??= []).push(v.roleId)
  }
  return mapa
}

/**
 * O cargo mais alto de alguem que TENHA cor, para pintar o nome.
 *
 * O mais alto com cor, e nao simplesmente o mais alto: um cargo sem cor herda
 * a cor do texto, e deixa-lo vencer apagaria a cor de um cargo mais baixo que
 * a pessoa escolheu justamente para aparecer. E a mesma regra do Discord, e e
 * a que as pessoas esperam ao pintar um cargo.
 *
 * O cargo de todos nunca entra: ele vale para o grupo inteiro, e pintar todo
 * mundo da mesma cor nao distingue ninguem.
 */
export function corDoMembro(
  estado: Pick<Estado, 'cargos' | 'cargosDoMembro'>,
  groupId: string,
  userId: string,
): string | null {
  const ids = estado.cargosDoMembro[chaveDoMembro(groupId, userId)] ?? []
  let melhor: Cargo | null = null
  for (const id of ids) {
    const c = estado.cargos[id]
    if (c === undefined || c.isDefault || c.color === null) continue
    if (melhor === null || c.position > melhor.position) melhor = c
  }
  return melhor?.color ?? null
}

/**
 * O que EU posso neste grupo, como o cliente enxerga.
 *
 * Existe para esconder botao que o servidor recusaria — e para nada alem
 * disso. A autorizacao de verdade acontece em `can()` a cada rota, e continua
 * acontecendo mesmo que alguem burle isto aqui: esconder e cortesia, nunca
 * defesa. O dono atravessa, como em `can.ts`.
 */
export function possoNoGrupo(
  estado: Pick<Estado, 'cargos' | 'cargosDoMembro' | 'groups' | 'user'>,
  groupId: string,
  acao: Acao,
): boolean {
  const grupo = estado.groups.find(g => g.id === groupId)
  if (grupo === undefined) return false
  if (grupo.role === 'owner') return true

  const eu = estado.user?.id
  if (eu === undefined) return false
  const meus = estado.cargosDoMembro[chaveDoMembro(groupId, eu)] ?? []

  for (const c of Object.values(estado.cargos)) {
    if (c.groupId !== groupId) continue
    // O cargo de todos vale sem estar vinculado: e o que ele significa.
    if (!c.isDefault && !meus.includes(c.id)) continue
    if (c.permissions.includes(acao)) return true
  }
  return false
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
  convites: [],
  cotaDeGrupos: null,
  cargos: {},
  cargosDoMembro: {},
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
      /**
       * SUBSTITUI o mapa de chamadas, e nao funde.
       *
       * O `ready` e a fotografia do que existe agora, e o servidor garante que
       * nenhum evento de voz chegou antes dele — o socket so entra no fan-out
       * depois de a fotografia estar pronta. Fundir manteria para sempre quem
       * saiu da sala enquanto esta aba estava desconectada: o mesmo defeito de
       * antes, com o sinal trocado.
       *
       * E a fotografia e MUDA: cinco pessoas ja na sala nao sao cinco
       * chegadas, e nenhum som pode sair daqui. Por isso esta store nao
       * conhece o modulo de sons — quem toca e o limite do socket, em App.tsx.
       *
       * Campo ausente (servidor antigo) deixa o mapa como estava, em vez de
       * apaga-lo.
       */
      ...(ready.calls === undefined ? {} : {
        chamadas: Object.fromEntries(
          ready.calls.map(sala => [sala.channelId, sala.participants]),
        ),
      }),
      // Mesma politica: ausente significa "este servidor nao fala de cota", e
      // nao "a cota zerou".
      ...(ready.groupQuota === undefined ? {} : { cotaDeGrupos: ready.groupQuota }),
      // Ausente significa "este servidor nao fala de cargos", e nao "os cargos
      // sumiram": nesse caso o mapa fica como estava, e a interface segue sem
      // cor nenhuma em vez de apagar a que ja desenhou.
      ...(ready.roles === undefined ? {} : { cargos: porId(ready.roles) }),
      ...(ready.memberRoles === undefined ? {} : { cargosDoMembro: agrupar(ready.memberRoles) }),
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
      /**
       * O grupo entrou para a MINHA lista.
       *
       * Este `case` e a correcao de raiz de tres sintomas que pareciam
       * separados: criar um grupo e nao ve-lo, aceitar um convite e nao
       * entrar, e a tela em branco logo depois dos dois. Os canais sempre
       * tiveram os seus eventos; os grupos nao tinham nenhum, e o `ready`
       * respondia "quais sao os meus grupos" uma unica vez, na conexao. Dai o
       * refresh.
       *
       * `group.created` PUXA a tela para o grupo novo, e `group.joined` nao:
       * quem acabou de criar um grupo quer entrar nele, e quem aceita um
       * convite no meio de uma conversa nao pode ser arrastado para fora dela.
       */
      case 'group.created':
      case 'group.joined': {
        const { group, channels } = d as unknown as { group: Grupo; channels: Canal[] }
        const puxarParaCa = evento.t === 'group.created'
        return set(estado => {
          const grupos = [...estado.groups.filter(g => g.id !== group.id), group]
            .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
          const canais = [
            ...estado.channels.filter(c => c.groupId !== group.id), ...channels,
          ].sort(porPosicao)
          return {
            groups: grupos,
            channels: canais,
            ...(puxarParaCa
              ? {
                grupoAtivo: group.id,
                canalAtivo: primeiroCanalDoGrupo(canais, group.id),
              }
              : {}),
          }
        })
      }

      /**
       * O nome ou a imagem mudaram.
       *
       * Os campos chegam separados de proposito, e a mesclagem distingue "veio
       * nulo" de "nao veio" — remover a imagem manda `iconUrl: null`, que e um
       * valor legitimo. Mesma regra que `user.updated` ja aplica ao avatar.
       *
       * O servidor emitia isto desde sempre na troca de icone, e o cliente
       * vinha descartando no `default`: era por isso que trocar a foto do
       * grupo nao mudava nada na tela de ninguem, nem na de quem trocou.
       */
      case 'group.updated': {
        const alteracao = d as { id: string; name?: string; iconUrl?: string | null }
        return set(estado => ({
          groups: estado.groups.map(g => g.id !== alteracao.id ? g : {
            ...g,
            ...(alteracao.name === undefined ? {} : { name: alteracao.name }),
            ...('iconUrl' in alteracao ? { iconUrl: alteracao.iconUrl ?? null } : {}),
          }),
        }))
      }

      case 'group.deleted': {
        const { id } = d as { id: string }
        return set(estado => {
          const grupos = estado.groups.filter(g => g.id !== id)
          const canaisQueSaem = new Set(
            estado.channels.filter(c => c.groupId === id).map(c => c.id),
          )
          const canais = estado.channels.filter(c => c.groupId !== id)
          // As mensagens dos canais daquele grupo saem da memoria junto: o
          // acesso acabou, e o cache nao pode sobreviver a ele. Mesma regra
          // que `channel.deleted` ja aplica a um canal.
          const mensagens = Object.fromEntries(
            Object.entries(estado.mensagens).filter(([canal]) => !canaisQueSaem.has(canal)),
          )
          const grupoAtivo = estado.grupoAtivo === id
            ? grupos[0]?.id ?? null
            : estado.grupoAtivo
          return {
            groups: grupos,
            channels: canais,
            mensagens,
            members: estado.members.filter(m => m.groupId !== id),
            grupoAtivo,
            canalAtivo: estado.grupoAtivo === id
              ? (grupoAtivo === null ? null : primeiroCanalDoGrupo(canais, grupoAtivo))
              : estado.canalAtivo,
          }
        })
      }

      case 'role.created':
      case 'role.updated': {
        const cargo = d as unknown as Cargo
        return set(estado => ({ cargos: { ...estado.cargos, [cargo.id]: cargo } }))
      }

      case 'role.deleted': {
        const { id } = d as { id: string }
        return set(estado => {
          const { [id]: _foiEmbora, ...cargos } = estado.cargos
          // O vinculo tambem sai: o banco o apagou por CASCADE, e deixa-lo aqui
          // faria a lista de membros procurar um cargo que nao existe mais.
          const cargosDoMembro = Object.fromEntries(
            Object.entries(estado.cargosDoMembro)
              .map(([chave, ids]) => [chave, ids.filter(i => i !== id)]),
          )
          return { cargos, cargosDoMembro }
        })
      }

      case 'member.roles_updated': {
        const { groupId, userId, roleIds } = d as {
          groupId: string; userId: string; roleIds: string[]
        }
        return set(estado => ({
          cargosDoMembro: {
            ...estado.cargosDoMembro,
            [chaveDoMembro(groupId, userId)]: roleIds,
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
        return set(estado => {
          const membros = estado.members.filter(
            m => !(m.groupId === groupId && m.userId === userId),
          )
          // Quem saiu fui EU: o grupo tem de sair da minha barra agora.
          //
          // O servidor ja mandava este evento para quem saiu — a audiencia e
          // capturada antes da remocao justamente para isso —, e o cliente so
          // tirava a linha da lista de membros. O grupo continuava ali,
          // clicavel, ate alguem recarregar. E o mesmo defeito de `group.*`,
          // com o sinal trocado.
          if (userId !== estado.user?.id) return { members: membros }

          const grupos = estado.groups.filter(g => g.id !== groupId)
          const canaisQueSaem = new Set(
            estado.channels.filter(c => c.groupId === groupId).map(c => c.id),
          )
          const canais = estado.channels.filter(c => c.groupId !== groupId)
          const grupoAtivo = estado.grupoAtivo === groupId
            ? grupos[0]?.id ?? null
            : estado.grupoAtivo
          return {
            members: membros.filter(m => m.groupId !== groupId),
            groups: grupos,
            channels: canais,
            mensagens: Object.fromEntries(
              Object.entries(estado.mensagens).filter(([c]) => !canaisQueSaem.has(c)),
            ),
            grupoAtivo,
            canalAtivo: estado.grupoAtivo === groupId
              ? (grupoAtivo === null ? null : primeiroCanalDoGrupo(canais, grupoAtivo))
              : estado.canalAtivo,
          }
        })
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
      case 'invitation.received': {
        // O evento chega achatado porque e o formato que a rota emite; a store
        // guarda a mesma forma que `GET /invitations` devolve, para que o
        // painel nao precise conhecer duas.
        const c = d as unknown as {
          id: string; groupId: string; groupName: string; groupIconUrl: string | null
          role: Papel; expiresAt: string | null
          invitedBy: { displayName: string; avatarUrl: string | null }
        }
        return set(estado => ({
          // Sem duplicar: o mesmo evento pode chegar duas vezes numa segunda
          // aba ou numa reconexao, e dois convites iguais na lista seriam dois
          // botoes de aceitar para a mesma coisa.
          convites: [
            {
              id: c.id,
              group: { id: c.groupId, name: c.groupName, iconUrl: c.groupIconUrl },
              role: c.role,
              invitedBy: c.invitedBy,
              createdAt: new Date().toISOString(),
              expiresAt: c.expiresAt,
            },
            ...estado.convites.filter(v => v.id !== c.id),
          ],
        }))
      }
      case 'invitation.revoked': {
        const { id } = d as { id: string }
        return set(estado => ({ convites: estado.convites.filter(c => c.id !== id) }))
      }
      case 'presence.update': {
        const { userId, status } = d as { userId: string; status: Membro['status'] }
        return set(estado => ({
          members: estado.members.map(m => m.userId === userId ? { ...m, status } : m),
        }))
      }
      /**
       * A pessoa trocou a foto, o apelido ou o nome de usuario.
       *
       * O servidor emite isto desde sempre — na troca de avatar, na remocao do
       * avatar e no PATCH de perfil — e o cliente vinha descartando no
       * `default`. Passava despercebido enquanto a lista de membros so mostrava
       * texto: quem trocava a foto via o proprio cabecalho mudar, porque aquele
       * caminho passa por `aplicarUsuario`, e a lista de TODO MUNDO continuava
       * com a foto velha ate alguem reconectar.
       *
       * Os campos chegam separados de proposito: a remocao de avatar manda
       * `avatarUrl: null`, que e um valor legitimo, entao a mesclagem tem de
       * distinguir "veio nulo" de "nao veio".
       */
      case 'user.updated': {
        const alteracao = d as {
          userId: string
          displayName?: string
          username?: string | null
          avatarUrl?: string | null
        }
        return set(estado => ({
          members: estado.members.map(m => m.userId !== alteracao.userId ? m : {
            ...m,
            ...(alteracao.displayName === undefined ? {} : { displayName: alteracao.displayName }),
            ...('avatarUrl' in alteracao ? { avatarUrl: alteracao.avatarUrl ?? null } : {}),
          }),
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

  definirConvites: convites => set({ convites }),

  removerConvite: id => set(estado => ({
    convites: estado.convites.filter(c => c.id !== id),
  })),

  definirConexao: conexao => set({ conexao }),

  definirEnvio: enviar => set({ enviarQuadro: enviar }),

  /**
   * A sala de UM canal, como o servidor a ve no instante do token de entrada.
   *
   * Substitui a lista daquele canal e nao toca em nenhum outro. O EU otimista
   * sobrevive de proposito: o servidor so me poe na sala quando o `voice.join`
   * chega, entao a fotografia do token nunca me inclui — assinar por cima dela
   * faria a pessoa sumir da propria lista por um segundo, bem no momento em
   * que ela esta procurando confirmacao de que o clique funcionou.
   */
  semearSala: (channelId, participantes) => set(estado => {
    const eu = estado.user?.id
    const meu = eu === undefined
      ? undefined
      : (estado.chamadas[channelId] ?? []).find(p => p.userId === eu)
    const lista = participantes.filter(p => p.userId !== eu)
    return {
      chamadas: {
        ...estado.chamadas,
        [channelId]: meu === undefined ? lista : [...lista, meu],
      },
    }
  }),

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
    grupoAtivo: null, canalAtivo: null, chamadas: {}, leituras: {}, convites: [],
    cotaDeGrupos: null, cargos: {}, cargosDoMembro: {},
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

/**
 * Quantas mensagens de um canal chegaram depois do marco de leitura.
 *
 * Deriva de comparar IDs, que sao UUIDv7 e por isso ordenam por tempo — e a
 * mesma razao pela qual `leituras` guarda um marco e nao um numero.
 *
 * Conta apenas o que esta em memoria, e isso e deliberado. O `ready` do
 * servidor manda o marco de leitura, mas nao manda quantas mensagens vieram
 * depois dele; um canal nunca aberto nesta sessao nao tem historico local, e a
 * resposta honesta ali e zero, e nao um numero inventado. A regra da store vale
 * aqui como em todo o resto: exibir o que se recebeu, nunca deduzir o que nao
 * se recebeu.
 *
 * Mensagem propria nao conta: ninguem tem notificacao do que acabou de
 * escrever. Eco ainda nao confirmado tambem nao, pelo mesmo motivo.
 */
export function naoLidasDoCanal(
  estado: Pick<Estado, 'mensagens' | 'leituras' | 'user'>,
  channelId: string,
): number {
  const historico = estado.mensagens[channelId]
  if (!historico || historico.length === 0) return 0

  const marco = estado.leituras[channelId] ?? ''
  const eu = estado.user?.id ?? null

  let total = 0
  // De tras para frente: o historico esta em ordem, entao o primeiro item que
  // nao passa do marco encerra a contagem sem varrer o resto.
  for (let i = historico.length - 1; i >= 0; i--) {
    const m = historico[i]
    if (!m || m.id <= marco) break
    // Apagada nao precisa de ramo: `message.deleted` a remove da lista.
    if (m.envio !== undefined || m.authorId === eu) continue
    total++
  }
  return total
}
