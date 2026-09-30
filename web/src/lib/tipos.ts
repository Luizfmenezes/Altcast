/** Formas devolvidas pela API. Espelham o que as rotas serializam, e nada alem. */

export type Papel = 'owner' | 'admin' | 'member'
export type Visibilidade = 'public' | 'private'

/**
 * Um literal de permissao, como o servidor os nomeia.
 *
 * Deliberadamente `string`, e nao uma uniao copiada de `acoes.ts`: manter aqui
 * uma segunda lista das acoes criaria duas listas para envelhecer separadas, e
 * a do cliente envelheceria mais rapido. O catalogo com rotulo e descricao vem
 * de `GET /api/permissions/catalog`, e e ele que a tela desenha — o cliente
 * nunca precisa CONHECER uma acao, so exibir e reenviar a que recebeu.
 */
export type Acao = string

/** Um cargo do grupo. */
export type Cargo = {
  id: string
  groupId: string
  name: string
  /** '#RRGGBB', ou nulo para herdar a cor do texto. */
  color: string | null
  /** Maior manda mais. */
  position: number
  permissions: Acao[]
  /** O cargo de todos: nao se renomeia, nao se apaga, nao se atribui. */
  isDefault: boolean
}

/** Quem tem qual cargo. Achatado de proposito: a lista de membros cruza os
 *  dois por `userId`, e aninhar obrigaria a store a remontar o membro inteiro
 *  a cada `member.roles_updated`. */
export type VinculoDeCargo = { groupId: string; userId: string; roleId: string }

/** Uma permissao como a tela de cargos a apresenta. Vem do servidor: quem
 *  acrescenta uma acao mexe num arquivo so, e nunca existe o estado em que ela
 *  vale e nenhuma tela sabe explicar o que faz. */
export type DescricaoDeAcao = {
  acao: Acao
  secao: 'Grupo' | 'Canais' | 'Mensagens' | 'Voz'
  rotulo: string
  descricao: string
  /** Concede poder sobre outras pessoas: a tela avisa antes de marcar. */
  sensivel?: boolean
}

export type Usuario = {
  id: string
  displayName: string
  /**
   * O handle unico, quando a pessoa escolheu um.
   *
   * `null` e estado legitimo e permanente: conta antiga nunca escolheu, e
   * conta nascida pelo Google nunca teve a chance. Ausente e servidor anterior
   * a esta versao.
   */
  username?: string | null
  avatarUrl: string | null
  email?: string
  /**
   * Nulo enquanto ninguem provou receber o endereco; ausente quando a resposta
   * veio de um servidor anterior ao cadastro aberto. Os dois casos sao
   * diferentes de proposito: `null` autoriza pedir a confirmacao, `undefined`
   * nao autoriza nem a pergunta.
   */
  emailVerifiedAt?: string | null
  status?: StatusEscolhido
  statusText?: string | null
  statusEmoji?: string | null
  statusExpiresAt?: string | null
  /** O perfil personalizavel. Ausente em servidor anterior a ele. */
  bio?: string | null
  pronouns?: string | null
  /** `#rrggbb`. */
  bannerColor?: string | null
  bannerUrl?: string | null
}

/** O perfil de alguem, como o cartao o mostra (`GET /users/:id/profile`). */
export type PerfilPublico = {
  userId: string
  displayName: string
  username: string | null
  avatarUrl: string | null
  bio: string | null
  pronouns: string | null
  bannerColor: string | null
  bannerUrl: string | null
  createdAt: string
}

export type Grupo = {
  id: string
  name: string
  iconUrl: string | null
  role: Papel
}

/**
 * Um convite dirigido a MIM.
 *
 * Diferente do convite por codigo, que e um link sem destinatario: este chega
 * a interface de quem foi convidado e fica esperando resposta. Por isso
 * carrega o grupo inteiro e quem convidou — aceitar so faz sentido com as duas
 * informacoes na tela.
 */
export type ConviteRecebido = {
  id: string
  group: { id: string; name: string; iconUrl: string | null }
  role: Papel
  invitedBy: { displayName: string; avatarUrl: string | null }
  createdAt: string
  expiresAt: string | null
}

export type Canal = {
  id: string
  groupId: string
  name: string
  type: 'text' | 'voice'
  visibility: Visibilidade
  topic: string | null
  position: number
}

/**
 * O status de presenca como a interface o desenha.
 *
 * `idle`, `dnd` e `offline` chegam do servidor para os OUTROS; `invisible` so
 * aparece para a propria pessoa — para os outros ela e `offline`, e o servidor
 * nunca diz o contrario.
 */
export type StatusDePresenca = 'online' | 'idle' | 'dnd' | 'offline' | 'invisible'

export type Membro = {
  groupId: string
  userId: string
  displayName: string
  avatarUrl: string | null
  role: Papel
  status: StatusDePresenca
  /** A frase do status ("Em reuniao"). Nula quando nao ha, ou quando invisivel. */
  statusText?: string | null
  statusEmoji?: string | null
}

/** O status que a pessoa ESCOLHEU (nao o que os outros veem). */
export type StatusEscolhido = 'online' | 'idle' | 'dnd' | 'invisible'

/** Quanto um grupo ou canal pode interromper. `smart` e o nivel Inteligente (Jev). */
export type NivelDeNotificacao = 'all' | 'mentions' | 'none' | 'smart'

export type PreferenciaDeNotificacao = {
  scopeType: 'group' | 'channel'
  scopeId: string
  /** Nulo e "herda do nivel de cima". */
  level: NivelDeNotificacao | null
  mutedUntil: string | null
}

/** Nao lidas de um canal, contadas pelo servidor. Teto de 100. */
export type NaoLidas = { n: number; mentions: number }

/**
 * Um arquivo preso a uma mensagem.
 *
 * `contentType` e `reproduzivel` vem DECIDIDOS do servidor, que foi quem leu
 * os bytes. O cliente nao reavalia nem adivinha pelo nome: reimplementar a
 * regra aqui seria implementa-la diferente, e a divergencia apareceria como um
 * executavel renderizado onde deveria haver um botao de baixar.
 */
export type Anexo = {
  id: string
  channelId: string
  messageId: string | null
  filename: string
  contentType: string
  byteSize: number
  width: number | null
  height: number | null
  temMiniatura: boolean
  reproduzivel: boolean
  createdAt: string
}

/**
 * Uma reacao agrupada por emoji.
 *
 * Traz os `userIds`, e nao so a contagem, porque a interface precisa saber se
 * EU reagi para destacar a minha — e a contagem sozinha nao responde isso.
 */
export type Reacao = { emoji: string; userIds: string[] }

export type Mensagem = {
  id: string
  channelId: string
  authorId: string | null
  content: string
  createdAt: string
  editedAt: string | null
  attachments?: Anexo[]
  /** A mensagem citada. Nula tambem quando a citada foi apagada. */
  replyToId?: string | null
  mentionsEveryone?: boolean
  reactions?: Reacao[]
  mentions?: string[]
  /** So existe no cliente: acompanha o eco otimista ate a confirmacao. */
  envio?: 'enviando' | 'falhou'
}

export type Ready = {
  user: Usuario
  groups: Grupo[]
  channels: Canal[]
  members: Membro[]
  /**
   * Ate onde esta pessoa leu cada canal, por `channelId`.
   *
   * Um MARCO, e nao uma contagem: o numero de nao-lidos e derivado aqui no
   * cliente comparando ids, que sao UUIDv7 e portanto ordenam por tempo.
   * Opcional porque um servidor anterior a esta versao nao manda o campo, e o
   * cliente novo nao pode quebrar por causa disso.
   */
  reads?: Record<string, string | null>
  /**
   * Quem esta em chamada AGORA, por canal de voz.
   *
   * O servidor sempre mandou este campo e o cliente sempre o ignorou — era
   * essa a causa de quem ja estava numa chamada ficar invisivel para quem
   * chegava depois: a lista so se formava quando alguem emitia um evento novo.
   *
   * Sala vazia nao vem. Como o cliente SUBSTITUI o mapa inteiro ao aplicar o
   * `ready`, um canal ausente daqui vira lista vazia naturalmente.
   *
   * Opcional pelo mesmo motivo de `reads`: um servidor anterior a esta versao
   * nao manda o campo, e nesse caso o mapa fica como estava.
   */
  calls?: SalaEmChamada[]
  /**
   * Quantos grupos esta pessoa ja criou, e qual o teto dela.
   *
   * Vem na fotografia inicial para o botao de criar grupo nascer ja no estado
   * certo, em vez de aparecer habilitado e se desabilitar sozinho um instante
   * depois. Opcional: servidor antigo nao manda, e sem teto conhecido a tela
   * simplesmente nao promete nenhum.
   */
  groupQuota?: CotaDeGrupos
  /**
   * Os cargos dos meus grupos, e quem tem cada um.
   *
   * Vem na fotografia inicial, e nao por REST quando a tela de cargos abre,
   * porque nome colorido aparece na lista de membros e no autor de cada
   * mensagem — isto e, na interface inteira, o tempo todo. Buscar depois faria
   * a primeira tela desenhar todo mundo em cinza e repintar um instante
   * depois.
   *
   * Opcionais pelo mesmo motivo de `reads` e `calls`: servidor anterior a esta
   * versao nao manda os campos, e o cliente novo nao pode quebrar por isso.
   */
  roles?: Cargo[]
  memberRoles?: VinculoDeCargo[]
  /**
   * Nao lidas por canal, contadas no servidor a partir do marco (D3-C). Canal
   * ausente e zero. Opcional: servidor anterior conta no cliente, como antes.
   */
  unread?: Record<string, NaoLidas>
  /** O que esta pessoa quer ouvir de cada grupo e canal. */
  notificationPrefs?: PreferenciaDeNotificacao[]
  serverTime: string
}

/** `max: null` significa sem teto — o administrador da plataforma. */
export type CotaDeGrupos = { used: number; max: number | null }

/** Uma sala de voz povoada, como o servidor a ve no instante do `ready`. */
export type SalaEmChamada = {
  channelId: string
  participants: {
    userId: string
    microfone: boolean
    camera: boolean
    tela: boolean
  }[]
}
