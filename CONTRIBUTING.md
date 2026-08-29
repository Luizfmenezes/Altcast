# Contribuindo com o Altcast

## As cinco regras invioláveis

Estas não são preferências de estilo. Cada uma existe porque a alternativa já
custou caro em algum sistema parecido, e todas são verificadas mecanicamente —
não por revisão atenta, que cansa.

### 1. Nenhuma comparação de papel fora de `api/src/permissions/can.ts`

```ts
if (membro.role === 'admin') { ... }   // proibido em qualquer outro arquivo
```

Uma regra de lint quebra o build. Verificação de papel espalhada pelo código é
exatamente como, seis meses depois, um endpoint novo esquece a checagem — e
ninguém percebe até alguém ler o que não devia.

Autorização se pergunta assim, sempre:

```ts
assertCan(actor, 'channel.read', { kind: 'channel', visibility: canal.visibility })
```

No frontend, comparar papel é decisão de **apresentação** — esconder um caminho
sem saída. Nunca de autorização: quem forçar a rota recebe `404` do servidor.

### 2. Nenhum cálculo de audiência fora de `api/src/realtime/fanout.ts`

Nenhuma rota monta a própria lista de destinatários. Toda emissão passa por
`emit.toChannel`, `emit.toGroup` ou `emit.toPeersOf`, e a audiência vem de
`fanout.ts`.

É o que mantém o risco de vazamento concentrado num arquivo de sessenta linhas,
com cobertura exigida em 100%, em vez de espalhado por dez rotas onde a décima
esquece uma condição.

### 3. Nada entra em `can.ts` ou `fanout.ts` sem `private-channel-leak.test.ts` verde

Os onze casos da spec 06 § 5 cobrem todos os caminhos por onde um canal privado
poderia vazar: `ready`, listagem, leitura, mensagens, fan-out, adição, remoção,
a corrida entre remover e enviar, a saída do grupo e o administrador sem acesso.

```bash
npm --workspace api run test -- private-channel-leak
```

### 4. Recurso invisível responde `404`, jamais `403`

Um `403` num canal privado **confirma que o canal existe**. Privado é invisível,
não trancado — inclusive quanto à existência. `assertCan` já lança `not_found`
por padrão; se você se pegar escrevendo `forbidden`, pare e releia a spec 03 § 9.

### 5. Teste primeiro, sempre

Escreva o teste, veja-o falhar pelo motivo certo, e só então implemente. Um
teste que nunca foi visto vermelho não prova nada — ele pode estar passando por
acidente, e você não tem como saber.

## Rodando

```bash
npm ci
npm run dev                  # Postgres + API com recarga, em Docker
npm test                     # unidade e integração, nos dois workspaces
npm run test:smoke           # sobe o stack de produção e verifica o essencial
npm run test:e2e             # seis fluxos + varredura axe, contra o stack real
```

Os testes de integração sobem um Postgres efêmero por Testcontainers — o alvo
nunca é um banco persistente. Docker precisa estar rodando.

O hook de pré-commit roda lint, typecheck e testes. Ele é instalado pelo
`npm ci` (script `prepare`); para instalar à mão:

```bash
git config core.hooksPath .githooks
```

## Limiares de cobertura

O build quebra abaixo destes valores. Eles não são metas — são pisos:

| Alvo | Piso | Por quê |
|---|---|---|
| `permissions/can.ts` | 100% | Decide quem pode o quê |
| `realtime/fanout.ts` | 100% | Decide quem recebe o quê |
| `auth/**` | 95% | Um caminho descoberto é uma porta destrancada |
| `routes/**` | 85% (78% em ramos) | Muitos ramos são guardas defensivas inalcançáveis |

## Convenções que valem a pena conhecer

- **Identificadores são UUIDv7**, gerados na aplicação. Ordenar por `id` é
  ordenar por tempo, e é isso que sustenta a paginação por cursor sem `OFFSET`.
- **O ID da mensagem vem do cliente.** É o que permite o eco otimista se
  reconhecer no evento que volta pelo socket — a reconciliação é por ID, nunca
  por conteúdo, porque duas mensagens iguais são duas falas de verdade.
- **O WebSocket tem permissão para perder eventos.** Não existe replay, número
  de sequência nem confirmação de recebimento. Ao reconectar, o cliente busca
  por REST o que veio depois da última mensagem que conhece. A verdade mora
  sempre no REST.
- **Eventos são emitidos depois do commit**, nunca dentro da transação: anunciar
  de dentro dela seria contar um fato que um rollback ainda pode desfazer.
- **Nenhum componente escreve cor literal.** As cores vivem em
  `web/src/ui/tokens.ts`, e o teste de contraste as lê de lá — é por isso que o
  que é testado é exatamente o que é servido.
- Comentários explicam **por que**, não o quê. Se o código já diz o que faz, o
  comentário que repete isso só envelhece e mente.

## O que a Fatia 1 deliberadamente não tem

Áudio, vídeo, upload de arquivo, busca, threads, reações, notificação por push,
federação. O prefixo `voice.` está reservado no protocolo e a coluna
`channels.type` já aceita `'voice'`, mas a API **recusa** criar canal de voz —
uma funcionalidade visível e quebrada é pior do que uma ausente.
