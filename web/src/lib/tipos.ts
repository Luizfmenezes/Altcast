/** Formas devolvidas pela API. Espelham o que as rotas serializam, e nada alem. */

export type Papel = 'owner' | 'admin' | 'member'
export type Visibilidade = 'public' | 'private'

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

export type Membro = {
  groupId: string
  userId: string
  displayName: string
  avatarUrl: string | null
  role: Papel
  status: 'online' | 'offline'
}

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
