/**
 * O catalogo de acoes, e os conjuntos que reproduzem os tres papeis antigos.
 *
 * Existe porque, com cargos, a mesma lista passa a ser lida por quatro lugares
 * que nao podem divergir: `can.ts` decide com ela, `context.ts` resolve com
 * ela, a migracao semeia com ela e a tela de permissoes DESENHA com ela. Antes
 * a lista morava so dentro de `can.ts`, em constantes de modulo — o que estava
 * certo enquanto papel era um enum de tres valores e ninguem mais precisava
 * saber o que cada um continha.
 *
 * O que NAO mora aqui e a decisao. `can.ts` continua sendo a unica a decidir;
 * este arquivo so diz quais acoes existem e como elas se agrupam.
 */

export type Action =
  | 'group.view' | 'group.update' | 'group.delete'
  | 'group.invite' | 'group.kick' | 'group.change_role' | 'group.manage_roles'
  | 'channel.create' | 'channel.update' | 'channel.delete'
  | 'channel.read' | 'channel.write' | 'channel.manage_members'
  | 'message.create' | 'message.edit_own' | 'message.delete_own' | 'message.delete_any'
  | 'message.attach' | 'attachment.read' | 'message.react'
  | 'channel.join_call' | 'channel.publish' | 'channel.moderate_call'

/**
 * Acoes que dependem de PERTENCER ao canal, e nao do cargo.
 *
 * Um cargo concede a acao; o pertencimento decide se ela alcanca aquele canal.
 * Sao dois portoes em serie, e e por isso que nenhum cargo — nem um cargo com
 * tudo marcado — enxerga canal privado do qual a pessoa nao participa. Se o
 * cargo bastasse, "privado" perderia o sentido exatamente onde ele mais
 * importa, e `audienceOfChannel` passaria a mentir.
 */
export const DEPENDEM_DO_CANAL: readonly Action[] = [
  'channel.read', 'channel.write', 'message.create', 'message.attach',
  'attachment.read', 'message.react', 'channel.join_call', 'channel.publish',
]

/**
 * Acoes exercidas SOBRE outro membro.
 *
 * Sao as unicas em que a hierarquia entra: quem age precisa estar acima do
 * alvo. Sem isso, um cargo de moderacao criado por engano expulsa quem o
 * criou — e a recuperacao passaria por `psql`.
 */
export const SOBRE_OUTRO_MEMBRO: readonly Action[] = [
  'group.kick', 'group.change_role',
]

/**
 * Acoes cuja resposta vem da AUTORIA da mensagem, nunca de cargo.
 *
 * Marcar `message.edit_own` num cargo nao concede nada a ninguem sobre a
 * mensagem alheia, e e por isso que elas nao aparecem na tela de permissoes.
 */
export const POR_AUTORIA: readonly Action[] = ['message.edit_own', 'message.delete_own']

/** Como o `member` de antes: o que todo mundo que entra no grupo pode. */
export const PERMISSOES_DE_TODOS: readonly Action[] = [
  'channel.read', 'channel.write', 'message.create', 'message.attach',
  'attachment.read', 'message.react', 'channel.join_call', 'channel.publish',
]

/** Como o `admin` de antes: o de todos, mais administrar grupo e canal. */
export const PERMISSOES_DE_ADMIN: readonly Action[] = [
  ...PERMISSOES_DE_TODOS,
  'group.update', 'group.invite', 'group.kick',
  'channel.create', 'channel.update', 'channel.delete', 'channel.manage_members',
  'channel.moderate_call', 'message.delete_any',
]

/**
 * O que so o dono podia, e continua so dele por padrao.
 *
 * Nao e uma trava: sao acoes concedíveis a um cargo como qualquer outra. A
 * diferenca e que nenhum cargo SEMEADO as traz, entao o comportamento de hoje
 * nao muda enquanto ninguem decidir conceder.
 */
export const PERMISSOES_SO_DO_DONO: readonly Action[] = [
  'group.delete', 'group.change_role', 'group.manage_roles',
]

/** Toda acao que existe. A ordem e a da tela de permissoes. */
export const TODAS: readonly Action[] = [
  'group.view', 'group.update', 'group.invite', 'group.kick',
  'group.change_role', 'group.manage_roles', 'group.delete',
  'channel.create', 'channel.update', 'channel.delete', 'channel.manage_members',
  'channel.read', 'channel.write', 'message.create', 'message.attach',
  'attachment.read', 'message.react', 'message.delete_any',
  'message.edit_own', 'message.delete_own',
  'channel.join_call', 'channel.publish', 'channel.moderate_call',
]

const CONJUNTO = new Set<string>(TODAS)

/** A acao existe neste sistema. `can` a consulta antes de qualquer concessao,
 *  para que uma acao desconhecida nasca negada ate para o dono. */
export function ehAcao(valor: string): valor is Action {
  return CONJUNTO.has(valor)
}

/** Descarta o que nao e acao conhecida. O banco guarda texto, e texto envelhece:
 *  uma permissao removida numa versao futura continua gravada nas linhas
 *  antigas, e ela precisa virar nada — nunca um erro de leitura. */
export function apenasAcoes(valores: readonly string[]): Action[] {
  return valores.filter(ehAcao)
}

/**
 * O que a tela de permissoes mostra.
 *
 * Mora no servidor, e nao no cliente, porque quem acrescenta uma `Action` mexe
 * neste arquivo — e assim nao existe o estado em que a acao existe, e vale, e
 * nenhuma tela sabe explicar o que ela faz.
 *
 * `group.view` fica de fora: pertencer ao grupo ja a concede, e um
 * interruptor que nao muda nada so ensina que os interruptores mentem.
 * As de autoria tambem, pelo motivo registrado em `POR_AUTORIA`.
 */
export type DescricaoDeAcao = {
  acao: Action
  secao: 'Grupo' | 'Canais' | 'Mensagens' | 'Voz'
  rotulo: string
  descricao: string
  /** Concede poder sobre outras pessoas — a tela avisa antes de marcar. */
  sensivel?: boolean
}

export const CATALOGO: readonly DescricaoDeAcao[] = [
  {
    acao: 'group.update', secao: 'Grupo',
    rotulo: 'Editar o grupo',
    descricao: 'Trocar o nome e a imagem do grupo.',
  },
  {
    acao: 'group.invite', secao: 'Grupo',
    rotulo: 'Convidar pessoas',
    descricao: 'Criar links de convite e convidar alguém diretamente.',
  },
  {
    acao: 'group.kick', secao: 'Grupo',
    rotulo: 'Remover membros',
    descricao: 'Tirar do grupo quem estiver abaixo deste cargo.',
    sensivel: true,
  },
  {
    acao: 'group.change_role', secao: 'Grupo',
    rotulo: 'Atribuir cargos',
    descricao: 'Dar e tirar cargos de quem estiver abaixo deste cargo.',
    sensivel: true,
  },
  {
    acao: 'group.manage_roles', secao: 'Grupo',
    rotulo: 'Gerenciar cargos',
    descricao: 'Criar, editar e apagar cargos abaixo deste.',
    sensivel: true,
  },
  {
    acao: 'group.delete', secao: 'Grupo',
    rotulo: 'Apagar o grupo',
    descricao: 'Apaga o grupo, os canais e todas as conversas. Não tem volta.',
    sensivel: true,
  },
  {
    acao: 'channel.create', secao: 'Canais',
    rotulo: 'Criar canais',
    descricao: 'Abrir canais de texto e de voz.',
  },
  {
    acao: 'channel.update', secao: 'Canais',
    rotulo: 'Editar canais',
    descricao: 'Trocar nome, assunto e ordem dos canais.',
  },
  {
    acao: 'channel.delete', secao: 'Canais',
    rotulo: 'Apagar canais',
    descricao: 'Apagar um canal e tudo que foi escrito nele.',
    sensivel: true,
  },
  {
    acao: 'channel.manage_members', secao: 'Canais',
    rotulo: 'Gerenciar acesso a canal privado',
    descricao: 'Decidir quem entra num canal privado. Não concede ler o canal.',
    sensivel: true,
  },
  {
    acao: 'channel.read', secao: 'Mensagens',
    rotulo: 'Ler mensagens',
    descricao: 'Ver o que foi escrito nos canais a que a pessoa já tem acesso.',
  },
  {
    acao: 'channel.write', secao: 'Mensagens',
    rotulo: 'Escrever mensagens',
    descricao: 'Enviar mensagens nos canais a que a pessoa já tem acesso.',
  },
  {
    acao: 'message.create', secao: 'Mensagens',
    rotulo: 'Criar mensagens',
    descricao: 'Necessária junto com escrever. Separada para poder suspender alguém sem tirar a leitura.',
  },
  {
    acao: 'message.attach', secao: 'Mensagens',
    rotulo: 'Enviar arquivos',
    descricao: 'Anexar imagens e arquivos às mensagens.',
  },
  {
    acao: 'attachment.read', secao: 'Mensagens',
    rotulo: 'Abrir arquivos',
    descricao: 'Ver e baixar o que os outros anexaram.',
  },
  {
    acao: 'message.react', secao: 'Mensagens',
    rotulo: 'Reagir',
    descricao: 'Responder com emoji. Deixa o nome de quem reagiu visível na sala.',
  },
  {
    acao: 'message.delete_any', secao: 'Mensagens',
    rotulo: 'Apagar mensagem de qualquer um',
    descricao: 'Moderação. Apagar a própria mensagem não depende disto.',
    sensivel: true,
  },
  {
    acao: 'channel.join_call', secao: 'Voz',
    rotulo: 'Entrar em chamadas',
    descricao: 'Entrar nos canais de voz a que a pessoa já tem acesso.',
  },
  {
    acao: 'channel.publish', secao: 'Voz',
    rotulo: 'Falar, mostrar câmera e tela',
    descricao: 'Transmitir na chamada. Sem isto, a pessoa entra e só escuta.',
  },
  {
    acao: 'channel.moderate_call', secao: 'Voz',
    rotulo: 'Moderar chamadas',
    descricao: 'Silenciar e desconectar quem está na sala, mesmo sem estar nela.',
    sensivel: true,
  },
]
