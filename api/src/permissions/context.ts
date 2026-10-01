import { and, eq, inArray, or } from 'drizzle-orm'
import { db } from '../db/client.js'
import {
  channelMembers, channelOverwrites, channels, groupMembers, groups, memberRoles, roles,
} from '../db/schema.js'
import { AppError } from '../shared/errors.js'
import { PERMISSOES_DA_CONVERSA, apenasAcoes, type Action } from './acoes.js'
import { can, type Actor, type Resource } from './can.js'
import { POSICAO_PADRAO as POSICAO_LEGADA, permissoesDoPapel } from './papeis.js'

export type ChannelRow = typeof channels.$inferSelect
export type RoleRow = typeof roles.$inferSelect

/**
 * Onde cargo vira permissao.
 *
 * `can.ts` decide; este arquivo RESOLVE. A separacao e o que permitiu os
 * cargos entrarem sem espalhar decisao de permissao pelo codigo — o princípio
 * #2 do projeto continua de pe, e a funcao pura ate encolheu.
 *
 * Toda a complexidade nova mora aqui, num lugar so, e e testavel contra um
 * banco de verdade.
 */

/** Os cargos que valem para esta pessoa: o de todos, mais os atribuidos a ela. */
async function cargosDe(userId: string, groupId: string): Promise<RoleRow[]> {
  const meus = db.select({ id: memberRoles.roleId }).from(memberRoles)
    .where(and(eq(memberRoles.groupId, groupId), eq(memberRoles.userId, userId)))

  return db.select().from(roles)
    .where(and(
      eq(roles.groupId, groupId),
      // O cargo de todos entra sem estar em `member_roles`: e o que ele
      // significa. Vincula-lo a cada membro seria guardar uma linha por pessoa
      // para dizer o que ja vale para todas.
      or(eq(roles.isDefault, true), inArray(roles.id, meus)),
    ))
}

/**
 * Soma as permissoes de um conjunto de cargos.
 *
 * Uniao, e nao intersecao: ter dois cargos nunca pode conceder MENOS do que
 * ter um. Quem quiser tirar algo de alguem com varios cargos usa a excecao do
 * canal, que e onde negar existe — porque la a negacao e local e visivel, e
 * nao um efeito colateral de ganhar um cargo novo.
 */
function somar(cargos: readonly RoleRow[]): Set<Action> {
  const conjunto = new Set<Action>()
  for (const c of cargos) for (const a of apenasAcoes(c.permissions)) conjunto.add(a)
  return conjunto
}

/**
 * A posicao mais alta entre os cargos ATRIBUIDOS.
 *
 * O cargo de todos nao conta: todo mundo o tem, entao ele e o chao e nunca a
 * altura de ninguem. Se contasse, qualquer membro alcancaria qualquer outro na
 * comparacao de hierarquia, e a regra "so mexo em quem esta abaixo" viraria
 * decorativa no exato caso que ela existe para cobrir.
 */
function altura(cargos: readonly RoleRow[]): number {
  let maior = 0
  for (const c of cargos) if (!c.isDefault && c.position > maior) maior = c.position
  return maior
}

/**
 * Busca o papel e resolve as permissoes da pessoa no grupo.
 *
 * `permissoes: null` significa que ela nao pertence — continua sendo o
 * primeiro portao de `can`.
 */
export async function loadGroupActor(userId: string, groupId: string): Promise<Actor> {
  const [linha] = await db.select({ role: groupMembers.role, kind: groups.kind })
    .from(groupMembers)
    .innerJoin(groups, eq(groups.id, groupMembers.groupId))
    .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, userId)))
    .limit(1)

  if (linha === undefined) {
    return { userId, permissoes: null, ehDono: false, inChannel: false, topo: 0, papel: null }
  }

  // Conversa direta: o conjunto e fixo e ninguem e dono. As seis negacoes da
  // proposta (renomear, apagar, convidar, expulsar, cargo, canal) saem daqui,
  // de uma vez, sem nenhuma rota precisar saber que conversas existem.
  if (linha.kind === 'dm') {
    return {
      userId, permissoes: new Set(PERMISSOES_DA_CONVERSA), ehDono: false,
      inChannel: false, topo: 0, papel: 'member',
    }
  }

  // Desestruturado, e nao lido como `linha.role`: a regra de lint proibe
  // comparar `.role` fora do nucleo de permissoes, e ela esta certa em cobrar
  // isso ate aqui dentro — o nome novo deixa explicito que este valor vira
  // rotulo e altura de fallback, nunca uma decisao.
  const { role: papel } = linha

  const cargos = await cargosDe(userId, groupId)

  // Grupo sem cargo padrao nao deveria existir — a migracao semeou um para
  // cada, e toda criacao cria o seu. Se acontecer mesmo assim, o certo e
  // voltar a se comportar como antes dos cargos, e nunca trancar todo mundo
  // para fora de um grupo que funcionava. Conjunto e altura andam juntos nessa
  // volta: resolver um pelo cargo e o outro pelo papel misturaria dois mundos.
  const temPadrao = cargos.some(c => c.isDefault)

  return {
    userId,
    permissoes: temPadrao ? somar(cargos) : permissoesDoPapel(papel),
    ehDono: papel === 'owner',
    inChannel: false,
    topo: temPadrao ? altura(cargos) : POSICAO_LEGADA[papel],
    papel,
  }
}

/**
 * A altura de OUTRA pessoa, para as acoes que se exercem sobre ela.
 *
 * O dono e inalcancavel por construcao: nenhuma posicao de cargo passa de
 * `Infinity`, e e assim que "ninguem expulsa o dono" deixa de depender de uma
 * guarda espalhada por cada rota.
 */
export async function alturaDe(userId: string, groupId: string): Promise<number> {
  const [linha] = await db.select({ role: groupMembers.role })
    .from(groupMembers)
    .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, userId)))
    .limit(1)
  if (linha === undefined) return 0
  const { role: papel } = linha
  if (papel === 'owner') return Number.POSITIVE_INFINITY

  const cargos = await db.select({ position: roles.position })
    .from(memberRoles)
    .innerJoin(roles, eq(roles.id, memberRoles.roleId))
    .where(and(eq(memberRoles.groupId, groupId), eq(memberRoles.userId, userId)))

  let maior = 0
  for (const c of cargos) if (c.position > maior) maior = c.position
  return maior
}

/**
 * Aplica as excecoes do canal sobre o conjunto ja somado.
 *
 * A ordem e a do Discord, e e a unica que as pessoas conseguem prever: do mais
 * geral para o mais especifico. Nega primeiro, libera depois, em cada nivel —
 * assim a excecao dirigida a UMA pessoa sempre vence a do cargo dela, que e
 * exatamente o que alguem espera ao criar uma excecao para uma pessoa.
 */
function aplicarExcecoes(
  base: Set<Action>,
  excecoes: readonly (typeof channelOverwrites.$inferSelect)[],
  idsDosCargos: ReadonlySet<string>,
  userId: string,
): Set<Action> {
  const fim = new Set(base)
  const porCargo = excecoes.filter(e => e.subjectType === 'role' && idsDosCargos.has(e.subjectId))
  const minha = excecoes.filter(e => e.subjectType === 'user' && e.subjectId === userId)

  for (const e of porCargo) for (const a of apenasAcoes(e.deny)) fim.delete(a)
  for (const e of porCargo) for (const a of apenasAcoes(e.allow)) fim.add(a)
  for (const e of minha) for (const a of apenasAcoes(e.deny)) fim.delete(a)
  for (const e of minha) for (const a of apenasAcoes(e.allow)) fim.add(a)

  return fim
}

/**
 * Carrega o canal, resolve as permissoes no grupo, aplica as excecoes do canal
 * e — somente se o canal for privado — consulta channel_members para preencher
 * inChannel.
 *
 * Devolve null quando o canal nao existe, para que a rota responda 404 sem
 * ramificacao extra.
 */
export async function loadChannelActor(
  userId: string,
  channelId: string,
): Promise<{ actor: Actor; channel: ChannelRow } | null> {
  const [canal] = await db.select().from(channels).where(eq(channels.id, channelId)).limit(1)
  if (!canal) return null

  const actor = await loadGroupActor(userId, canal.groupId)

  if (actor.permissoes !== null) {
    const cargos = await cargosDe(userId, canal.groupId)
    const excecoes = await db.select().from(channelOverwrites)
      .where(eq(channelOverwrites.channelId, channelId))
    if (excecoes.length > 0) {
      actor.permissoes = aplicarExcecoes(
        new Set(actor.permissoes), excecoes, new Set(cargos.map(c => c.id)), userId,
      )
    }
  }

  if (canal.visibility === 'private') {
    const [dentro] = await db.select({ userId: channelMembers.userId })
      .from(channelMembers)
      .where(and(eq(channelMembers.channelId, channelId), eq(channelMembers.userId, userId)))
      .limit(1)
    actor.inChannel = dentro !== undefined
  }

  return { actor, channel: canal }
}

/**
 * Lanca not_found — nunca forbidden — quando a acao e negada.
 *
 * Nao e cosmetico: um 403 num canal privado confirmaria que o canal existe, e a
 * spec 03 secao 9 estabelece que privado e invisivel, nao trancado.
 */
export function assertCan(actor: Actor, action: Action, resource: Resource): void {
  if (!can(actor, action, resource)) throw new AppError('not_found')
}
