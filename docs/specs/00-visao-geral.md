# 00 — Visão geral

> Documento raiz da especificação do Altcast. Data: 2026-08-28.
> Status: **aprovado em brainstorming, aguardando revisão final.**

## 1. O que é

Altcast é uma plataforma web de comunicação em grupo para a Anticorp. Uma pessoa
cria um grupo, gera um código de convite, compartilha por fora (WhatsApp, Teams,
e-mail), e quem entra passa a conversar em canais de texto e — na Fatia 2 —
participar de chamadas com áudio, vídeo e compartilhamento de tela, em que
**qualquer participante pode transmitir**.

## 2. Para quem

Círculo fechado: equipe, parceiros e clientes da Anticorp. Não há cadastro
aberto ao público. Isso é uma decisão de arquitetura, não uma configuração —
ela elimina moderação, verificação antifraude e defesa contra abuso do escopo.

## 3. Escala alvo

| Dimensão | Alvo | Limite duro |
|---|---|---|
| Participantes ativos por chamada | 10 | 12 |
| Membros por grupo | ~50 | sem limite técnico |
| Grupos simultâneos | dezenas | limitado por CPU do VPS |
| Chamadas simultâneas | 2 a 3 | limitado por banda do VPS |

## 4. Decisões de arquitetura já travadas

| # | Decisão | Motivo |
|---|---|---|
| D1 | **SFU via LiveKit self-hosted**, não mesh P2P | Com todos transmitindo, mesh exige N−1 uploads e encodes por máquina; morre entre 4 e 6 pessoas |
| D2 | **Postgres** como única fonte de verdade durável | Grupos e histórico agora são persistentes |
| D3 | **Escrita por REST, WebSocket só empurra eventos** | Evita uma segunda API não documentada sobre o WS |
| D4 | **Sessão em banco com cookie httpOnly**, não JWT de aplicação | JWT não é revogável; sessão é |
| D5 | **JWT apenas para o LiveKit**, efêmero (5 min) | É o contrato do LiveKit e o escopo é mínimo |
| D6 | **Tudo em Docker Compose** | Exigência do cliente; também padroniza dev e produção |
| D7 | **Canal privado por lista explícita de membros** | Simples de entender, testar e auditar |
| D8 | **UUIDv7 como identificador** | Ordenável no tempo; paginação por índice, sem OFFSET |

### Consequência aceita de D1

Num SFU o vídeo é descriptografado no servidor. A propriedade "o vídeo nunca
toca o servidor", que o modelo mesh oferecia, **deixa de existir**. Foi um preço
aceito conscientemente em troca do comportamento multi-transmissor do Teams.

## 5. Fatias de entrega

O sistema é grande demais para uma especificação e um plano únicos. Ele é
construído em fatias, cada uma com valor de uso próprio.

### Fatia 1 — Fundação (escopo destas specs)

Contas, grupos, convites, canais de texto (públicos e privados), chat em tempo
real, presença. **Sem áudio, sem vídeo, sem tela.** Ao final, o sistema já é
utilizável como ferramenta de conversa da equipe.

### Fatia 2 — Mídia

Integração com LiveKit: canais de voz, entrada e saída de chamada, áudio,
vídeo, compartilhamento de tela por qualquer participante, painel de qualidade
configurável ao vivo, estatísticas por participante.

### Fatia 3 — Refinamento

Customização visual de grupo, upload de avatar e ícone, anexos em mensagem,
menções e notificações, busca no histórico, respostas encadeadas.

### Fora de escopo (todas as fatias)

Federação entre servidores, aplicativos móveis nativos, gravação de chamadas,
chamadas de voz para telefonia, integrações com terceiros, criptografia
ponta a ponta.

## 6. Glossário

| Termo | Significa |
|---|---|
| **Grupo** | Equivalente ao "servidor" do Discord. Contém canais e membros |
| **Canal** | Espaço de conversa dentro de um grupo. Tipo `text` ou `voice` |
| **Canal privado** | Canal cujo acesso vem de uma lista explícita, não do grupo |
| **Convite** | Código de 8 caracteres que concede entrada em um grupo |
| **Membro** | Usuário pertencente a um grupo, com um papel |
| **Papel** | `owner`, `admin` ou `member` |
| **Sessão** | Linha em banco representando um login ativo, revogável |
| **Fan-out** | Ato de calcular a audiência de um evento e entregá-lo |
| **SFU** | Selective Forwarding Unit: servidor que recebe 1 stream e replica |

## 7. Índice das especificações

1. [Arquitetura](01-arquitetura.md)
2. [Modelo de dados](02-modelo-de-dados.md)
3. [Autenticação, convites e permissões](03-auth-convites-permissoes.md)
4. [Protocolo de tempo real](04-protocolo-tempo-real.md)
5. [Interface](05-interface.md)
6. [Erros e testes](06-erros-e-testes.md)
7. [Infraestrutura](07-infraestrutura.md)
