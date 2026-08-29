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

export type Mensagem = {
  id: string
  channelId: string
  authorId: string | null
  content: string
  createdAt: string
  editedAt: string | null
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
