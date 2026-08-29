# 06 — Erros e testes

## 1. Contrato de erro

Formato único em toda a API:

```
{
  "error": {
    "code": "invite_expired",
    "message": "Este convite expirou.",
    "requestId": "01J8ZQK3M7V2XN4P",
    "details": null
  }
}
```

- **`code`** é estável e legível por máquina. **O cliente decide comportamento
  pelo `code`, nunca pelo texto.** Mudar a mensagem nunca quebra o cliente
- **`message`** é para humano, em português, sem jargão técnico
- **`requestId`** aparece na tela em falha inesperada e casa com a linha do log.
  Quando alguém disser "deu erro", você localiza em segundos em vez de adivinhar
- **`details`** carrega erros de validação campo a campo, quando houver

### Catálogo de códigos

| Código | HTTP | Significa |
|---|---|---|
| `unauthenticated` | 401 | Sem sessão válida |
| `forbidden` | 403 | Autenticado, sem permissão |
| `not_found` | 404 | Recurso inexistente ou invisível para você |
| `validation_failed` | 422 | Campos inválidos, ver `details` |
| `invite_not_found` | 404 | Código inexistente |
| `invite_expired` | 410 | Passou de `expires_at` |
| `invite_revoked` | 410 | Foi revogado |
| `invite_exhausted` | 410 | Atingiu `max_uses` |
| `already_member` | 409 | Já pertence ao grupo |
| `email_taken` | 409 | E-mail já cadastrado |
| `invalid_credentials` | 401 | Login incorreto, mensagem uniforme |
| `rate_limited` | 429 | Excedeu o limite, com `Retry-After` |
| `owner_cannot_leave` | 409 | Transfira a titularidade antes |
| `internal_error` | 500 | Falha inesperada, só `requestId` |

### Regra de invisibilidade

Recurso que o usuário não pode ver retorna **`404 not_found`**, nunca
`403 forbidden`. Um `403` num canal privado confirma que o canal existe — e a
seção 9 de [03](03-auth-convites-permissoes.md) estabelece que privado é
invisível, não trancado.

## 2. Tratamento no cliente

Três classes, tratadas de formas diferentes:

| Classe | Comportamento |
|---|---|
| **Validação** (422) | Mensagem inline no campo, com sugestão de correção. Foco vai para o primeiro campo inválido |
| **Autenticação** (401) | Redireciona ao login preservando o destino pretendido |
| **Rede / 5xx** | Repetição automática com aviso discreto. **Nunca modal de pânico** |

Envio de mensagem é **otimista**: aparece na hora, esmaecida, com o ID já gerado
no cliente. Confirma, ou vira "falhou — tentar de novo" com botão. **Nunca some
em silêncio.**

## 3. Logs

- Estruturados em JSON, via `pino`
- Todo log de requisição carrega `requestId`, `userId` (quando houver), método,
  rota, status e duração
- **Nunca registrar**: senha, hash de senha, valor de cookie de sessão, conteúdo
  de mensagem, código de convite completo (só os 3 primeiros caracteres)
- Erro inesperado registra a pilha completa no servidor e devolve apenas o
  `requestId` ao cliente. **Nenhum detalhe interno vaza na resposta**

## 4. Estratégia de testes

Desenvolvimento guiado por testes: **o teste vem antes da implementação, sempre.**

| Camada | O que cobre | Ferramenta |
|---|---|---|
| Unidade | `can()` em matriz exaustiva; geração e normalização de código de convite; backoff; fan-out | Vitest |
| Integração | Rotas HTTP contra **Postgres real** em container | Vitest + Testcontainers |
| Tempo real | Conexão, heartbeat, entrega de evento, reconexão, audiência | Vitest + cliente WS |
| Ponta a ponta | Fluxos completos entre dois navegadores | Playwright |
| Acessibilidade | `axe-core` nas telas principais + passagem manual só de teclado | Playwright + axe |

### Por que Postgres real e não mock

Docker já é exigência do projeto. Usar banco de verdade nos testes custa poucos
segundos e captura justamente a classe de erro que mock esconde: violação de
constraint, comportamento de cascade, isolamento de transação, índice único
parcial do `owner`. Mock de banco testa o mock.

## 5. O teste inegociável

> **Um usuário que não pertence a um canal privado nunca recebe seu conteúdo —
> nem por REST, nem por evento de WebSocket, nem no `ready`, nem ao ser
> removido, nem em condição de corrida durante a remoção.**

Este é o único ponto do sistema onde um defeito não causa incômodo, causa
**vazamento**. Ele ganha arquivo de teste próprio (`private-channel-leak.test.ts`)
cobrindo todos os caminhos:

| Caso | Verifica |
|---|---|
| `ready` de não-membro | O canal privado não aparece, nem com ID |
| `GET /channels` | Lista filtrada não contém o canal |
| `GET /channels/:id` | Retorna `404`, não `403` |
| `GET /channels/:id/messages` | Retorna `404` |
| `POST` de mensagem por não-membro | Retorna `404` |
| Fan-out de `message.created` | Socket de não-membro não recebe nada |
| Adição ao canal | Só o adicionado recebe `channel.created` |
| Remoção do canal | Só o removido recebe `channel.deleted` |
| Mensagem durante remoção | Corrida: enviada após a remoção não alcança o removido |
| Saída do grupo | Remove de todos os canais privados, em cascata |
| `admin` sem acesso | Pode apagar o canal, não pode ler |

**Nenhuma alteração em `fanout.ts` ou `can.ts` entra sem passar por este
arquivo.**

## 6. Matriz de permissões

`can()` é testado por matriz exaustiva, gerada programaticamente:

```
para cada papel em [owner, admin, member, nao-membro]
  para cada acao em [as 17 acoes da Fatia 1]
    para cada recurso em [grupo, canal publico, canal privado com acesso,
                          canal privado sem acesso, mensagem propria,
                          mensagem de terceiro]
      assertar o resultado esperado
```

São centenas de asserções derivadas de uma tabela explícita no próprio teste.
A tabela é a especificação executável da seção 8 e 9 de
[03](03-auth-convites-permissoes.md); divergência entre elas é falha de build.

Complementa uma regra de lint: **comparação direta de papel fora de `can.ts`
quebra o build.**

## 7. Fluxos ponta a ponta

| Fluxo | Passos |
|---|---|
| Convite completo | Owner gera código, segundo navegador abre a prévia, cria conta, entra, aparece na lista de membros do primeiro |
| Mensagem em tempo real | Dois navegadores no mesmo canal; um envia, o outro recebe sem recarregar |
| Canal privado | Terceiro navegador não vê o canal; é adicionado e ele aparece na hora; é removido e some na hora |
| Reconexão | Derrubar o WebSocket, enviar mensagem por outro cliente, reconectar e confirmar que a mensagem perdida aparece |
| Sessão revogada | Encerrar sessão em um dispositivo e confirmar bloqueio imediato no outro |
| Só teclado | Percorrer login, troca de canal, envio de mensagem e abertura de modal sem tocar no mouse |

## 8. Metas de cobertura

| Área | Meta | Natureza |
|---|---|---|
| `permissions/can.ts` | **100%** | Obrigatória, quebra o build |
| `realtime/fanout.ts` | **100%** | Obrigatória, quebra o build |
| `auth/` | 95% | Obrigatória |
| Rotas | 85% | Obrigatória |
| Frontend | 70% | Indicativa |
| Global | 80% | Indicativa |

Cobertura é piso, não objetivo. Cem por cento em `can.ts` significa que toda
linha foi exercitada — a garantia real vem da matriz da seção 6, não do número.

## 9. Integração contínua

Ordem de execução, falhando rápido:

1. `lint` e `typecheck`
2. Testes de unidade
3. Testes de integração com Postgres em container
4. Build da API e do frontend
5. Ponta a ponta com o stack completo em Docker Compose
6. `axe-core` nas telas principais
7. Auditoria de dependências

Nenhum merge com etapa vermelha. As etapas 1 a 3 também rodam em hook de
pre-commit, localmente.
