# Proposta — Cargos, cores e permissão por canal

> Data: 2026-09-10. Status: **IMPLEMENTADA em 2026-09-26.**
>
> O documento fica como registro do raciocínio, e não como plano pendente. O
> que de fato foi construído difere dele em três pontos, todos decididos
> durante a execução:
>
> - **`@everyone` virou linha de verdade** (decisão em aberto §10.1). Custa a
>   coluna `is_default` e economiza um caso especial em toda consulta, em toda
>   tela e em todo teste.
> - **Teto de 25 cargos por grupo** (decisão em aberto §10.2), cobrado na rota.
> - **Uma trava que a proposta não previa:** ninguém concede uma permissão que
>   não tem (`cannot_grant_unheld`). Sem ela, `group.manage_roles` seria um
>   atalho para todas as outras permissões e a tela de permissões seria
>   decoração.
>
> O passo 3 da migração (§8) foi cumprido: a matriz de `can.test.ts` virou o
> teste de equivalência e passa nas 64 células sem uma única alteração de
> expectativa. As permissões de canal por cargo (§6) continuam fora — canal
> privado segue com lista explícita em `channel_members`, e nenhum cargo o
> enxerga.

## 1. O problema

O Altcast tem três papéis fixos: `owner`, `admin`, `member`. É pouco para
qualquer grupo que cresça um pouco. Não existe "moderador que apaga mensagem
mas não apaga canal", não existe "convidado que lê e não escreve", não existe
"time de projeto com acesso a estes três canais" sem transformar cada um deles
em canal privado com lista manual.

E falta a metade visível: no Discord, cargo tem **cor e nome**, e é isso que
faz a lista de membros comunicar quem é quem antes de qualquer permissão
entrar em jogo. Metade do valor do sistema de cargos é estética, e essa metade
é barata.

## 2. O que está em risco

`api/src/permissions/can.ts` é o coração declarado do projeto:

> **Princípio #2 — Uma função decide toda permissão.** Nenhuma checagem de
> papel espalhada pelo código.

A função é pura, tem cobertura exigida de 100%, e é testada por matriz
exaustiva sem banco. Qualquer desenho que **espalhe** decisão de permissão para
fora dela destrói o principal ativo de segurança do sistema, e não vale
nenhuma feature.

A boa notícia: cargos não exigem espalhar nada. Exigem trocar o *formato da
entrada* de `can`, não o lugar onde ela decide.

## 3. A ideia central

Hoje o ator carrega um papel:

```ts
type Actor = { userId: string; role: Role | null; inChannel: boolean }
```

Passa a carregar um **conjunto de permissões já resolvido**:

```ts
type Actor = {
  userId: string
  /** null = não pertence ao grupo. Continua sendo o primeiro portão. */
  permissoes: Set<Action> | null
  /** Dono do grupo: atravessa tudo, e existe para o grupo nunca ficar trancado. */
  ehDono: boolean
  inChannel: boolean
}
```

`can()` continua pura, continua a única a decidir, e fica **mais simples** — as
listas `GERE_O_GRUPO`, `SO_DO_OWNER` e `ADMINISTRA_CANAL` deixam de existir
porque viram dado, e não código. O que sobra nela é justamente o que nunca foi
sobre cargo:

- pertencimento (`resource.visibility === 'private' ? actor.inChannel : true`);
- autoria (`message.edit_own`, `message.delete_own`);
- a negação por omissão no final, que faz ação nova nascer proibida.

**Quem resolve o conjunto** é `permissions/context.ts` — que já é o lugar que
carrega papel e pertencimento hoje (`loadChannelActor()`). Ele passa a somar os
cargos da pessoa e aplicar as exceções do canal. Uma função nova, um lugar só,
testável.

## 4. Banco

```
roles
  id          uuid  pk
  group_id    uuid  -> groups(id) on delete cascade
  name        text
  color       text  null          -- '#5865F2'; null = herda a cor do texto
  position    int                 -- hierarquia: maior manda mais
  permissions text[]              -- os literais de Action
  UNIQUE (group_id, name)

member_roles
  group_id, user_id, role_id      -- PK tripla
  FK composta -> group_members(group_id, user_id) on delete cascade

channel_overwrites
  channel_id  uuid -> channels(id) on delete cascade
  subject_type enum ('role' | 'user')
  subject_id  uuid
  allow       text[]
  deny        text[]
  PK (channel_id, subject_type, subject_id)
```

Três decisões a registrar:

1. **`permissions` guarda os literais de `Action`**, não um bitfield. O bitfield
   do Discord existe por escala que nós não temos, e cobra caro: um número no
   banco que ninguém lê sem uma tabela de tradução ao lado, e uma migração
   perigosa toda vez que uma permissão nasce. Texto é auditável em `psql`.
2. **A FK de `member_roles` aponta para `group_members`, não para `users`.**
   É o que garante, no banco, que sair do grupo leva os cargos junto — e não
   deixa uma linha órfã que volta a valer se a pessoa reentrar.
3. **`position` é a hierarquia**, e ela não é decoração: sem ela, um moderador
   expulsa um administrador. A regra "só mexo em quem está abaixo de mim" mora
   em `can()` como comparação de números.

## 5. Resolução, em ordem

Do mais geral para o mais específico, que é a ordem do Discord e a única que as
pessoas conseguem prever:

1. Permissões do cargo `@everyone` do grupo (o cargo padrão, sempre existe).
2. União das permissões de todos os cargos da pessoa.
3. `deny` das exceções de canal dos cargos dela; depois o `allow` dos cargos.
4. `deny` da exceção de canal dirigida à pessoa; depois o `allow` dela.
5. Dono do grupo atravessa tudo.

O passo 5 não é conveniência: sem ele, um cargo mal configurado tranca o grupo
para sempre, e não existe suporte para chamar.

## 6. O que continua valendo, e não se negocia

**Privado continua significando invisível.** Um cargo com "ver todos os canais"
seria o fim do princípio #3 e do `audienceOfChannel`. Canal privado segue com
lista explícita; cargo concede permissão *dentro* do que a pessoa já enxerga,
nunca acesso a canal do qual ela não participa.

A alternativa — canal privado por cargo, como no Discord — é possível e é uma
**terceira** proposta, porque muda `fanout.ts`, que é o arquivo com 100% de
cobertura exigida justamente por concentrar o risco de vazamento.

## 7. A metade barata: cor e nome

Pode ser feita **antes e sozinha**, sem nada do resto:

- `roles` com `name`, `color`, `position`, e `permissions` vazio.
- Nome colorido na lista de membros, no autor da mensagem e no card de pessoa.
- Lista de membros agrupada por cargo, com o cargo mais alto como cabeçalho.

Entrega a maior parte da *sensação* de Discord por uma fração do custo, e
prepara o terreno do banco para quando as permissões entrarem.

**Cuidado de acessibilidade:** cor de cargo é escolhida por gente, e gente
escolhe cinza-claro sobre branco. O contraste precisa ser corrigido na
renderização contra o fundo do tema — WCAG 2.2 AA é requisito do projeto, não
revisão final, e um cargo não pode furá-lo.

## 8. Migração

O caminho tem que ser sem tempo de parada e reversível:

1. Criar as tabelas. Nada as lê ainda.
2. Semear, por grupo: um cargo `@everyone` com as permissões do `member` de
   hoje, um cargo `Administrador` com as do `admin`, e vincular quem é `admin`.
3. Trocar `Actor` e `can()`; a matriz de teste existente vira o teste de
   equivalência — **o comportamento não pode mudar em nenhuma célula**.
4. Só então abrir a interface de criar cargo.

`group_members.role` permanece durante toda a migração e continua sendo a
verdade sobre quem é dono. Apagá-la é um passo separado, depois de tudo verde.

## 9. Fora de escopo

Cargos com ícone, cargos por menção (`@moderadores`), cargos automáticos por
tempo de casa, canal privado concedido por cargo (§6) e log de auditoria — este
último passa a ser bem mais necessário depois desta fatia, e merece proposta
própria.

## 10. Decisões em aberto

1. `@everyone` é uma linha de verdade em `roles` ou um valor implícito?
   (Linha de verdade custa uma migração e economiza um caso especial em toda
   consulta.)
2. Quantos cargos por grupo antes de a lista de membros ficar ilegível?
3. Vale mesmo a pena para grupos de ~50 pessoas (a escala alvo da spec 00), ou
   só a metade estética do §7 se paga?
