/** Formas devolvidas pela API. Espelham o que as rotas serializam, e nada alem. */

export type Papel = 'owner' | 'admin' | 'member'
export type Visibilidade = 'public' | 'private'

export type Usuario = {
  id: string
  displayName: string
  avatarUrl: string | null
  email?: string
}

export type Grupo = {
  id: string
  name: string
  iconUrl: string | null
  role: Papel
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
  serverTime: string
}
