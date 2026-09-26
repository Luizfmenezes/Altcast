import {
  DEPENDEM_DO_CANAL, POR_AUTORIA, SOBRE_OUTRO_MEMBRO, ehAcao, type Action,
} from './acoes.js'

export type { Action } from './acoes.js'
export type Visibility = 'public' | 'private'

/**
 * O ator, com as permissoes JA RESOLVIDAS.
 *
 * Esta e a unica mudanca que os cargos trouxeram a este arquivo, e ela foi
 * escolhida justamente para nao trazer outras: `can` continua pura, continua a
 * unica a decidir, e ficou MENOR — as listas de papel viraram dado, em
 * `acoes.ts`, e quem monta o conjunto e `context.ts`, num lugar so.
 *
 * O que sobrou aqui e exatamente o que nunca foi sobre cargo: pertencimento ao
 * canal, autoria da mensagem, hierarquia entre pessoas, e a negacao por
 * omissao no fim.
 */
export type Actor = {
  userId: string
  /**
   * `null` significa NAO PERTENCE ao grupo, e continua sendo o primeiro
   * portao. Conjunto vazio e outra coisa: pertence e nao pode nada.
   */
  permissoes: ReadonlySet<Action> | null
  /**
   * O dono atravessa toda permissao concedivel — e so ela.
   *
   * Nao e conveniencia: sem esta saida, um cargo mal configurado tranca o
   * grupo para sempre e nao existe suporte para chamar. O que ela NAO
   * atravessa esta logo abaixo, e e o que importa: nem o pertencimento a canal
   * privado, nem a autoria de mensagem alheia, nem acao que o sistema nao
   * conhece.
   */
  ehDono: boolean
  inChannel: boolean
  /**
   * A posicao do cargo mais alto desta pessoa. Zero para quem nao tem cargo
   * nenhum; o dono nao usa este campo, porque atravessa a comparacao.
   */
  topo: number
  /**
   * O vinculo em `group_members`, para EXIBIR — nunca para decidir.
   *
   * `can` nao le este campo, e isso e verificavel: ele nao aparece uma vez
   * sequer no corpo da funcao. Ele existe porque as respostas da API sempre
   * carregaram o papel da pessoa no grupo, e o cliente desenha o rotulo
   * "Dono / Administrador / Membro" com ele. Resolver permissao a partir daqui
   * seria voltar ao que os cargos vieram substituir.
   */
  papel: 'owner' | 'admin' | 'member' | null
}

export type Resource = {
  kind: 'group' | 'channel' | 'message'
  visibility?: Visibility
  authorId?: string
  /**
   * A posicao do cargo mais alto de QUEM SOFRE a acao.
   *
   * Ausente vale zero — o alvo sem cargo. E o padrao seguro: na duvida o alvo
   * esta no chao da hierarquia, e quem age precisa de pelo menos um cargo para
   * alcanca-lo.
   */
  topoDoAlvo?: number
}

/**
 * Unica fonte de autorizacao do sistema. Funcao pura: quem chama ja resolveu
 * as permissoes e o pertencimento, e `can` apenas decide. E o que a torna
 * testavel por matriz exaustiva sem banco.
 */
export function can(actor: Actor, action: Action, resource: Resource): boolean {
  // Fora do grupo, nada.
  if (actor.permissoes === null) return false

  // Acao que o sistema nao conhece nasce NEGADA — inclusive para o dono. E o
  // que garante que uma permissao nova, acrescentada ao tipo e esquecida na
  // resolucao, seja recusada em vez de liberada por omissao.
  if (!ehAcao(action)) return false

  // Pertencer ao grupo ja e ver o grupo. Nenhum cargo precisa conceder isto, e
  // nenhum pode negar: a pessoa esta la dentro.
  if (action === 'group.view') return true

  // Autoria nao e cargo. Marcar isto num cargo nao concede nada sobre a
  // mensagem de terceiro, e por isso a tela de permissoes nem as mostra.
  if (POR_AUTORIA.includes(action)) return resource.authorId === actor.userId

  // A propria mensagem sempre cede a quem a escreveu, com ou sem moderacao.
  if (action === 'message.delete_any' && resource.authorId === actor.userId) return true

  const concedida = actor.ehDono || actor.permissoes.has(action)
  if (!concedida) return false

  // Eixo PERTENCIMENTO, e o unico que o dono tambem respeita. Se administrar
  // enxergasse tudo, "privado" perderia o sentido exatamente onde mais importa.
  // O arquivo herda o segredo do canal junto com o texto, e a voz junto com os
  // dois: e a mesma porta, e ela nao pode ter tres fechaduras diferentes.
  if (DEPENDEM_DO_CANAL.includes(action)) {
    return resource.visibility === 'private' ? actor.inChannel : true
  }

  // Eixo HIERARQUIA: so se mexe em quem esta abaixo. Sem isto, um cargo de
  // moderacao criado por engano expulsa quem o criou, e a volta seria por
  // `psql`.
  if (SOBRE_OUTRO_MEMBRO.includes(action)) {
    return actor.ehDono || actor.topo > (resource.topoDoAlvo ?? 0)
  }

  return true
}
