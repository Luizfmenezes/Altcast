# Proposta — Mensagens diretas

> Data: 2026-09-10. Status: **proposta. Não passou por brainstorming nem por
> aprovação.** Existe para ser executada mais adiante, não agora.

## 1. O problema

No Altcast, toda conversa mora dentro de um grupo. Não existe caminho para
falar com uma pessoa só. Na prática isso empurra a conversa reservada para
fora do produto — WhatsApp, Teams, e-mail — e é exatamente a conversa que
depois ninguém encontra.

É a maior lacuna funcional em relação ao Discord, e a única que não dá para
resolver com interface: mexe no modelo de dados, no cálculo de audiência e na
função de permissão.

## 2. Por que não é só "um canal sem grupo"

Três invariantes do sistema hoje assumem que grupo existe:

- `channels.groupId` é `not null` e referencia `groups` (`schema.ts:121`).
- `audienceOfChannel()` resolve canal público consultando o grupo
  (`fanout.ts:31`). Sem grupo, o `else` cai no vazio.
- `can()` recusa qualquer coisa quando `actor.role === null`, e papel vem de
  `group_members` (`can.ts`). Numa DM não existe papel.

Qualquer desenho precisa responder a essas três, e a escolha entre eles é a
decisão central desta proposta.

## 3. Três caminhos

### A. DM é um grupo invisível  *(recomendado)*

Uma DM é uma linha em `groups` com uma marca — `kind = 'dm' | 'group'` — e um
único canal de texto dentro. Os participantes são `group_members` comuns.

**O que isso compra, de graça:** mensagens, respostas, reações, menções,
anexos, marcos de leitura, `fanout`, `emit`, paginação por cursor, busca e a
interface de conversa inteira passam a funcionar em DM sem uma linha nova.
`audienceOfChannel` já responde certo. `can()` já responde certo — os dois
participantes são `member` de um grupo de dois.

**O que custa:** grupo de DM não pode aparecer na barra de grupos, não pode
emitir convite, não pode ser renomeado, não pode receber canal novo, não pode
ter papel alterado. São seis negações, e cada uma é um lugar onde esquecer
produz um defeito visível. A mitigação é concentrá-las: uma função
`ehConversaDireta(groupId)` consultada por `can()`, e não seis `if` espalhados
pelas rotas — o mesmo princípio que fez `can.ts` existir.

**A invariante que impede duplicata:** não pode haver duas DMs entre as mesmas
duas pessoas. Isso é um índice único no banco, jamais uma consulta antes da
inserção — dois cliques simultâneos ganham a corrida de qualquer verificação
em código. Uma coluna derivada `dmKey` (os dois uuids ordenados e concatenados)
com índice único resolve, e o banco passa a ser dono da regra.

### B. `channels.groupId` vira nulo, com lista própria de membros

Menos tabelas, mas transforma uma coluna `not null` — na qual o resto do
sistema se apoia — em algo que precisa ser verificado em todo lugar. Troca seis
negações concentradas por uma dúvida difusa em cada consulta. Não recomendo.

### C. Subsistema paralelo (`conversations`, `conversation_messages`)

Isolamento perfeito e duplicação de tudo: segunda tabela de mensagens, segundo
cálculo de audiência, segunda paginação, segunda interface. A segunda cópia
diverge — sempre — e o sintoma aparece como "editar funciona no canal e não na
DM". Não recomendo.

## 4. O desenho, seguindo o caminho A

### 4.1 Banco

```
groups
  + kind      enum ('group' | 'dm')  not null default 'group'
  + dm_key    text  null, unique      -- 'uuidA:uuidB', ordenados
```

`ownerId` numa DM aponta para quem iniciou, e `group.delete` fica negado de
todo jeito: ninguém apaga uma conversa do outro. Sair de uma DM é esconder da
própria lista, não destruir para os dois.

### 4.2 Permissão

`can()` ganha um eixo, e não um caso especial: uma DM é um grupo onde
`group.update`, `group.delete`, `group.invite`, `group.kick`,
`group.change_role`, `channel.create`, `channel.update` e `channel.delete`
estão negados para todo mundo, inclusive o `owner`. Tudo o mais segue idêntico.

Isso mantém a promessa do arquivo: **uma função decide toda permissão**, e a
matriz exaustiva de teste ganha uma dimensão em vez de um ramo.

### 4.3 Rotas

```
GET    /api/dms                 lista minhas conversas, ordenadas pela última mensagem
POST   /api/dms                 { userId } -> cria ou devolve a existente (idempotente)
DELETE /api/dms/:id             esconde da minha lista; não apaga para o outro
```

Tudo o mais — mensagens, leitura, reações, anexos — usa as rotas de canal que
já existem, com o `channelId` da DM.

**Quem pode iniciar uma DM com quem:** só quem compartilha ao menos um grupo.
`audienceOfUser()` (`fanout.ts:51`) já calcula exatamente esse conjunto e existe
com cobertura de 100%. Sem essa regra, o cadastro aberto vira um caminho para
qualquer conta nova abordar qualquer pessoa.

### 4.4 Tempo real

Nenhum evento novo: `message.created` e companhia já vão para
`audienceOfChannel`, que numa DM devolve as duas pessoas. O que precisa nascer
é `dm.created`, para a conversa aparecer na lista de quem foi procurado sem
precisar recarregar.

### 4.5 Interface

- Uma lista de conversas ao lado da barra de grupos, no lugar que o Discord usa
  para o botão de casa.
- Iniciar DM a partir do card de pessoa e da paleta de comandos, que já busca
  membros.
- Não-lidas e notificação de DM contam sempre como menção (§3.2 da proposta do
  loop de atenção): uma mensagem dirigida a você é, por definição, dirigida a
  você.

## 5. Grupo de DM (três ou mais pessoas)

O caminho A já suporta: é um grupo `kind = 'dm'` com mais membros e sem
`dm_key`. Vale deixar a porta aberta no modelo e **não** implementar junto —
ele traz perguntas próprias (quem adiciona, quem remove, o que acontece quando
o último sai) que não devem atrasar a DM de duas pessoas.

## 6. Fora de escopo

Pedido de amizade, bloqueio, DM entre pessoas sem grupo em comum, criptografia
ponta a ponta (fora de escopo do produto inteiro, spec 00) e chamada de voz
dentro da DM — esta última é desejável e depende de um canal de voz sem grupo,
o que é outra rodada.

## 7. Decisões em aberto

1. Sair de uma DM apaga o histórico para mim, ou só esconde a conversa?
2. DM aparece no cálculo de presença? Hoje `audienceOfUser` usa grupos; um
   grupo de DM entraria ali e faria duas pessoas trocarem presença por terem
   conversado uma vez.
3. Bloquear alguém entra nesta fatia ou fica para moderação?
