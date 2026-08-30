# 03 — Autenticação, convites e permissões

## 1. Cadastro é fechado por construção

**Não existe cadastro avulso.** A criação de conta exige um código de convite
válido. Sem código, a rota de registro recusa.

Isso remove do escopo, de uma vez: verificação de e-mail contra robôs,
moderação, fila de aprovação, defesa contra cadastro em massa. A porta de
entrada já é a lista de convidados.

**Bootstrap:** a primeira conta nasce por comando de CLI dentro do container
(`npm run seed:owner`), uma única vez, criando o usuário inicial e seu primeiro
grupo. O comando é idempotente e recusa rodar se já houver usuários.

## 2. Fluxo de entrada

```
owner/admin gera código  ──▶  K7M2P9XQ  ──▶  compartilhado por fora
                                                      │
                                                      ▼
                              GET /entrar/K7M2P9XQ (página pública)
                                                      │
                    mostra: nome do grupo, ícone, contagem de membros
                            e NADA além disso
                                                      │
                          ┌───────────────────────────┴──────────┐
                          ▼                                      ▼
                    já tem conta                            não tem conta
                    faz login                               cria conta
                          └───────────────────────────┬──────────┘
                                                      ▼
                                POST /api/invites/K7M2P9XQ/accept
                                                      │
                             transação: valida ▸ incrementa uses ▸
                             cria group_members ▸ emite member.joined
                                                      ▼
                                 redireciona ao primeiro canal visível
```

### Prévia pública do convite

`GET /api/invites/:code` é a única rota não autenticada que devolve dados de um
grupo. Devolve exatamente: `groupName`, `groupIconUrl`, `memberCount`,
`valid: boolean`, e — se inválido — o motivo (`expired`, `revoked`,
`max_uses_reached`, `not_found`).

**Nunca devolve** lista de membros, nomes de canais, mensagens ou o ID interno do
grupo. Um código vazado revela onde a pessoa entraria, e nada mais.

## 3. Códigos de convite

- 8 caracteres, alfabeto **base32 de Crockford**: `0123456789ABCDEFGHJKMNPQRSTVWXYZ`
- Excluídos `I`, `L`, `O`, `U` — ambiguidade ao ditar e ao ler
- Gerados com `crypto.randomBytes`, nunca `Math.random`
- Normalizados na leitura: maiúsculas, com `I` e `L` virando `1`, e `O` virando `0`
- Espaço de 32^8, aproximadamente 1,1 trilhão de combinações
- Colisão tratada por nova tentativa ao violar a constraint de chave primária

Atributos por convite: expiração opcional, número máximo de usos opcional,
revogação a qualquer momento. Revogar não afeta quem já entrou.

## 4. Sessões

| Aspecto | Decisão |
|---|---|
| Transporte | Cookie `altcast_session` |
| Flags | `httpOnly`, `Secure`, `SameSite=Lax`, `Path=/` |
| Conteúdo | UUIDv7 opaco — nenhum dado embutido |
| Duração | 30 dias, renovação deslizante a cada uso |
| Revogação | Apagar a linha em `sessions`. Efeito imediato |
| Logout global | Apagar todas as linhas do `user_id` |

### Por que sessão em banco e não JWT

JWT não pode ser invalidado antes de expirar. Se um token vazar, ou se você
remover alguém do grupo, ele continua válido até o vencimento. Com sessão em
banco, o `DELETE` encerra o acesso naquele instante.

JWT aparece no projeto, mas no lugar certo: token de 5 minutos para o LiveKit na
Fatia 2, onde o escopo é estreito e a expiração curta torna a revogação
desnecessária.

## 5. Senhas

- **argon2id**, parâmetros OWASP: 19 MiB de memória, 2 iterações, paralelismo 1
- Mínimo de 10 caracteres; sem exigência de símbolos — regras de composição
  reduzem entropia na prática, empurrando todo mundo para variações de `Senha@123`
- Verificação contra lista das 10 000 senhas mais vazadas, local, sem chamada externa
- **Resposta uniforme:** se o e-mail não existe, o servidor executa uma
  verificação de hash falsa antes de responder. Sem isso, a diferença de tempo
  entre "e-mail inexistente" e "senha errada" entrega quem tem conta
- Mensagem única para ambos os casos: "E-mail ou senha incorretos."

## 6. Rate limiting

| Rota | Limite |
|---|---|
| `POST /api/auth/login` | 5 por minuto por IP; 10 por hora por e-mail |
| `POST /api/auth/register` | sem teto proprio; so o geral |
| `GET /api/invites/:code` | 20 por minuto por IP |
| `POST /api/invites/:code/accept` | 5 por hora por IP |
| `POST /api/channels/:id/messages` | 30 por minuto por usuário |
| Demais rotas | 300 por minuto por usuário |

Implementado com `@fastify/rate-limit`, contadores em memória na Fatia 1.

O cadastro tinha teto de 3 por hora por IP e perdeu esse teto. A premissa —
que ninguém cria três contas por hora de boa-fé — não sobreviveu ao uso real:
um escritório, uma faculdade ou uma casa inteira sai por um IP só, e a quarta
pessoa a aceitar o mesmo convite batia em 429 sem ter o que fazer pela hora
seguinte. O vetor que o limite fechava — cadastro em massa — já está fechado
pelo convite obrigatório da seção 1, e a varredura de códigos continua limitada
na prévia pública (20 por minuto por IP).

## 7. CSRF

Cobertura em duas camadas, sem token dedicado:

1. `SameSite=Lax` impede o envio do cookie em requisição cross-site de escrita
2. Verificação do cabeçalho `Origin` em todo `POST`, `PATCH` e `DELETE`, contra
   lista de origens permitidas

## 8. Papéis

| Papel | Pode |
|---|---|
| `owner` | Tudo. Um por grupo. Transferível. Não removível |
| `admin` | Criar, renomear e apagar canais; gerar e revogar convites; remover membros; apagar mensagem de terceiro |
| `member` | Ler e escrever nos canais a que tem acesso; editar e apagar as próprias mensagens |

## 9. Canais privados

### O eixo duplo de permissão

A decisão central: **ler e administrar são permissões independentes.**

| Permissão | Origem | Quem tem num canal privado |
|---|---|---|
| `channel.read` e `channel.write` | Pertencimento ao canal | Só quem está em `channel_members` |
| `channel.manage` | Papel no grupo | `owner` e `admin`, **mesmo sem acesso de leitura** |

Um admin pode **apagar** um canal privado abandonado, mas não pode **abri-lo**.
Isso resolve o problema do canal órfão sem criar uma porta dos fundos. Se o
`admin` enxergasse tudo por ser admin, a palavra "privado" perderia o sentido.

### Invisível, não trancado

Canal privado do qual você não participa **não aparece** na sua barra lateral.
Sem cadeado, sem aviso de acesso negado. Ele simplesmente não está no seu `ready`.

Cadeado visível vaza informação — o nome já conta a história
(`#demissoes-q4`, `#negociacao-cliente-x`). Se é privado, é privado inclusive
quanto à existência.

**Única exceção:** na tela de configurações do grupo, `owner` e `admin` veem os
nomes listados, porque precisam administrar. É um contexto explícito de gestão,
com rótulo claro de que o conteúdo permanece inacessível.

### Regras de composição

- Membros do canal são escolhidos **entre quem já pertence ao grupo**
- Convite é sempre de grupo, nunca de canal
- Quem cria o canal privado é adicionado automaticamente
- Sair do grupo remove a pessoa de todos os canais privados dele, em cascata
- Canal público não usa `channel_members` — o acesso vem do grupo

## 10. A função `can()`

**Toda** decisão de autorização passa por uma única função:

```
can(actor, action, resource) -> boolean
```

Ações da Fatia 1:

```
group.view          group.update        group.delete
group.invite        group.kick          group.change_role
channel.create      channel.update      channel.delete
channel.read        channel.write       channel.manage_members
message.create      message.edit_own    message.delete_own
message.delete_any
```

Reservadas para a Fatia 2, já declaradas e retornando sempre `false` por ora:

```
channel.join_call   channel.publish     channel.moderate_call
```

### A regra inegociável

**Não existirá comparação direta de papel fora de `can.ts`.** Verificação
espalhada pelo código é exatamente como, seis meses depois, um endpoint novo
esquece a checagem. Um lugar só, testado por matriz exaustiva de papel por ação
por recurso, e uma regra de lint que quebra o build se o padrão aparecer em
qualquer outro arquivo.
