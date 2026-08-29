# 04 — Protocolo de tempo real

## 1. Uma conexão por pessoa

Não uma por canal, nem uma por grupo. O servidor já sabe de quais grupos e
canais o usuário participa, então **as inscrições são implícitas** — o cliente
nunca pede para "entrar" em nada. Menos estado compartilhado, menos
oportunidade de dessincronização.

Autenticação acontece no upgrade do WebSocket, lendo o mesmo cookie
`altcast_session`. Sessão ausente, expirada ou revogada resulta em `401` antes
de o protocolo subir — nunca uma conexão aberta e depois fechada.

## 2. O cliente quase não fala

Do cliente para o servidor existem exatamente dois tipos de mensagem:

| Tipo | Conteúdo | Efeito |
|---|---|---|
| `pong` | vazio | Resposta ao heartbeat |
| `typing` | `channelId` | Efêmero, TTL de 5 s, nunca toca o banco |

Qualquer outro tipo recebido é **descartado com log de aviso**. Não há caminho
de escrita pelo WebSocket. Toda mutação é HTTP.

## 3. Do servidor para o cliente

Envelope único, com `t` de tipo e `d` de dados.

### Catálogo de eventos da Fatia 1

| Evento | Quando | Audiência |
|---|---|---|
| `ready` | Logo após conectar | Só a conexão que abriu |
| `message.created` | Mensagem enviada | Audiência do canal |
| `message.updated` | Mensagem editada | Audiência do canal |
| `message.deleted` | Soft delete | Audiência do canal |
| `channel.created` | Canal criado, ou você foi adicionado a um privado | Audiência do canal |
| `channel.updated` | Nome, tópico ou posição mudou | Audiência do canal |
| `channel.deleted` | Canal apagado, ou você foi removido de um privado | Audiência anterior |
| `member.joined` | Alguém entrou no grupo | Membros do grupo |
| `member.left` | Alguém saiu ou foi removido | Membros do grupo |
| `member.updated` | Papel ou nome de exibição mudou | Membros do grupo |
| `presence.update` | Alguém ficou online ou offline | Membros dos grupos em comum |
| `typing.start` | Alguém começou a digitar | Audiência do canal, menos o autor |

### Reservado para a Fatia 2

O prefixo `voice.` fica reservado desde já: `voice.participant_joined`,
`voice.participant_left`, `voice.track_published`, `voice.speaking`.
Nenhum é emitido na Fatia 1.

### Conteúdo do ready

Campos entregues: `user` (id, displayName, avatarUrl); `groups` (id, name,
iconUrl, role); `channels` (id, groupId, name, type, visibility, topic,
position); `members` (groupId, userId, displayName, role, status); e
`serverTime` no formato ISO 8601 UTC, por exemplo `2026-08-28T20:14:00Z`.

A lista `channels` já vem **filtrada pela visibilidade**. Canal privado do qual
o usuário não participa não aparece — nem com flag, nem com nome, nem com ID.

O `serverTime` permite ao cliente calcular a diferença de relógio e exibir
horários corretos mesmo com relógio local errado.

## 4. Cálculo de audiência (fan-out)

Este é o ponto do sistema onde um erro vaza dado privado. A regra:

```
audiencia(canal) = membros_do_grupo(canal.groupId)
                   INTERSECAO
                   se canal for privado: membros_do_canal(canal.id)
                   se canal for publico: todos
```

Consequências obrigatórias:

- `message.created` em canal privado vai **apenas** para a lista do canal
- Ser **adicionado** a um canal privado dispara `channel.created` só para a
  pessoa adicionada — o canal aparece na barra lateral na hora, sem recarregar
- Ser **removido** dispara `channel.deleted` só para ela — o canal some na hora,
  e as mensagens daquele canal são descartadas da memória do cliente
- `presence.update` é entregue apenas a quem compartilha ao menos um grupo

A função de fan-out vive isolada em `realtime/fanout.ts`, recebe o recurso e
devolve a lista de conexões destino. Nenhuma rota calcula audiência por conta
própria.

## 5. O princípio que sustenta a robustez

> **O WebSocket tem permissão para perder eventos.**

Isto soa como defeito e é o contrário. Toda tentativa de fazer um WebSocket
entregar com garantia — números de sequência, buffer de replay, confirmação de
recebimento, detecção de lacuna — reconstrói TCP mal feito em cima de TCP. É
onde sistemas de tempo real apodrecem.

A alternativa adotada: **ao reconectar, o cliente busca por REST as mensagens
posteriores à última que conhece, em cada canal aberto.**

```
socket cai  -->  backoff  -->  reconecta  -->  recebe novo ready
                                                    |
                        para cada canal com historico carregado:
                        GET /api/channels/:id/messages?after=<ultimoIdConhecido>
                                                    |
                                        estado reconciliado, buraco curado
```

O WebSocket é apenas um acelerador. **A verdade mora sempre no REST.** Se o
canal ficar mudo trinta segundos dentro de um elevador, a reconexão cura sozinha
e o usuário não percebe.

Isso simplifica o servidor drasticamente e é a razão de a reconexão funcionar de
primeira, em vez de virar a maior fonte de defeitos do projeto — que é o destino
habitual desse tipo de sistema.

## 6. Heartbeat e conexões meio-mortas

- O servidor envia `ping` a cada **30 s**
- Conexão sem `pong` em **60 s** é encerrada e removida do registro
- Cliente que não recebe `ping` em 60 s assume conexão morta e reconecta

Sem isso, NAT corporativo e rede móvel deixam conexões aparentemente abertas que
morreram há muito tempo — e o sistema exibe como online gente que saiu há uma
hora. É um detalhe pequeno e é a diferença entre presença confiável e presença
decorativa.

## 7. Reconexão no cliente

Backoff exponencial com jitter:

| Tentativa | Espera |
|---|---|
| 1 | 1 s ± 30% |
| 2 | 2 s ± 30% |
| 3 | 4 s ± 30% |
| 4 | 8 s ± 30% |
| 5 ou mais | 30 s ± 30% (teto) |

O **jitter é obrigatório**: sem ele, se o servidor reiniciar, todos os clientes
voltam no mesmo milissegundo e derrubam de novo o que acabou de subir.

A contagem zera após 60 s de conexão estável. Há reconexão manual imediata
quando a aba volta a ficar visível (evento `visibilitychange`) ou quando o
navegador reporta `online`.

## 8. Presença

Estado mantido em memória, como um mapa de `userId` para o conjunto de
conexões ativas daquele usuário.

- Fica `online` quando a primeira conexão do usuário abre
- Fica `offline` quando a última fecha
- Não persiste, porque não é dado — é um fato sobre conexões existentes agora

Reiniciar a API zera a presença, que se reconstrói em segundos conforme os
clientes reconectam. Isso é correto, não um defeito.

**Único ponto que muda para escalar horizontalmente:** com mais de uma instância
da API, este mapa migra para Redis Pub/Sub. Nada mais no desenho precisa mudar.

## 9. Indicador de digitação

- O cliente emite `typing` no máximo a cada 3 s enquanto digita
- O servidor repassa `typing.start` para a audiência do canal, exceto o autor
- O cliente expira o indicador localmente após 5 s sem novo evento
- **Nunca toca o banco** e **nunca entra em região viva de acessibilidade** —
  ver [05 — Interface](05-interface.md), seção de acessibilidade

## 10. Limites de proteção

| Limite | Valor | Motivo |
|---|---|---|
| Conexões por usuário | 5 | Abas abertas; acima disso, a mais antiga cai |
| Tamanho de mensagem WS recebida | 4 KB | O cliente só manda `pong` e `typing` |
| Mensagens WS por segundo por conexão | 10 | Acima disso, desconecta |
| Tempo máximo de conexão | sem limite | O heartbeat já cobre |
