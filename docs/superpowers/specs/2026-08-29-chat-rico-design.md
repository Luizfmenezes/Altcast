# Chat rico — anexos, reações, respostas e menções

**Data:** 2026-08-29
**Estado:** desenho aprovado, aguardando plano de implementação
**Fatia:** 3 (a Fatia 1 entregou texto e tempo real; a Fatia 2, voz)

Este documento desenha a primeira das três frentes que aproximam o Altcast do
Discord. As outras duas — threads/fixados/busca e cargos/moderação — terão
specs próprias e não são tratadas aqui.

A visão geral (`docs/specs/00-visao-geral.md`, seção de fora de escopo) já
registrava "anexos em mensagem" como pendência conhecida. Esta spec é o
desenho dessa pendência.

## 1. O que muda para quem usa

Hoje uma mensagem é texto e nada mais. Depois desta fatia ela pode carregar
arquivos, ser respondida, ser reagida com emoji e mencionar pessoas — e o canal
passa a saber o que você ainda não leu.

O que **não** entra: notificação do sistema operacional, push com a aba
fechada, emoji personalizado do grupo e miniatura de vídeo gerada no servidor.
Cada uma dessas exclusões tem motivo registrado na seção 8.

## 2. Decisões que governam o resto

### 2.1 Todo byte de arquivo passa pela API

O MinIO fica fechado na rede interna do compose. Não tem rota no Caddy, não
tem porta publicada, não tem CORS. O navegador nunca fala com ele.

A alternativa — URL pré-assinada, upload direto do navegador ao storage —
escala melhor e foi descartada mesmo assim, por uma razão específica deste
sistema. A spec 03 gasta uma seção inteira garantindo que canal privado não
vaze: devolve 404 em vez de 403, filtra o `ready`, filtra o fan-out. Um anexo
servido por URL do MinIO joga isso fora, porque quem tiver o link lê o arquivo
sendo membro ou não. Com o tráfego pela API, `can(actor, 'channel.read', …)`
vale igual para o texto e para o arquivo, e não existe uma segunda regra de
autorização para manter em sincronia com a primeira.

O custo é real: os bytes atravessam o Node, o upload precisa ser em stream para
não estourar memória, e o limite por arquivo fica mais conservador do que
ficaria com upload direto. Para um grupo de dezenas de pessoas em 2 vCPUs, isso
não é gargalo.

### 2.2 O arquivo existe antes da mensagem

O upload acontece em dois passos: `POST /api/channels/:id/attachments` devolve
um `attachment.id`, e o `POST` da mensagem cita esses ids. É o que permite
barra de progresso, prévia antes de enviar e remoção de um anexo escolhido por
engano.

O preço é o arquivo órfão: alguém sobe e desiste. Resolvido pela rotina que já
existe — `api/src/cli/cleanup.ts` já faz esse tipo de faxina para sessões
expiradas, e ganha um segundo alvo: anexo sem `message_id` há mais de 24 horas.

A alternativa (um único POST multipart com texto e arquivos juntos) seria
atômica e não deixaria órfão, mas mataria o progresso de upload e pioraria o
eco otimista que a Fatia 1 já entregou.

### 2.3 Menções são resolvidas na escrita, não na leitura

O servidor extrai as menções no momento do POST e grava em `mentions`.

Duas razões, e as duas são de correção e não de desempenho. Primeira: `@fulano`
precisa ser resolvido contra os membros daquele grupo **naquele instante** — o
apelido muda depois, e uma menção que troca de dono quando alguém se renomeia é
um defeito difícil de explicar. Segunda: o contador de não-lidos precisa de um
índice, e não de uma varredura por semelhança de texto no histórico a cada
abertura de canal.

## 3. Modelo de dados

```
messages ──┬─< attachments
           ├─< reactions
           ├─< mentions
           └──  reply_to_id ──> messages

channels ──< channel_reads >── users
```

### `attachments`
| Coluna | Tipo | Notas |
|---|---|---|
| `id` | `uuid` PK | UUIDv7 |
| `channel_id` | `uuid` NOT NULL → `channels.id` ON DELETE CASCADE | âncora de autorização |
| `message_id` | `uuid` NULL → `messages.id` ON DELETE CASCADE | nulo até a mensagem existir |
| `uploader_id` | `uuid` NULL → `users.id` ON DELETE SET NULL | |
| `object_key` | `text` NOT NULL | chave no MinIO |
| `filename` | `text` NOT NULL | o nome original, só para exibir e baixar |
| `content_type` | `text` NOT NULL | detectado no servidor por magic bytes |
| `byte_size` | `integer` NOT NULL | |
| `width`, `height` | `integer` NULL | imagem e vídeo |
| `thumb_key` | `text` NULL | só imagem; ver 8.3 |
| `created_at` | `timestamptz` NOT NULL | ISO 8601 em UTC na API |

Índices: `(message_id)` e `(channel_id, created_at)` — o segundo serve à faxina
de órfãos e a uma futura listagem de mídia do canal.

`channel_id` parece derivável de `message_id` e não é: enquanto `message_id`
for nulo, ele é a **única** âncora de autorização que existe. Depois, ainda
poupa um JOIN em toda leitura de arquivo.

### `reactions`
| Coluna | Tipo | Notas |
|---|---|---|
| `message_id` | `uuid` → `messages.id` ON DELETE CASCADE | |
| `user_id` | `uuid` → `users.id` ON DELETE CASCADE | |
| `emoji` | `text` NOT NULL | o próprio caractere Unicode |
| `created_at` | `timestamptz` NOT NULL | |

PK composta `(message_id, user_id, emoji)`. É a regra "uma pessoa não reage
duas vezes com o mesmo emoji" garantida pelo banco, e não por uma consulta
antes da inserção, que perde a corrida com dois cliques rápidos.

`emoji` guarda o caractere, não um id de catálogo: assim uma atualização da
tabela de emoji não invalida reação de ninguém.

Sendo `text`, ele precisa de guarda no servidor: no máximo 8 bytes e apenas
sequências que o catálogo Unicode reconhece. Sem isso, a coluna aceitaria um
parágrafo inteiro fazendo-se passar por reação.

### `mentions`
| Coluna | Tipo | Notas |
|---|---|---|
| `message_id` | `uuid` → `messages.id` ON DELETE CASCADE | |
| `user_id` | `uuid` → `users.id` ON DELETE CASCADE | |

PK composta. Menção a todos do canal **não** cria uma linha por pessoa: é a
coluna `mentions_everyone boolean` em `messages`, porque um grupo de 200
pessoas geraria 200 linhas por mensagem sem nenhuma informação nova.

### `channel_reads`
| Coluna | Tipo | Notas |
|---|---|---|
| `channel_id` | `uuid` → `channels.id` ON DELETE CASCADE | |
| `user_id` | `uuid` → `users.id` ON DELETE CASCADE | |
| `last_read_message_id` | `uuid` NULL | UUIDv7 ordena por tempo |
| `updated_at` | `timestamptz` NOT NULL | |

PK composta `(channel_id, user_id)`. O não-lido é a contagem de mensagens com
`id` maior que `last_read_message_id`, que o índice
`messages_channel_id_desc_idx` já atende.

### Colunas novas em `messages`
| Coluna | Tipo | Notas |
|---|---|---|
| `reply_to_id` | `uuid` NULL → `messages.id` ON DELETE SET NULL | |
| `mentions_everyone` | `boolean` NOT NULL DEFAULT false | |

`SET NULL` e jamais `CASCADE`: apagar a mensagem citada não pode levar junto a
resposta a ela. A citação vira "mensagem apagada" e a conversa continua
legível.

## 4. Autorização

Ações novas em `api/src/permissions/can.ts`:

| Ação | Regra |
|---|---|
| `message.attach` | segue `channel.write` |
| `message.react` | segue `channel.write` |
| `attachment.read` | deriva de `channel.read` do canal do anexo |

`attachment.read` é conferida contra o **canal**, e não contra um recurso novo:
a rota carrega o `channel_id` do anexo e chama `can()` com
`{ kind: 'channel', visibility }`. `Resource` não ganha um quarto `kind`,
porque não existe decisão que dependa do anexo em si — só do canal onde ele
está.

Nenhum eixo novo: as três encaixam nos dois que a spec 03 já definiu —
administrar vem do papel, ler e escrever vêm do pertencimento. Remover anexo de
terceiro já está coberto por `message.delete_any`.

`can()` termina em `return false`, então as três ações nascem negadas até serem
escritas nas listas — e a matriz exaustiva de `can.test.ts` cresce junto.

## 5. O que impede o anexo de virar buraco de segurança

- **Tipo detectado por magic bytes no servidor.** Nem a extensão nem o
  `Content-Type` enviado pelo cliente decidem nada. O `content_type` gravado é
  o detectado, e é ele que volta no download.
- **SVG não é imagem, é documento executável.** Servido como `text/plain`,
  nunca renderizado inline. Um SVG exibido em `<img>` de origem própria executa
  script no contexto do site.
- `Content-Disposition: attachment` e `X-Content-Type-Options: nosniff` em tudo
  que não seja imagem, vídeo ou áudio de tipo reconhecido.
- **Limites:** 25 MB por arquivo, 10 arquivos por mensagem, 5 GB por grupo. A
  cota do grupo é verificada no início do upload, somando `byte_size` dos
  anexos dos canais dele; estourá-la devolve 413 com o quanto resta. A VM tem
  81 GB livres, então a cota existe para que um grupo não consuma o disco dos
  outros, e não por escassez.
- O limite de taxa de mensagens que já existe cobre o abuso de volume; o
  upload entra no mesmo balde.
- O nome original **nunca** vira caminho no disco. `object_key` é derivado do
  `id`, e `filename` é só um rótulo para exibir e baixar.

## 6. Tempo real

Eventos novos no gateway, passando pelo fan-out que já respeita canal privado
(`api/src/realtime/fanout.ts`):

| Evento | Quando | Carga |
|---|---|---|
| `reaction.added` | alguém reage | `messageId`, `userId`, `emoji` |
| `reaction.removed` | alguém desfaz | idem |

Anexos e respostas **não** ganham evento próprio: chegam dentro do
`message.created` que já existe, porque fazem parte da mensagem. Menções também
não: quem recebeu a mensagem já tem o que precisa para saber que foi
mencionado.

O não-lido é derivado no cliente a partir do `last_read_message_id` que vem no
`ready`, e a marcação de leitura sobe por `PUT /api/channels/:id/read`, com corpo
`{ lastReadMessageId }`. Não passa pelo WebSocket: é estado da pessoa, não do
canal, e não interessa a mais ninguém.

## 7. Interface

- **Composer:** botão de anexo, arrastar e soltar, colar imagem com Ctrl+V,
  barra de progresso por arquivo, prévia com remoção antes de enviar.
- **Lista:** galeria de imagens, `<video>` e `<audio>` inline, cartão de
  download para o resto, linha de citação clicável que rola até a mensagem
  original, barra de reações com contagem e destaque para as suas.
- **Emoji:** catálogo Unicode completo com busca por nome em português,
  carregado sob demanda — o mesmo padrão do `import()` memorizado que
  `web/src/lib/midia.ts` usa para o SDK do LiveKit, e pelo mesmo motivo: quem
  não abre o seletor não paga por ele.
- **Menção:** autocompletar ao digitar `@`, resolvido contra os membros do
  grupo.
- **Não-lidos:** separador "novas mensagens" na lista, contador no canal e no
  grupo, contagem no título da aba.

O projeto roda varredura axe nos testes de tela. O seletor de emoji e a galeria
entram com navegação por teclado, foco visível e rótulo desde o começo — não
como remendo depois de a varredura acusar.

## 8. O que ficou de fora, e por quê

1. **Notificação do sistema e push com a aba fechada.** Web Push exige service
   worker, chaves VAPID, assinatura por dispositivo e um caminho de entrega
   próprio. É uma fatia inteira, não um detalhe desta.
2. **Emoji personalizado do grupo.** Depende dos anexos estarem de pé e
   acrescenta uma tela de administração. Cabe melhor depois, junto de cargos.
3. **Miniatura de vídeo no servidor.** Exigiria ffmpeg na imagem Docker da API,
   que cresceria centenas de megabytes para gerar um quadro. O
   `<video preload="metadata">` faz o navegador mostrar o primeiro quadro
   sozinho.
4. **Antivírus no upload.** Um grupo fechado por convite não tem o modelo de
   ameaça que justifica um antivírus residente. `Content-Disposition:
   attachment` e a detecção de tipo cobrem o que é possível cobrir sem isso.

## 9. Fatiamento

Três entregas independentes, cada uma implantável sozinha e com valor próprio:

**3a — Anexos.** MinIO no compose, tabela `attachments`, rotas de upload e
download, detecção de tipo, miniatura de imagem, faxina de órfãos, composer e
galeria. É a maior das três e a única que mexe em infraestrutura.

**3b — Reações e respostas.** Tabela `reactions`, coluna `reply_to_id`, os dois
eventos de tempo real, seletor de emoji, barra de reações e citação clicável.
Nenhuma infraestrutura nova.

**3c — Menções e não-lidos.** Tabelas `mentions` e `channel_reads`, coluna
`mentions_everyone`, extração no POST, autocompletar de `@`, separador de novas
mensagens e contadores.

## 10. Testes

Segue o que o projeto já faz, sem regime novo.

**API** (vitest + testcontainers, limiares de cobertura obrigatórios no CI):
matriz de `can()` estendida para as três ações novas; upload recusando tipo
mentiroso, arquivo acima do limite e canal alheio; download de canal privado
devolvendo 404 para quem está fora — nunca 403; reação duplicada barrada pela
PK; resposta sobrevivendo ao apagamento da citada; menção resolvida contra o
grupo certo; faxina removendo órfão e preservando anexo com mensagem.

**Frontend** (vitest + testing-library + axe): composer aceitando colagem e
arrasto; progresso e remoção antes do envio; galeria e cartão de download;
seletor de emoji navegável por teclado; separador de não-lidos aparecendo no
ponto certo.

**Ponta a ponta** (playwright): subir arquivo, ver na conversa da outra pessoa,
reagir, responder e mencionar num fluxo só.
