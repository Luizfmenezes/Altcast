import { describe, it, expect } from 'vitest'
import { can, type Action, type Actor, type Resource } from '../src/permissions/can.js'

const ator = (role: Actor['role'], inChannel = false): Actor =>
  ({ userId: 'u1', role, inChannel })

const canalPublico: Resource = { kind: 'channel', visibility: 'public' }
const canalPrivado: Resource = { kind: 'channel', visibility: 'private' }
const grupo: Resource        = { kind: 'group' }
const msgPropria: Resource   = { kind: 'message', authorId: 'u1' }
const msgTerceiro: Resource  = { kind: 'message', authorId: 'u2' }

describe('can — tabela de verdade', () => {
  const casos: Array<[string, Actor, Action, Resource, boolean]> = [
    ['owner le canal publico',             ator('owner'),         'channel.read',   canalPublico, true],
    ['member le canal publico',            ator('member'),        'channel.read',   canalPublico, true],
    ['nao-membro nao le canal publico',    ator(null),            'channel.read',   canalPublico, false],
    ['member dentro do privado le',        ator('member', true),  'channel.read',   canalPrivado, true],
    ['member fora do privado nao le',      ator('member', false), 'channel.read',   canalPrivado, false],
    ['admin fora do privado NAO le',       ator('admin', false),  'channel.read',   canalPrivado, false],
    ['owner fora do privado NAO le',       ator('owner', false),  'channel.read',   canalPrivado, false],
    ['admin apaga privado sem ler',        ator('admin', false),  'channel.delete', canalPrivado, true],
    ['owner apaga privado sem ler',        ator('owner', false),  'channel.delete', canalPrivado, true],
    ['member nao apaga canal',             ator('member', true),  'channel.delete', canalPrivado, false],
    ['member escreve em publico',          ator('member'),        'channel.write',  canalPublico, true],
    ['member fora do privado nao escreve', ator('member', false), 'channel.write',  canalPrivado, false],
    ['owner apaga grupo',                  ator('owner'),         'group.delete',      grupo, true],
    ['admin nao apaga grupo',              ator('admin'),         'group.delete',      grupo, false],
    ['admin convida',                      ator('admin'),         'group.invite',      grupo, true],
    ['member nao convida',                 ator('member'),        'group.invite',      grupo, false],
    ['admin remove membro',                ator('admin'),         'group.kick',        grupo, true],
    ['member nao remove membro',           ator('member'),        'group.kick',        grupo, false],
    ['owner muda papel',                   ator('owner'),         'group.change_role', grupo, true],
    ['admin nao muda papel',               ator('admin'),         'group.change_role', grupo, false],
    ['member ve o grupo',                  ator('member'),        'group.view',        grupo, true],
    ['admin atualiza o grupo',             ator('admin'),         'group.update',      grupo, true],
    ['member nao atualiza o grupo',        ator('member'),        'group.update',      grupo, false],
    ['admin cria canal',                   ator('admin'),         'channel.create',    grupo, true],
    ['member nao cria canal',              ator('member'),        'channel.create',    grupo, false],
    ['admin gerencia acesso do canal',     ator('admin', false),  'channel.manage_members', canalPrivado, true],
    ['member nao gerencia acesso',         ator('member', true),  'channel.manage_members', canalPrivado, false],
    ['member cria mensagem em publico',    ator('member'),        'message.create',    canalPublico, true],
    ['member fora do privado nao cria',    ator('member', false), 'message.create',    canalPrivado, false],
    ['member anexa em publico',            ator('member'),        'message.attach',    canalPublico, true],
    ['member fora do privado nao anexa',   ator('member', false), 'message.attach',    canalPrivado, false],
    ['member dentro do privado anexa',     ator('member', true),  'message.attach',    canalPrivado, true],
    ['admin fora do privado NAO anexa',    ator('admin', false),  'message.attach',    canalPrivado, false],
    ['member le anexo de publico',         ator('member'),        'attachment.read',   canalPublico, true],
    ['member fora do privado nao le anexo',ator('member', false), 'attachment.read',   canalPrivado, false],
    ['member dentro do privado le anexo',  ator('member', true),  'attachment.read',   canalPrivado, true],
    // O anexo herda o segredo do canal: se o admin de fora lesse o arquivo por
    // ser admin, "privado" valeria para o texto e nao para o que vai junto.
    ['admin fora do privado NAO le anexo', ator('admin', false),  'attachment.read',   canalPrivado, false],
    ['owner fora do privado NAO le anexo', ator('owner', false),  'attachment.read',   canalPrivado, false],
    // Reagir acompanha ESCREVER, e nao ler: a reacao e visivel para a sala
    // inteira e leva o nome de quem reagiu junto. Quem so le nao deixa rastro.
    ['member reage em publico',            ator('member'),        'message.react',     canalPublico, true],
    ['member fora do privado nao reage',   ator('member', false), 'message.react',     canalPrivado, false],
    ['member dentro do privado reage',     ator('member', true),  'message.react',     canalPrivado, true],
    ['admin fora do privado NAO reage',    ator('admin', false),  'message.react',     canalPrivado, false],
    ['autor edita a propria',              ator('member'),        'message.edit_own',   msgPropria,  true],
    ['nao edita a de terceiro',            ator('member'),        'message.edit_own',   msgTerceiro, false],
    ['autor apaga a propria',              ator('member'),        'message.delete_own', msgPropria,  true],
    ['nao apaga a de terceiro por delete_own', ator('member'),    'message.delete_own', msgTerceiro, false],
    ['admin apaga a de terceiro',          ator('admin'),         'message.delete_any', msgTerceiro, true],
    ['owner apaga a de terceiro',          ator('owner'),         'message.delete_any', msgTerceiro, true],
    ['member nao apaga a de terceiro',     ator('member'),        'message.delete_any', msgTerceiro, false],
    ['autor apaga a propria por delete_any', ator('member'),      'message.delete_any', msgPropria, true],
    // Chamada segue os MESMOS dois eixos do texto. Entrar e publicar vem do
    // pertencimento; moderar vem do papel. Se o admin entrasse numa chamada de
    // canal privado por ser admin, "privado" cairia justamente onde mais
    // importa: na voz de quem esta na sala.
    ['member entra em call publica',       ator('member'),        'channel.join_call',  canalPublico, true],
    ['member dentro do privado entra',     ator('member', true),  'channel.join_call',  canalPrivado, true],
    ['member fora do privado nao entra',   ator('member', false), 'channel.join_call',  canalPrivado, false],
    ['admin fora do privado NAO entra',    ator('admin', false),  'channel.join_call',  canalPrivado, false],
    ['owner fora do privado NAO entra',    ator('owner', false),  'channel.join_call',  canalPrivado, false],
    // Qualquer participante transmite: e a diferenca deliberada para o modelo
    // de palco do Discord, e o que faz a ferramenta servir a uma reuniao.
    ['member publica em publica',          ator('member'),        'channel.publish',    canalPublico, true],
    ['member dentro do privado publica',   ator('member', true),  'channel.publish',    canalPrivado, true],
    ['member fora do privado nao publica', ator('member', false), 'channel.publish',    canalPrivado, false],
    ['admin fora do privado NAO publica',  ator('admin', false),  'channel.publish',    canalPrivado, false],
    ['admin modera a chamada',             ator('admin', false),  'channel.moderate_call', canalPublico, true],
    ['owner modera a chamada',             ator('owner', false),  'channel.moderate_call', canalPrivado, true],
    ['member nao modera a chamada',        ator('member', true),  'channel.moderate_call', canalPublico, false],
  ]

  for (const [nome, a, acao, recurso, esperado] of casos) {
    it(nome, () => expect(can(a, acao, recurso)).toBe(esperado))
  }
})

it('nao-membro nao pode absolutamente nada', () => {
  const acoes: Action[] = [
    'group.view','group.update','group.delete','group.invite','group.kick',
    'group.change_role','channel.create','channel.update','channel.delete',
    'channel.read','channel.write','channel.manage_members','message.create',
    'message.edit_own','message.delete_own','message.delete_any',
    'channel.join_call','channel.publish','channel.moderate_call',
    'message.attach','attachment.read','message.react',
  ]
  for (const acao of acoes) {
    expect(can(ator(null), acao, grupo)).toBe(false)
    expect(can(ator(null), acao, canalPublico)).toBe(false)
    expect(can(ator(null), acao, canalPrivado)).toBe(false)
  }
})

it('acao desconhecida nasce negada', () => {
  // Garante o return false final: uma acao nova no tipo Action que ninguem
  // tratou precisa ser recusada, nunca liberada por omissao.
  expect(can(ator('owner', true), 'group.export' as Action, grupo)).toBe(false)
})
