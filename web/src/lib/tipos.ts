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

export type Mensagem = {
  id: string
  channelId: string
  authorId: string | null
  content: string
  createdAt: string
  editedAt: string | null
  attachments?: Anexo[]
  /** So existe no cliente: acompanha o eco otimista ate a confirmacao. */
  envio?: 'enviando' | 'falhou'
}

export type Ready = {
  user: Usuario
  groups: Grupo[]
  channels: Canal[]
  members: Membro[]
  serverTime: string
}
