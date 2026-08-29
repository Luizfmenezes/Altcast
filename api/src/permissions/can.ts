export type Role = 'owner' | 'admin' | 'member'
export type Visibility = 'public' | 'private'

export type Action =
  | 'group.view' | 'group.update' | 'group.delete'
  | 'group.invite' | 'group.kick' | 'group.change_role'
  | 'channel.create' | 'channel.update' | 'channel.delete'
  | 'channel.read' | 'channel.write' | 'channel.manage_members'
  | 'message.create' | 'message.edit_own' | 'message.delete_own' | 'message.delete_any'
  | 'channel.join_call' | 'channel.publish' | 'channel.moderate_call'

export type Actor = { userId: string; role: Role | null; inChannel: boolean }
export type Resource = { kind: 'group' | 'channel' | 'message'; visibility?: Visibility; authorId?: string }

const GERE_O_GRUPO: Action[] = ['group.update', 'group.invite', 'group.kick']
const SO_DO_OWNER: Action[] = ['group.delete', 'group.change_role']
const ADMINISTRA_CANAL: Action[] = [
  'channel.create', 'channel.update', 'channel.delete', 'channel.manage_members',
  // Moderar chamada e administrar, nao participar: quem silencia ou desconecta
  // alguem exerce papel, e por isso pode faze-lo sem estar na sala.
  'channel.moderate_call',
]
/**
 * Chamada segue os mesmos dois eixos do texto: entrar e transmitir vem do
 * pertencimento ao canal, nunca do papel no grupo. Qualquer participante
 * transmite — nao existe palco, e e essa a diferenca deliberada em relacao ao
 * modelo do Discord.
 */
const PARTICIPA_DA_CHAMADA: Action[] = ['channel.join_call', 'channel.publish']

/**
 * Unica fonte de autorizacao do sistema. Funcao pura: quem chama ja carregou o
 * papel e o pertencimento, e `can` apenas decide. E o que a torna testavel por
 * matriz exaustiva sem banco.
 */
export function can(actor: Actor, action: Action, resource: Resource): boolean {
  // Fora do grupo, nada.
  if (actor.role === null) return false

  const isOwner = actor.role === 'owner'
  const isAdmin = actor.role === 'admin' || isOwner

  if (action === 'group.view') return true
  if (SO_DO_OWNER.includes(action)) return isOwner
  if (GERE_O_GRUPO.includes(action)) return isAdmin

  // Eixo ADMINISTRAR: vem do papel, independe de pertencer ao canal.
  // E o que deixa um admin apagar canal privado abandonado sem poder le-lo.
  if (ADMINISTRA_CANAL.includes(action)) return isAdmin

  // Eixo LER e ESCREVER: vem do pertencimento, jamais do papel.
  // Se o admin enxergasse tudo por ser admin, "privado" perderia o sentido.
  if (
    action === 'channel.read' || action === 'channel.write' || action === 'message.create'
    || PARTICIPA_DA_CHAMADA.includes(action)
  ) {
    return resource.visibility === 'private' ? actor.inChannel : true
  }

  if (action === 'message.edit_own' || action === 'message.delete_own') {
    return resource.authorId === actor.userId
  }

  if (action === 'message.delete_any') {
    return resource.authorId === actor.userId || isAdmin
  }

  // Nao e defensivo por habito: garante que uma acao nova acrescentada ao tipo
  // Action nasca negada, em vez de liberada por esquecimento.
  return false
}
