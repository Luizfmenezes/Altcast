# Altcast

Plataforma de comunicação em grupo da **Anticorp**: grupos privados por convite,
canais de texto e — a partir da Fatia 2 — chamadas de voz, vídeo e
compartilhamento de tela multiponto.

O modelo mental é o do Discord/Teams, com escopo deliberadamente menor e
arquitetura mais leve: um círculo fechado de pessoas conhecidas, até cerca de
10 participantes ativos por chamada.

## Estado atual

**Fase de planejamento.** Nenhum código foi escrito. Toda a especificação vive
em [`docs/specs/`](docs/specs/) e o plano de execução em
[`docs/superpowers/plans/2026-08-28-altcast-fatia-1-fundacao.md`](docs/superpowers/plans/2026-08-28-altcast-fatia-1-fundacao.md).

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
