# Altcast

Plataforma de comunicação em grupo da **Anticorp**: grupos privados por convite,
canais de texto e — a partir da Fatia 2 — chamadas de voz, vídeo e
compartilhamento de tela multiponto.

O modelo mental é o do Discord/Teams, com escopo deliberadamente menor e
arquitetura mais leve: um círculo fechado de pessoas conhecidas, até cerca de
10 participantes ativos por chamada.

## Estado atual

**Fatia 2 em andamento: a transmissao esta de pe.** Canal de voz emite token
assinado pela API, o SFU (LiveKit) valida a assinatura, e a interface entra na
chamada com microfone, camera e compartilhamento de tela. A audiencia continua
decidida por `fanout.ts`: quem nao ve o canal nao entra na sala, nao aparece na
lista e nao recebe evento. O SDK do SFU e carregado sob demanda, entao quem so
usa texto nao paga por ele.

Para subir a midia e preciso preencher `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` e
`LIVEKIT_URL` no `.env`. Sem as tres, a API sobe inteira e so a chamada responde
`503 media_unavailable` — texto continua funcionando.

**Fatia 1 implementada e verificada.** Contas, grupos, convites, canais de texto
públicos e privados, chat em tempo real e presença estão de pé, com a bateria
inteira verde: 316 testes de unidade e integração, os seis fluxos de ponta a
ponta, quatro varreduras `axe-core` sem violação, fumaça contra as imagens de
produção e ensaio de restauração de backup. `can.ts` e `fanout.ts` têm
cobertura de 100%.

Falta para dar a fatia por encerrada o que nenhum teste alcança: um deploy num
host com DNS apontado (para o Caddy emitir o certificado), a conferência de
teclado feita por uma pessoa, e duas pessoas conversando pela ferramenta em
redes diferentes.

A especificação vive em [`docs/specs/`](docs/specs/), o plano de execução com o
registro de fechamento em
[`docs/superpowers/plans/2026-08-28-altcast-fatia-1-fundacao.md`](docs/superpowers/plans/2026-08-28-altcast-fatia-1-fundacao.md),
e a operação do dia a dia em [`docs/RUNBOOK.md`](docs/RUNBOOK.md).

## Documentação

| Documento | Assunto |
|---|---|
| [00 — Visão geral](docs/specs/00-visao-geral.md) | Produto, escopo, fatias, glossário |
| [01 — Arquitetura](docs/specs/01-arquitetura.md) | Containers, limites, REST vs WebSocket |
| [02 — Modelo de dados](docs/specs/02-modelo-de-dados.md) | Tabelas, chaves, índices, migrações |
| [03 — Autenticação](docs/specs/03-auth-convites-permissoes.md) | Contas, convites, papéis, canais privados |
| [04 — Tempo real](docs/specs/04-protocolo-tempo-real.md) | WebSocket, eventos, presença, reconexão |
| [05 — Interface](docs/specs/05-interface.md) | Direção visual, layout, acessibilidade |
| [06 — Erros e testes](docs/specs/06-erros-e-testes.md) | Contrato de erro, estratégia de testes |
| [07 — Infraestrutura](docs/specs/07-infraestrutura.md) | Docker, variáveis, deploy, operação |

## Princípios do projeto

1. **A verdade mora no REST.** O WebSocket é um acelerador que tem permissão
   para falhar; a reconexão cura qualquer buraco buscando o estado real.
2. **Uma função decide toda permissão.** Nenhuma checagem de papel espalhada
   pelo código.
3. **Privado significa invisível**, não trancado. Canal privado não aparece
   para quem não participa.
4. **Só a conta toca o disco por padrão.** Estado de conexão e presença são
   memória, não dado.
5. **Acessibilidade é requisito, não revisão final.** WCAG 2.2 AA.
