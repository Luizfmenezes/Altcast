# Super plano — Altcast profissional (Tree of Thoughts)

> Data: 2026-09-26 · Base: commit `8cd4118` · Status: **plano aprovado em direção,
> nenhuma etapa implementada.**
> Complementa `2026-09-26-roadmap-profissional.md` (o inventário) e absorve as
> propostas de 2026-09-10 (loop de atenção, mensagens diretas, cargos, qualidade
> de transmissão).

**Como este documento foi feito**

1. **Inventário do backend e do protocolo**, lendo o código e citando `arquivo:linha`.
2. **Auditoria da jornada no frontend**, também lendo o código.
3. **Crítica `/impeccable critique`** em dois agentes isolados, com o app rodando
   localmente (desktop 1440 e mobile 390, temas claro e escuro, contas de dono e de membro):
   - **A:** revisão de design, com heurísticas de Nielsen, personas e carga cognitiva;
   - **B:** detector determinístico, overlay no navegador, Lighthouse, axe e medições de DOM.
4. **Documentação ao vivo do TypeSafe** (`/v1/systemone`, `jev-latest`) para a camada de IA.
5. **Tree of Thoughts:** para cada decisão que muda o rumo, três ramos, uma
   avaliação cruzada e um caminho escolhido. As decisões pequenas estão tomadas
   no texto, sem cerimônia.

---

## Sumário

- **Parte I · Diagnóstico**
  - 1. Crítica de design (Impeccable)
  - 2. Bugs confirmados no código
- **Parte II · Pensamento em árvore**
  - 3. ToT estratégico: por onde o produto evolui
  - 4. ToT das decisões críticas (D1–D12)
- **Parte III · Execução**
  - 5. Visão geral das etapas
  - 6. Etapas 0 a 9, completas
  - 7. Camada de IA com TypeSafe (Jev)
  - 8. Design System v2
- **Parte IV · Controle**
  - 9. Qualidade, métricas e definição de pronto
  - 10. Riscos, dependências e decisões em aberto

---

# PARTE I — DIAGNÓSTICO

## 1. Crítica de design (Impeccable)

`Method: dual-agent (A: revisão de design · B: detector + navegador)`

### 1.1 Design Health Score

| # | Heurística | Nota | Problema-chave |
|---|---|---|---|
| 1 | Visibilidade do status | 2 | A voz se contradiz: a barra lateral diz "Na chamada" e o painel diz "Fora da chamada". Grupo novo mostra "0 online" sem o próprio dono. Criar canal não dá nenhum retorno |
| 2 | Linguagem do mundo real | 2 | pt-BR sem acento em toda a UI. Sessões mostram o user-agent cru. Convite diz "1 de sem limite" |
| 3 | Controle e liberdade | 2 | **Não existe "Sair da conta"**: a API tem `POST /api/auth/logout` (`auth.routes.ts:269`) e nenhuma tela chama essa rota. O convite se perde em "Já tenho conta" |
| 4 | Consistência | 2 | Dois diálogos de configuração com estruturas diferentes, um aninhado no outro. O botão salvar muda de lado. Login com botão pílula ao lado de botão retangular |
| 5 | Prevenção de erro | 3 | Confirmar antes de apagar e desabilitar salvar sem mudança estão bons. Mas Enter envia "@An" cru |
| 6 | Reconhecer em vez de lembrar | 2 | O autocomplete de menção fica antes do textarea no DOM (só se chega por Shift+Tab). Sem avatar nas mensagens. Remover membro é só um ícone |
| 7 | Flexibilidade e eficiência | 2 | Ctrl+K só navega ("pauta" dá "Nada encontrado"). Pontos altos: densidade e painéis redimensionáveis |
| 8 | Estética e minimalismo | 2 | "Reagir · Responder" sublinhado embaixo de toda mensagem: o cromo pesa igual ao conteúdo e dobra a altura no mobile |
| 9 | Recuperação de erros | 2 | "Não foi possível conectar ao servidor de mídia" sem "Tentar de novo". "Nenhum disponível" em Áudio sem botão de permissão |
| 10 | Ajuda e documentação | 2 | A microcopy inline é ótima; fora dela não há ajuda, e os estados vazios têm uma frase só |
| **Total** | | **21/40** | **Aceitável.** Meta ao fim da Etapa 6: **≥ 32/40** |

### 1.2 Veredito de design specificity

**Genérico por dentro, com identidade só na porta de entrada.**

- **O app** é o esqueleto do Discord reproduzido fielmente: trilho de grupos,
  "CANAIS DE TEXTO", "OFFLINE — 1".
  - Usa neutros slate e o azul padrão do Tailwind (`#60a5fa` / `#1d4ed8`, `ui/tokens.ts`).
  - As cores de cargo são os hex do Discord (`#5865F2`, `#3BA55D`, `#ED4245`).
  - Trocando o logo, vira qualquer clone.
- **A porta** ("ALT / CAST", Space Mono espaçado, metaballs de mercúrio) tem voz,
  mas é o tropo tech-brutalista genérico. Repete a marca três vezes e **some por completo ao logar**.
- Nada na interface diz "cast" ou "transmissão", que é o próprio nome do produto.
- A disciplina de tokens é excelente e não gera caráter. É a melhor base possível
  para uma virada de identidade, porque trocar é barato.

**Scan determinístico (Assessment B)**

- **CLI:** `detect.mjs` achou 5 avisos, dos quais 4 são falsos positivos ou decisões conscientes.

  | Achado | Onde | Veredito |
  |---|---|---|
  | `bounce-easing` | `mercurio.css:168` (overshoot na gota do login) | Real |
  | `side-tab` | `Composer.tsx:259` (faixa de citação da resposta) | Falso positivo parcial: é padrão de chat |
  | `border-accent-on-rounded` | `Abas.tsx:63` (sublinhado da aba) | Falso positivo |
  | `overused-font` (×2) | `fontes.css:21,30` (Inter) | Real no sentido da regra |

- **Overlay no navegador:** a CSP do app (`default-src 'self'`) bloqueia o injetor,
  e isso é bom sinal de segurança. Rodou via Playwright com `bypassCSP`.
  - **Todas as telas:**
    - texto funcional de 10–11px (separador de data, citação, "Esqueci minha senha");
    - linha de mensagem com ~113 caracteres (a citação chega a ~144);
    - Inter em 89–100% do texto;
    - hierarquia tipográfica achatada (10→18px, razão 1.8:1);
    - cartões aninhados em `#canais` e nas configurações do grupo;
    - borda fina com sombra de 48–64px nos diálogos;
    - botão com 0px de padding vertical no rodapé das configurações.
- **Lighthouse:**
  - login: Acessibilidade 100, Boas práticas 96 (401 do `/api/auth/me` no console);
  - conversa: Acessibilidade 98, porque **não há `<main>`**.
  - SEO reprova `meta-description`, e `/robots.txt` devolve o `index.html`.
- **axe:**
  - `landmark-one-main`;
  - `region` em 10 nós (rodapé do usuário, alças de redimensionamento).
- **Contraste do texto secundário:** 7,25–7,86:1 no escuro e 6,92–7,58:1 no claro.
  Passa AA e quase AAA.
- **Sem problemas:** nenhum alvo de toque real menor que 24px e nenhum scroll horizontal.
- **Onde as duas avaliações concordam:** tipografia achatada e genérica, cromo
  pesando sobre o conteúdo e a identidade restrita à porta. O detector também
  achou o que a revisão não mediu: o texto de 10–11px e o tamanho das linhas.

### 1.3 Carga cognitiva — 4 de 8 falhas (alta)

- **Falhas no checklist:**
  - hierarquia visual (as ações pesam igual às mensagens);
  - escolhas mínimas;
  - memória de trabalho (o código do convite some entre o convite e o login);
  - revelação progressiva (ações sempre visíveis e user-agent cru).
- **Pontos de decisão com mais de 4 opções:**
  - emoji: 8;
  - cor de cargo: 11;
  - permissões: 19 checkboxes;
  - Aparência: tema × densidade misturados em 4 botões;
  - linha de membro: 4 ações;
  - Configurações do usuário com a do grupo embutida: 4 + 5 abas ao mesmo tempo.

### 1.4 Jornada emocional

| Momento | Hoje | Deve ser |
|---|---|---|
| Porta de entrada | Dramática e redundante | Confiante e ligada ao app |
| Primeiro login | **Vale**: vazio escuro, "Nenhuma mensagem ainda." | Checklist do dono e boas-vindas vivas |
| Grupo criado | **Pico**: "Clube do Livro está pronto", link já copiado | Manter e ampliar |
| Aceitar convite | **Vale mais fundo**: o convite se perde no login, e no mobile o "Entrar" fica fora da tela | O momento mais seguro do produto |
| Primeira chamada | Vermelho de erro com estado contraditório | Conectando → conectado → falhou, com ação |
| Ações destrutivas | Bom ("Não tem volta") | Manter |

### 1.5 Pontos fortes (preservar)

1. **Microcopy honesta e didática:**
   - "Não concede ler o canal", "Sem isto, a pessoa entra e só escuta";
   - "Vale por uma hora";
   - o texto que evita enumeração de e-mail.
2. **Disciplina de sistema:**
   - um único acento, vermelho só para perigo, verde só para presença;
   - tokens em TS lidos pelo teste de contraste;
   - foco garantido, `tabular-nums`, `prefers-reduced-motion` e alvo de toque de 44px.
3. **Criar grupo termina em ação**, com o convite pronto e copiado.

### 1.6 Problemas prioritários

| Sev. | Problema | Correção | Comando |
|---|---|---|---|
| **P0** | "Entrar" do convite transborda o diálogo; no mobile fica fora da tela (x 357–665 num viewport de 390). Causa: dois `Botao largura="cheia"` em `flex gap-2` (`AceitarConvite.tsx:137`) | `grid grid-cols-2 gap-2`, primário à direita, empilhado abaixo de 360px | `/impeccable adapt` |
| **P1** | Convite perdido entre cadastro e login | O código viaja por login, cadastro e Google; o cartão do grupo fica visível; o título da tela é o grupo | `/impeccable onboard` |
| **P1** | pt-BR sem acento | Revisão integral da copy junto com a extração de i18n (D7) | `/impeccable clarify` |
| **P1** | Menções quebradas (Enter, DOM, sem destaque) | Listbox com `aria-activedescendant`, chip de menção e fundo `accentSubtle` | `/impeccable harden` |
| **P1** | Estado de voz contraditório; erro de mídia sem saída | Uma única fonte de verdade para a chamada, máquina de estados e "Tentar de novo" | `/impeccable clarify` |
| **P1** | Não é possível sair da conta; sessões ilegíveis | "Sair" no painel do usuário; sessões como "Chrome no Windows · agora"; "Encerrar todas as outras" | `/impeccable clarify` |
| **P2** | Hierarquia da conversa (sem avatar, ações sublinhadas, citação cortada) | Barra de ações flutuante, avatar de 32px no bloco e reticências na citação | `/impeccable layout` |
| **P2** | Configurações duplicadas e inconsistentes | Um diálogo por escopo, altura fixa, salvar sempre no mesmo lugar e `ghost-danger` para apagar | `/impeccable distill` |
| **P2** | Tipografia achatada, 10–11px funcional, linhas longas | Escala nova (§8.2), corpo de 15px e `max-width` de 72ch | `/impeccable typeset` |
| **P3** | Motion decorativo no modo Operate (`TextoDecifrado` na voz, `Contador` nos números) | Motion só para estado (§8.5) | `/impeccable quieter` |

### 1.7 Red flags por persona

- **Alex (power user):**
  - Enter manda "@An";
  - Ctrl+K não busca mensagens;
  - não há editar/apagar na UI;
  - não há "Sair".
- **Casey (mobile):**
  - o "Entrar" do convite fica fora da tela;
  - cerca de 44px de ações por mensagem;
  - o banner de verificação rouba 80px;
  - a marca encosta no texto do convite.
- **Jordan (primeira vez):**
  - "0 online" no próprio grupo;
  - "Criar grupo — 2 de 3" é ambíguo (usado ou restante?);
  - "Escrever mensagens" e "Criar mensagens" parecem a mesma permissão;
  - o selo "poder sobre pessoas" aparece em "Apagar o grupo";
  - "Nenhum disponível" sem botão de permissão.

### 1.8 Observações menores (entram na Etapa 6)

- O foco do login desloca o rótulo.
- "Salvar" desabilitado parece ativo.
- "Sala de Reunião" vira `sala-de-reuniao` sem aviso.
- Ícone de voz como texto na gestão de canais.
- "Reordenar" sem alça.
- Cabeçalho "MEMBROS" duplicado.
- Avatar do grupo cinza na prévia e dourado no app.
- Dois primários lado a lado em "está pronto".
- "Aparência" dentro de "Conta".
- `select` nativo truncado ("1080p · 60 fps — Máxima (~1(").

---

## 2. Bugs confirmados no código

| # | Bug | Onde | Etapa |
|---|---|---|---|
| B1 | Rascunho, resposta e **anexo** vazam ao trocar de canal | `AppShell.tsx:457` (sem `key`), `Composer.tsx` | 0 |
| B2 | Menção usa membros de **todos** os grupos | `Composer.tsx:57,143` | 0 |
| B3 | "E-mail confirmado" e "senha trocada" nunca aparecem | `VerificarEmail.tsx:35`, `RedefinirSenha.tsx:33` | 0 |
| B4 | `/verificar/<token>` com sessão aberta é ignorado | `App.tsx` | 0 |
| B5 | Convite + "Já tenho conta" perde o código | `TelaAuth`, `Login` | 0 |
| B6 | "Tentar de novo" perde anexos e `replyToId` | `features/messages/envio.ts` | 0 |
| B7 | Paginação sem trava e sem preservar o scroll | `MessageList.tsx` | 0 |
| B8 | Overwrites ignorados em listagem, `ready`, fanout e `typing` (**latente**) | `channels.routes.ts:181`, `gateway.ts:52,154`, `fanout.ts:31` | 5 (junto com a UI de overwrites) |
| B9 | Latência em `aria-live`, reanunciada a cada ping | `BarraConexao.tsx` | 0 |
| B10 | Paleta sem item ativo; membros duplicados | `PaletaDeComandos.tsx` | 0 |
| B11 | Critério de admin divergente (papel × permissão) | `PainelDoUsuario` × `possoNoGrupo` | 0 |
| B12 | Não lidas só em memória | `naoLidasDoCanal` | 2 |
| B13 | Nenhuma tela chama o logout | web inteiro | 0 |
| B14 | Botão do convite fora da tela | `AceitarConvite.tsx:137` | 0 |
| B15 | Estado da chamada contraditório | `useChamada`, `PainelDeVoz`, `BarraDeChamada` | 0 |
| B16 | `already_member` acha o grupo pelo **nome** | `AceitarConvite.tsx` | 0 |

---

# PARTE II — PENSAMENTO EM ÁRVORE (ToT)

## 3. ToT estratégico: por onde o produto evolui

### Etapa 1 — Abertura (três ramos)

**Ramo A · Confiança primeiro.** Consertar tudo que faz o produto parecer
quebrado (B1–B16, acentos, logout, voz), depois o loop de atenção, e só então
recursos novos.

**Ramo B · Paridade com o Discord.** Correr atrás da lista de recursos: DM,
busca, threads, markdown, emojis, moderação, palco. Medido pela quantidade de
checkboxes preenchidas.

**Ramo C · Identidade e inteligência.** Diferenciar pelo que o Discord não tem:
uma identidade "no ar" própria e uma camada de julgamento com o Jev (automod com
regras em linguagem natural, notificação só do que importa, busca que entende).

### Etapa 2 — Avaliação cruzada

| Critério (peso) | A | B | C |
|---|---|---|---|
| Valor percebido pelo usuário atual (×3) | 4 | 3 | 3 |
| Risco técnico (×2, maior = menor risco) | 4 | 2 | 2 |
| Diferenciação (×2) | 1 | 1 | 4 |
| Retenção (×3) | 3 | 3 | 3 |
| Custo (×1, maior = mais barato) | 4 | 1 | 2 |
| **Total ponderado** | **36** | **25** | **33** |

- **A** vence porque o produto hoje perde gente por atrito: convite quebrado, sem logout, voz contraditória.
  Sozinho, porém, entrega um "Discord arrumado", sem motivo para trocar.
- **B** é o ramo mais caro e o que menos diferencia.
  Threads e palco custam muito e pouca gente pede.
  Mas quatro itens dele são **higiene obrigatória**: DM, busca, editar/apagar e markdown.
- **C** diferencia, mas IA sobre um produto quebrado amplifica a desconfiança.
  O Jev precisa de dados já estruturados (busca, menções, não lidas) para ter o que julgar.

**Riscos que cada ramo sozinho carrega**

- **Só A:** estagnação.
- **Só B:** dívida e esforço espalhado.
- **Só C:** um "truque de IA" em cima de bugs.

### Etapa 3 — Caminho otimizado (Golden Path)

> **A como fundação → o núcleo de higiene de B → C costurado em cada etapa,
> nunca como etapa isolada.**

Regras do caminho:

1. Nenhuma etapa começa com a anterior vermelha nos testes.
2. A identidade visual (C) entra **cedo**, na Etapa 1: trocar tokens depois de
   construir DM, busca e moderação custaria o dobro.
3. Cada recurso de IA **tem caminho sem IA**. O Jev melhora, não sustenta:
   - a busca funciona sem rerank;
   - a moderação funciona sem automod;
   - a notificação funciona sem triagem.
4. Do ramo B, threads, palco e soundboard ficam **fora** até existir demanda medida.

---

## 4. ToT das decisões críticas

Formato: três ramos → avaliação → escolha. Só aparecem as decisões que mudam
arquitetura ou identidade.

### D1 · Direção visual do app

- **D1-A · Manter o azul e só polir.** Risco zero e zero identidade.
- **D1-B · Acento "no ar" âmbar (sinal de transmissão).**
  - Escuro: `#f59e0b` com `accentFg #1a1204`. Claro: `#b45309` (~5:1 sobre branco).
  - Distante do vermelho de perigo e do verde de presença.
  - Transforma "cast" em forma: o indicador de fala e o canal ao vivo usam o acento.
- **D1-C · Violeta ou magenta vibrante.** Distinto, mas perto demais do
  "blurple" do Discord e do clichê de IA.

**Avaliação.** B é o único ramo que liga o nome do produto à interface. O custo
é baixo, porque tudo passa por `ui/tokens.ts` e o teste de contraste. O risco é
âmbar conflitar com "aviso": resolve-se com um token `warning` próprio, amarelo
`#eab308`, usado apenas com ícone e texto e nunca como cor sozinha.
**Escolha: D1-B — confirmada pelo dono do produto em 2026-09-26.** A validação
visual por capturas continua valendo antes do merge da Etapa 1.

### D2 · Roteamento e deep links

- **D2-A · Estender o `lib/rota.ts` próprio** com `/g/:grupo/c/:canal/m/:msg`.
- **D2-B · Adotar TanStack Router.** Tipado, com loaders; troca a base inteira.
- **D2-C · Guardar a rota só no estado (zustand).** Sem URL real.

**Avaliação.** C impede notificação clicável, "copiar link da mensagem" e o
Voltar do navegador. B traz uma biblioteca inteira para cerca de dez rotas sem
aninhamento de dados, e o próprio `rota.ts` explica por que não usá-la. A mantém a
decisão documentada e só cresce o `switch`.
**Escolha: D2-A**, com sincronização bidirecional: a store segue a URL (`popstate`)
e a URL segue a store (`pushState` ao trocar de canal).

### D3 · Contagem de não lidas e menções

- **D3-A · Contar no cliente**, como hoje. Errado para o canal nunca aberto.
- **D3-B · Contador materializado por (canal, usuário)** atualizado a cada
  mensagem. Reescreve N linhas por mensagem; o schema já rejeitou isso.
- **D3-C · Derivar do marco `channel_reads`** com `COUNT(*) WHERE id > marco`,
  limitado a 100 (a UI mostra "99+"). Envia no `ready` e atualiza por evento.

**Avaliação.** C segue a filosofia do schema: o índice `(channel_id, id DESC)`
atende e o limite torna o custo constante.
**Escolha: D3-C.** As menções usam a mesma técnica sobre `mentions ∪ mentionsEveryone`.

### D4 · Notificações

- **D4-A · Só dentro da aba** (título e badge).
- **D4-B · Web Notification com a aba aberta + desktop nativo** (Electron).
- **D4-C · Web Push com Service Worker e VAPID.** Chega com o navegador fechado.

**Avaliação.** C é o mais completo, mas exige Service Worker, tabela de
inscrições, chaves VAPID e tratamento de expiração. B cobre 90% do uso real
(o app de desktop existe e o navegador geralmente está aberto).
**Escolha: A + B na Etapa 2 e C na Etapa 8**, com a mesma tabela de preferências.

### D5 · Busca de mensagens

- **D5-A · `ILIKE '%termo%'`.** Simples, mas lento e sem relevância.
- **D5-B · Postgres FTS**: coluna gerada `tsvector` com `unaccent` e
  configuração `portuguese`, índice GIN e `ts_rank`.
- **D5-C · Motor externo** (Meilisearch ou Typesense). Mais uma peça para operar
  e mais um lugar para vazar permissão.

**Avaliação.** B roda no banco que já existe, respeita permissão no mesmo SQL e
aguenta milhões de linhas.
**Escolha: D5-B + rerank Jev opcional** nos 50 primeiros (§7.4). Sem acento no
índice, "reuniao" acha "reunião", o que importa enquanto a própria copy ainda
não tem acentos.

### D6 · Mensagens diretas

A proposta de 2026-09-10 já fez esta árvore:
- **A · grupo invisível** (`groups.kind = 'dm'`, `dmKey` único);
- **B · `channels.groupId` nulo**;
- **C · tabelas próprias**.

**Escolha mantida: A.** Reaproveita mensagens, reações, menções, anexos,
leitura, fanout e `can()`. As seis negações ficam concentradas em
`ehConversaDireta(groupId)` dentro de `can()`, e a unicidade é garantida pelo
**índice único do banco** em `dm_key`.

### D7 · Acentuação e i18n

- **D7-A · Corrigir acentos direto nas strings.** Rápido, sem i18n depois.
- **D7-B · Extrair tudo para catálogo (i18next) já com acento.**
  Um passe só, pronto para o inglês.
- **D7-C · Primeiro i18n com as strings atuais, acentos depois.** Dois passes pela mesma copy.

**Avaliação.** A copy vai ser tocada de qualquer jeito, então B faz a revisão
editorial e a extração de uma vez.
**Escolha: D7-B, em duas fatias:**
1. Etapa 0: acentos nas telas de entrada, convite e voz, direto nas strings,
   porque são o P1 e bloqueiam a confiança;
2. Etapa 6: extração completa para `web/src/i18n/pt-BR.ts`, tipada (a chave é
   `keyof typeof ptBR`) e sem biblioteca no início. `i18next` só se o inglês vier.

Os comentários de código continuam sem acento, como é convenção do repositório.

### D8 · Formatação de mensagens (markdown)

- **D8-A · `react-markdown` + `rehype-sanitize`.** Completo e pesado (~40 KB), com regras de sobra.
- **D8-B · Parser próprio do subconjunto Discord**, gerando árvore React e **nunca HTML**:
  `**negrito**`, `*itálico*`, `~~riscado~~`, `` `código` ``, bloco de código, `||spoiler||`,
  `> citação`, links, `@menção`, `#canal`.
- **D8-C · Editor rico (Lexical/TipTap).** Mais WYSIWYG do que um chat pede.

**Avaliação.** B nunca passa por `innerHTML`, então não há XSS por construção.
Menção e canal viram nós tipados, e o parser é testável com tabela de casos.
**Escolha: D8-B**, com realce de sintaxe carregado sob demanda (Shiki, lazy) só em
blocos de código.

### D9 · Arquitetura do automod com Jev

- **D9-A · Síncrono no envio:** a mensagem espera o julgamento antes de ser publicada.
  Mais seguro, mas acrescenta ~150–300 ms a toda mensagem e a torna dependente da API.
- **D9-B · Assíncrono depois da publicação:** publica, julga em seguida e esconde se violar.
  Latência zero, mas o conteúdo ruim fica visível por um instante.
- **D9-C · Híbrido por risco:**
  - **síncrono** só para quem tem sinal de risco: conta com menos de 24 h, primeira
    mensagem no grupo, link externo, grupo com "modo rígido";
  - **assíncrono** para o resto.
  - Se o Jev cair ou demorar mais de 800 ms, a mensagem passa, entra na fila de
    revisão e nada é bloqueado.

**Avaliação.** C põe o custo onde o risco está: spammer é conta nova com link.
O fallback garante que o chat nunca para por causa da IA.
**Escolha: D9-C.** O automod **nunca apaga**: segura, esconde para os outros e
manda para a fila humana (§7.2).

### D10 · Tempo real: resume e escala

- **D10-A · Manter o `ready` completo a cada reconexão.** Perde eventos no intervalo.
- **D10-B · Sequência por conexão com buffer de replay em memória** (últimos 500
  eventos ou 2 min). `resume {sessionId, seq}` → replay; fora da janela → `ready`.
- **D10-C · Redis Streams** para replay e pub/sub entre instâncias.

**Avaliação.** B resolve o problema real, que são as quedas curtas de Wi-Fi e a
suspensão do notebook, sem infraestrutura nova. C só se paga com mais de uma
instância. **Escolha: B na Etapa 7 e C quando o Redis entrar** (mesma etapa,
atrás de flag). O contrato `resume` é o mesmo nos dois casos.

### D11 · Arquitetura das configurações

- **D11-A · Manter as duas telas e só alinhar o visual.**
- **D11-B · Uma tela por escopo, estilo Discord:**
  - "Configurações do usuário" (conta, perfil, privacidade, dispositivos, aparência,
    acessibilidade, voz e vídeo, notificações, atalhos, idioma);
  - "Configurações do grupo" (visão geral, cargos, canais, membros, convites,
    moderação, auditoria, IA).
  Navegação lateral agrupada, altura fixa e busca interna.
- **D11-C · Painel lateral contextual**, sem modal. Pouco espaço para cargos e permissões.

**Escolha: D11-B.** A aba "Grupo" sai das configurações do usuário, e o critério
de acesso passa a ser **só** `possoNoGrupo` (fecha o B11).

### D12 · Onde a IA mora no código

- **D12-A · Chamadas espalhadas pelas rotas.**
- **D12-B · Módulo `api/src/ia/`** com cliente, perguntas versionadas, cache,
  orçamento e flag por grupo; as rotas só chamam `julgar.*`.
- **D12-C · Serviço separado.** Mais um deploy sem necessidade.

**Escolha: D12-B** (detalhe em §7.1).

---

# PARTE III — EXECUÇÃO

## 5. Visão geral das etapas

```
Etapa 0  Confiança ........ bugs B1–B16, logout, acentos críticos, voz
Etapa 1  Identidade ....... Design System v2 (acento no ar, tipografia, conversa)
Etapa 2  Atenção .......... deep links, não lidas no servidor, notificações, mute
Etapa 3  Conversa rica .... editar/apagar UI, markdown, emoji, fixar, previews, virtualização
Etapa 4  Encontrar ........ busca FTS + filtros + rerank Jev + paleta de comandos
Etapa 5  Comunidade ....... moderação, auditoria, overwrites (+B8), automod Jev
Etapa 6  Social + polimento DMs, status, bloquear, perfil rico, configurações v2, i18n, mobile
Etapa 7  Plataforma ....... resume, Redis, observabilidade, backups, 2FA, LGPD, antivírus
Etapa 8  Alcance .......... Web Push, desktop (auto-update, nativo), onboarding com modelos
Etapa 9  Extras medidos ... threads, palco, soundboard (só com demanda)
```

**Dependências críticas**

| Etapa | Depende de | Por quê |
|---|---|---|
| 2 | 0 | Links diretos (deep links) usam o mesmo roteador que os fluxos de convite e verificação corrigidos |
| 4 | 2 | O resultado da busca abre pelo deep link |
| 5 | 3 | O menu de contexto da mensagem é onde "denunciar" e "apagar como moderador" moram |
| 6 | 2 | DM reusa as não lidas |
| 6 | 3 | DM reusa o composer novo |
| 7 | 2 | O `resume` precisa dos eventos de leitura já estáveis |

**Formato de cada etapa:** um ou dois PRs, na cadência atual de commits
(`feat(escopo): ...`). A suíte inteira roda no pre-commit (795 testes), então:
`npm test` antes, e timeout longo no commit.

---

## 6. As etapas, completas

> Convenções do repositório que valem em todas as etapas:
> - migrações em `api/migrations/NNNN_nome.sql` (a próxima é a `0014`) com o
>   schema em `api/src/db/schema.ts`;
> - toda invariante vai **no banco** (índice único, check), nunca em "consulta antes de inserir";
> - toda nova ação de permissão entra em `permissions/acoes.ts` com descrição e seção;
> - testes da API em `api/test/*.test.ts` com `withTestDb`/`loginComo`;
> - testes do web em `web/test/*.test.tsx`;
> - e2e em `e2e/*.spec.ts`;
> - depois de mudar código, `graphify update .`.

### Etapa 0 — Confiança

**Objetivo:** nenhuma pessoa perde um convite, um rascunho ou a própria sessão. A voz diz a verdade.

| Tarefa | Arquivos | Detalhe |
|---|---|---|
| 0.1 Rascunho por canal | `AppShell.tsx`, `Composer.tsx`, `lib/store.ts` | `key={canalAtivo}` no `<Conversa>`; rascunhos em `store.rascunhos[canalId] = {texto, replyToId, anexos}`, persistidos em `sessionStorage` com try/catch. O anexo guarda o `channelId` e só pode sair naquele canal |
| 0.2 Menções corretas | `Composer.tsx`, novo `features/messages/Mencoes.tsx` | Candidatos = membros **do grupo do canal**; busca por `displayName` e `username`; listbox com `role="listbox"`, `aria-activedescendant`, ↑/↓, Enter/Tab completam e Esc fecha; a lista fica **depois** do textarea no DOM e é posicionada acima com CSS |
| 0.3 Fluxos de auth com sessão | `App.tsx`, `VerificarEmail.tsx`, `RedefinirSenha.tsx`, `lib/rota.ts` | Rotas `verificar` e `redefinir` também renderizam com sessão aberta; a tela de sucesso aparece e depois oferece "Continuar"; sem `trocarPor` automático |
| 0.4 Convite atravessa o login | `TelaAuth.tsx`, `Login.tsx`, `Cadastro.tsx`, `EntrarComGoogle.tsx`, `google.routes.ts` | `?convite=CODIGO` preservado nas três portas (no Google, via `state` do OAuth); cartão "Entrar para aceitar o convite de **Clube do Livro**"; ao autenticar, aceita e abre o grupo |
| 0.5 Botão do convite | `AceitarConvite.tsx:137` | `grid grid-cols-2 gap-2`, primário à direita; `@max-[360px]:grid-cols-1` |
| 0.6 `already_member` pelo id | `AceitarConvite.tsx`, `invites.routes.ts` | A API devolve `groupId` no erro 409; o web abre por id |
| 0.7 Reenvio completo | `envio.ts` | A fila guarda `{content, replyToId, attachmentIds}` e reenvia tudo |
| 0.8 Paginação | `MessageList.tsx` | Trava `carregando`; âncora de scroll (guarda `scrollHeight - scrollTop` antes e restaura depois); só é "Nova mensagem" quem chegou por evento |
| 0.9 Sair da conta | `PainelDoUsuario.tsx`, `lib/api.ts` | Menu do avatar: Perfil · Configurações · **Sair**. Chama `POST /api/auth/logout`, limpa a store e fecha o socket |
| 0.10 Sessões legíveis | `ConfiguracoesUsuario.tsx`, novo `lib/userAgent.ts` | "Chrome no Windows · agora"; UA completo em um `<details>`; "Encerrar todas as outras" (rota já existe) |
| 0.11 Estado da chamada | `useChamada.ts`, `chamadaAtiva.ts`, `PainelDeVoz.tsx`, `BarraDeChamada.tsx` | Máquina `ocioso → conectando → conectado → reconectando → falhou`, com **uma** fonte de verdade na store; na falha, "Tentar de novo" e "Configurar dispositivos"; clicar no canal de voz entra direto (pedido anterior do usuário) |
| 0.12 Paleta | `PaletaDeComandos.tsx` | Item ativo com ↑/↓ + Enter; membros sem duplicata (por `userId`); clicar em membro abre o perfil |
| 0.13 Admin único critério | `PainelDoUsuario.tsx` | `possoNoGrupo` em todo lugar |
| 0.14 A11y rápidas | `BarraConexao.tsx`, `AppShell.tsx` | Latência fora do `aria-live`; barra só visível quando degradada; `<main>` na conversa; alças de redimensionamento dentro de região rotulada |
| 0.15 Acentos críticos | telas de entrada, convite, voz, erros | Revisão editorial manual; o restante vai para a Etapa 6 |
| 0.16 Pequenos | `BarraGrupos.tsx`, `Login.tsx`, `Kbd.tsx`, `App.tsx` | `overflow-y-auto`; limpar `?erro=google`; URL correta depois do login; `⌘` no Mac; erro de histórico com "Tentar de novo"; estado de carregando no canal |

**Testes**

- **web:**
  - `composer.test.tsx`: rascunho por canal e anexo que não troca de canal;
  - `mencoes.test.tsx`: teclado e filtro por grupo;
  - `auth-screens.test.tsx`: sucesso visível e verificação logado;
  - `aceitar-convite.test.tsx`: layout e id;
  - `message-list.test.tsx`: âncora de scroll.
- **e2e:** o `fluxos.spec.ts` ganha "convite → já tenho conta → entra no grupo" e "sair da conta".

**Aceite**

- Os 16 bugs têm teste de regressão.
- As capturas do convite no mobile (390) mostram os dois botões dentro do diálogo.

### Etapa 1 — Identidade (Design System v2)

**Objetivo:** o app deixa de ser intercambiável e ganha a mesma voz da porta de
entrada. Especificação completa em §8.

| Tarefa | Arquivos |
|---|---|
| 1.1 Tokens novos: `accent`, `accentSubtle`, `accentLive`, `warning`, `bgSunken`, raios `sm/md/lg` | `ui/tokens.ts`, `tokens.css`, `tokens.test.ts` (contraste e paridade claro/escuro) |
| 1.2 Tipografia: Geist + Geist Mono auto-hospedadas; escala 12/13/14/15/16/20/24; `max-width: 72ch` no corpo da mensagem; mínimo 12px em texto funcional | `fontes.css`, `public/fontes/`, componentes com `text-[10px]` e `text-[11px]` |
| 1.3 Mensagem v2: avatar de 32px no primeiro bloco do autor, hora no hover das linhas seguintes, **barra de ações flutuante** (hover/foco; pressão longa no toque), citação com reticências | `MessageList.tsx`, novo `features/messages/AcoesDaMensagem.tsx` |
| 1.4 Cores de cargo em escala OKLCH própria (L 0.72, C 0.14, matiz a cada 36°) | `groups/cargosPadrao.ts`, `Cargos.tsx` |
| 1.5 Assinatura "no ar": anel de fala com `accentLive` e canal de voz ativo com pulso lento; motion de estado 150–200 ms | `PainelDeVoz.tsx`, `ListaCanais.tsx`, `ui/bits/AnelDeFala.tsx` |
| 1.6 Porta de entrada: uma marca só (sem triplicar "Altcast"), mercúrio tingido com 8–12% do acento, sem bounce-easing, botões com o mesmo raio | `TelaAuth.tsx`, `mercurio.css`, `PalcoMercurio.tsx` |
| 1.7 Diálogos: sombra curta (sem "borda fina + sombra de 64px"), sem cartão dentro de cartão | `ui/Card.tsx`, `Configuracoes*.tsx`, `#canais` |
| 1.8 Motion decorativo sai do modo Operate: sem `TextoDecifrado` no título da voz, `Contador` só onde o número muda por evento | `PainelDeVoz.tsx`, `Presenca.tsx` |

**Aceite**

- O detector sem `overused-font`, `bounce-easing`, `tiny-text`, `line-length` e `nested-cards`.
- Lighthouse de Acessibilidade 100 na conversa.
- Nova crítica com **≥ 27/40**.
- Revisão lado a lado das capturas antes e depois (as mesmas 35 telas de `critA`).

### Etapa 2 — Atenção (o loop que faz voltar)

**Objetivo:** ninguém perde uma menção, e é possível silenciar o que não importa.

| Tarefa | Detalhe |
|---|---|
| 2.1 Deep links (D2-A) | `lib/rota.ts` ganha `app`, `grupo`, `canal` e `mensagem` (`/g/:g/c/:c/m/:m`); `pushState` ao navegar, `popstate` volta; "Copiar link da mensagem" no menu da mensagem; abrir por link rola até a mensagem e a realça por 2 s |
| 2.2 Não lidas no servidor (D3-C) | Query `unreadCounts(userId)` com `LEAST(COUNT, 100)` por canal; `mentionCounts` sobre `mentions ∪ mentionsEveryone`; entram no `ready` como `unread: {[channelId]: {n, mentions}}`; evento `unread.update` quando outra sessão da mesma pessoa lê (sincroniza abas e desktop) |
| 2.3 Menção visível | Chip `@Nome` (nó do parser) com fundo `accentSubtle`; mensagem que me menciona ganha a faixa lateral `accent`; contador vermelho de menções no ícone do grupo e no canal |
| 2.4 Preferências de notificação | Migração `0014_notificacoes.sql`: `notification_prefs(user_id, scope_type 'group'\|'channel', scope_id, level 'all'\|'mentions'\|'none', muted_until timestamptz null, PK(user_id, scope_type, scope_id))`. Herança: canal → grupo → padrão (grupos com mais de 50 membros começam em `mentions`). Rotas `GET`/`PUT /api/notification-prefs`. Menu do canal e do grupo: "Silenciar por 15 min / 1 h / 8 h / 24 h / até eu reativar" |
| 2.5 Notificações do navegador (D4-B) | `lib/notificacoes.ts`: pede permissão **no primeiro momento útil** (depois da primeira menção recebida, com explicação), nunca no carregamento; `Notification` com `tag` por canal (agrupa) e clique abre o deep link; só dispara se a aba não está focada ou o canal não está aberto |
| 2.6 Título, favicon e badge | `(3) Altcast` no título; favicon com ponto (canvas → data URL); `navigator.setAppBadge`; no Electron, `app.setBadgeCount` + overlay icon (`desktop/src/bandeja.ts`) |
| 2.7 Sons de mensagem | `lib/sons.ts` ganha `mencao` e `mensagemDM`, respeitando as preferências e "não perturbe" |
| 2.8 Navegação por não lidas | Alt+Shift+↑/↓ para o próximo canal não lido; ao abrir o canal, rola até o **primeiro não lido**, com o separador "Novas mensagens" |
| 2.9 Presença (antecipada da proposta §4) | `users.status` (`online`\|`idle`\|`dnd`\|`invisible`) + `status_text` + `status_emoji` + `status_expires_at`; ausente automático após 10 min sem input (o cliente avisa); `dnd` corta som e notificação; `invisible` aparece como offline para os outros |
| 2.10 **Triagem Jev** (opcional) | Nível de notificação "Inteligente": notifica mensagens com Score de atenção ≥ limiar, mesmo sem menção (§7.3). Desligado por padrão |

**Testes**

- **API:** `unread.test.ts` (limite 100, menção, `@todos`, canal privado sem vazar), `notification-prefs.test.ts` (herança e expiração do mute) e `presence.test.ts` (invisível).
- **web:** título e badge; a permissão não é pedida no carregamento.
- **e2e:** a Ana menciona o dono em outra aba e a contagem aparece sem recarregar.

**Aceite**

- Recarregar a página preserva as contagens.
- Um canal silenciado nunca notifica.
- Uma menção sempre notifica, a menos que o nível seja `none`.

### Etapa 3 — Conversa rica

| Tarefa | Detalhe |
|---|---|
| 3.1 Editar e apagar (a API já existe) | Na barra flutuante: "Editar" (autor) e "Apagar" (autor ou `message.delete_any`); edição inline com Esc cancela e Enter salva; ↑ no composer vazio edita a última; "(editado)" com a data no tooltip; apagar pede confirmação (Shift+clique pula) |
| 3.2 Parser de mensagem (D8-B) | `web/src/lib/markdown/` com `tokenizar.ts`, `arvore.ts` e `Render.tsx`; subconjunto Discord; testes de tabela com ~80 casos, incluindo aninhamento, escape `\*` e tentativas de injeção; links só `http(s)` e `mailto`, com `rel="noopener noreferrer nofollow"` e aviso "Você está saindo do Altcast" para domínios não verificados |
| 3.3 Barra de formatação (opcional) | Ctrl+B, Ctrl+I, Ctrl+E (código) e Ctrl+Shift+X (riscado) no textarea |
| 3.4 Emoji | Seletor com busca, categorias, recentes (localStorage com try/catch) e tom de pele; dados em `emojibase` lazy; `:nome:` com autocomplete no composer; "quem reagiu" no tooltip (rota `GET /api/messages/:id/reactions/:emoji`) |
| 3.5 Fixar mensagem | Migração `0015_fixadas.sql`: `messages.pinned_at`, `pinned_by`; ação `message.pin`; eventos `message.pinned` e `unpinned`; painel "Fixadas" no cabeçalho do canal; limite de 50 por canal (check na rota, com contagem na transação) |
| 3.6 Prévia de links | `api/src/links/preview.ts`: busca Open Graph **no servidor** com proteção SSRF (resolve o DNS e recusa IP privado, loopback, link-local e metadata; só 80/443; timeout de 3 s; 512 KB; no máximo 3 redirects revalidados); cache em `link_previews(url_hash, data, fetched_at)`; a imagem passa pelo proxy de mídia (nunca hotlink); o autor pode remover a prévia |
| 3.7 Lightbox | Imagens e vídeos em tela cheia com setas, Esc e download |
| 3.8 Virtualização | `@tanstack/react-virtual` com altura dinâmica; mantém a âncora da Etapa 0; alvo: 60 fps rolando 5 000 mensagens |
| 3.9 Menu de contexto | Botão direito ou pressão longa: Responder, Reagir, Editar, Copiar texto, Copiar link, Fixar, Marcar como não lida, Apagar, Denunciar (Etapa 5) |
| 3.10 Rascunho entre sessões | O rascunho da Etapa 0 passa a ser salvo em `localStorage` |
| 3.11 **Pergunta já respondida — Jev** (opcional) | Ao digitar uma pergunta num canal com mensagens fixadas, sugere "Isso foi respondido aqui" (§7.5) |

**Aceite**

- Editar e apagar funcionam em tempo real nas duas contas.
- O parser tem 100% de cobertura de ramos.
- O teste de SSRF bate em `169.254.169.254`, `localhost`, `10.0.0.1`, `[::1]` e num redirect para IP privado, e todos são recusados.

### Etapa 4 — Encontrar (busca e paleta)

| Tarefa | Detalhe |
|---|---|
| 4.1 FTS (D5-B) | Migração `0016_busca.sql`: `CREATE EXTENSION unaccent`; configuração `pt_unaccent` (portuguese + unaccent); coluna gerada `messages.busca tsvector GENERATED ALWAYS AS (to_tsvector('pt_unaccent', content)) STORED`; `CREATE INDEX CONCURRENTLY` GIN (fora de transação, migração separada) |
| 4.2 Rota | `GET /api/search?q=&groupId=&channelId=&from=&has=&before=&after=&cursor=`; **filtra por permissão no mesmo SQL** (canais que o ator pode ler, com a mesma função das listagens corrigidas na Etapa 5; até lá, visibilidade + `channel_members`); `ts_rank_cd` + recência; `ts_headline` para o trecho destacado; 20 por página |
| 4.3 Sintaxe | `de:@ana em:#geral tem:arquivo\|link\|imagem antes:2026-09-01 depois:` + texto livre; chips removíveis no campo |
| 4.4 UI | Painel de resultados à direita (substitui membros enquanto aberto); clique abre o deep link com realce; Ctrl+F no canal busca nele |
| 4.5 Paleta v2 | Seções: Ir para (grupos, canais, DMs) · Pessoas · Mensagens (atalho para a busca) · Comandos ("Silenciar canal", "Criar canal", "Alternar tema", "Entrar na chamada"…); fuzzy match com pontuação; Enter executa |
| 4.6 **Rerank Jev** (opcional) | Os 50 primeiros do FTS passam por Score de relevância; reordena se a confiança média for ≥ 0.6, senão mantém o `ts_rank`; nunca remove resultados (§7.4) |

**Aceite**

- "reuniao" acha "reunião".
- A busca nunca devolve mensagem de canal privado para quem não tem acesso (teste dedicado, espelhando o `private-channel-leak.test.ts`).
- p95 abaixo de 150 ms com 1 milhão de mensagens (seed de carga).

### Etapa 5 — Comunidade (moderação e confiança)

| Tarefa | Detalhe |
|---|---|
| 5.1 Overwrites + B8 | UI "Permissões do canal" (cargo ou membro → permitir, herdar, negar, por ação); rotas `PUT`/`DELETE /api/channels/:id/overwrites/:alvo`; **uma função** `canaisVisiveis(userId, groupId)` usada por listagem, `ready`, `audienceOfChannel`, `typing` e busca; teste de vazamento para cada caminho |
| 5.2 Ban | Migração `0017_moderacao.sql`: `group_bans(group_id, user_id, banned_by, reason, created_at, PK)`; ação `group.ban`; remove mensagens das últimas 0 h, 24 h ou 7 dias (lógico); o convite recusa quem está banido |
| 5.3 Timeout | `group_members.timeout_until`; enquanto ativo, não escreve, não reage, não fala na voz; `can()` checa |
| 5.4 Slowmode | `channels.slowmode_seconds`; o servidor rejeita com `retryAfter`, e o composer mostra a contagem regressiva; quem tem `channel.manage` fica isento |
| 5.5 Log de auditoria | `audit_log(id uuidv7, group_id, actor_id, action, target_type, target_id, changes jsonb, reason, created_at)`; gravado **na mesma transação** da ação; aba "Auditoria" com filtros por pessoa, ação e data; retenção de 180 dias |
| 5.6 Denúncia | `reports(id, group_id, message_id, reporter_id, reason, status 'aberta'\|'resolvida'\|'descartada', resolved_by, created_at)`; fila "Moderação" para quem tem `group.moderate` |
| 5.7 Moderação na chamada | Rotas para silenciar no servidor e remover da sala (API do LiveKit `mutePublishedTrack` e `removeParticipant`); "Mutar para mim" local |
| 5.8 **Automod Jev** (D9-C) | Regras do grupo em linguagem natural; julgamento híbrido; fila humana; nunca apaga sozinho (§7.2) |
| 5.9 **Triagem de denúncias** | Choice de categoria + Score de gravidade ordenam a fila (§7.6) |
| 5.10 **Cargo por descrição** | "Quem pode organizar eventos, mas não expulsar" pré-marca as permissões; o dono confirma (§7.7) |

**Aceite**

- Todo caminho de leitura passa por `canaisVisiveis`, garantido por um teste que falha se uma rota nova listar canais sem ela (varredura em `routes/`).
- Toda ação de moderação aparece na auditoria.

### Etapa 6 — Social e polimento

| Tarefa | Detalhe |
|---|---|
| 6.1 DMs (D6-A) | Migração: `groups.kind` (`'group'`\|`'dm'`) + `dm_key text UNIQUE`; `ehConversaDireta()` dentro de `can()` nega as seis ações; `POST /api/dms {userIds}` devolve o existente ou cria (`ON CONFLICT (dm_key)`); DM em grupo com até 10 pessoas, podendo renomear; chamada de voz na DM |
| 6.2 Início (Home) | Primeiro ícone do trilho: lista de DMs com não lidas + "Pessoas com quem divido grupos" |
| 6.3 Bloquear | `user_blocks(blocker_id, blocked_id)`; o bloqueado não abre DM, suas menções não notificam e suas mensagens aparecem recolhidas ("Mensagem de pessoa bloqueada · mostrar") |
| 6.4 Perfil rico | Banner, bio (190 caracteres), pronomes, cor do perfil e **apelido por grupo** (`group_members.nickname`); cartão de perfil ao clicar no nome |
| 6.5 Configurações v2 (D11-B) | Duas telas por escopo; navegação lateral agrupada; altura fixa; busca interna; "Aparência" separa **Tema** (claro, escuro, seguir o sistema, OLED) de **Densidade** (confortável, compacta, IRC); sai a aba "Grupo" das configurações do usuário |
| 6.6 Acessibilidade (nova aba) | Tamanho do texto da conversa (14–18), zoom, saturação reduzida, sublinhar links, alto contraste, "sempre mostrar ações da mensagem" (para quem não usa hover) |
| 6.7 Atalhos (nova aba) | Lista completa (Ctrl+/ abre); tecla de push-to-talk configurável; Ctrl+Alt+↑/↓ entre grupos; Esc em camadas |
| 6.8 i18n (D7-B, fatia 2) | `web/src/i18n/pt-BR.ts` tipado; função `t('chave', {vars})`; plural com `Intl.PluralRules`; datas e números com `Intl`; teste que falha se um `.tsx` tiver string visível fora do catálogo (lint custom) |
| 6.9 Mobile por gestos | Abaixo de 600px: deslizar grupos ↔ canais ↔ conversa ↔ membros; gavetas com backdrop, clique fora e focus trap (Radix Dialog); a barra de grupos vira gaveta |
| 6.10 Onboarding | Checklist do dono no canal inicial (ícone → convidar 1 pessoa → criar voz → primeira mensagem); tela de boas-vindas para quem entra (regras + canais sugeridos + "diga oi") |
| 6.11 Categorias de canal | `channel_categories(id, group_id, name, position)` + `channels.category_id`; arrastar para reordenar (dnd-kit) com alça visível e teclado (espaço pega, setas movem) |
| 6.12 Emojis do grupo | `group_emojis(id, group_id, name, key, created_by)`; até 50 por grupo; a reação guarda `emoji` Unicode **ou** `custom:<id>` |

**Aceite**

- Uma DM entre as mesmas duas pessoas nunca duplica (teste de corrida com 10 requisições paralelas).
- Nova crítica **≥ 32/40**.
- Zero strings sem acento na UI (lint).

### Etapa 7 — Plataforma

| Tarefa | Detalhe |
|---|---|
| 7.1 Resume (D10-B) | `seq` por conexão; buffer circular (500 eventos ou 2 min) por sessão; `resume {sessionId, seq}` → replay + `resumed`, ou `invalid_session` → `ready` |
| 7.2 Redis (D10-C, atrás de flag) | Pub/sub do fanout, presença, chamadas e store do `@fastify/rate-limit`; permite N instâncias atrás do Caddy com sticky pelo WebSocket |
| 7.3 Observabilidade | `/api/metrics` no formato Prometheus (`prom-client`): latência por rota, conexões WS, eventos/s, fila do Jev, erros; OpenTelemetry nas rotas e no banco; Sentry no web e no desktop (sem PII: redação igual à do pino) |
| 7.4 Backups completos | `ops/backup.sh` inclui o bucket do MinIO (`mc mirror`); `BACKUP_REMOTO` obrigatório em produção (a memória do projeto registra que hoje os dumps ficam só na VM); teste de restore mensal documentado no RUNBOOK |
| 7.5 2FA | TOTP (`otpauth`) com 10 códigos de recuperação com hash; exigido para donos de grupo com mais de 100 membros (opcional antes disso); passkeys (WebAuthn, `@simplewebauthn`) em seguida |
| 7.6 LGPD | "Exportar meus dados" (job assíncrono → zip com JSON + anexos, link por 24 h); "Excluir conta" com carência de 14 dias; antes, **transferir titularidade** (`groups.ownerId` é RESTRICT, `schema.ts:122`); mensagens anonimizadas ("Usuário removido"), `authorId` → null |
| 7.7 Antivírus | ClamAV em container; o anexo fica em `pendente` até o scan; download bloqueado enquanto isso; infectado → apagado + aviso ao autor |
| 7.8 Segurança | Alerta de login em dispositivo novo por e-mail; CSP com `script-src 'self'` explícito; `robots.txt` e `meta-description` reais (achados do Lighthouse) |

### Etapa 8 — Alcance

| Tarefa | Detalhe |
|---|---|
| 8.1 Web Push (D4-C) | Service Worker, VAPID, `push_subscriptions(user_id, endpoint, keys, created_at)`, limpeza em 410; mesmas preferências da Etapa 2 |
| 8.2 Desktop | Auto-update (`electron-updater`), iniciar com o Windows, notificações nativas com ação "Responder" |
| 8.3 Modelos de grupo | Amigos, Estudo, Time e Jogo, cada um com canais, cargos e mensagem de boas-vindas; **Jev** sugere o modelo a partir do nome e da descrição do grupo (Choice, §7.8) |
| 8.4 Convite rico | Open Graph na página `/convite/:codigo` (servida pelo Caddy com pré-render mínimo): ícone, nome, membros online/total |

### Etapa 9 — Extras só com demanda medida

Threads, canal de palco, soundboard, eventos agendados e integrações (webhooks
de entrada). Cada um só entra com o dado da Etapa 7 mostrando pedido real: a
busca por "thread" sem resultado e os pedidos na denúncia ou no feedback.

---

## 7. Camada de IA com TypeSafe (Jev)

### 7.1 Arquitetura (D12-B)

```
api/src/ia/
  cliente.ts        POST https://api.typesafe.ai/v1/systemone, model "jev-latest",
                    Authorization: Bearer TYPESAFE_API_KEY; timeout 800 ms;
                    backoff exponencial em 429/529 (no máximo 2 tentativas);
                    circuit breaker (5 falhas em 30 s → 60 s aberto)
  perguntas/        uma pergunta por arquivo, versionada (automod.v1.ts...);
                    a versão entra na chave de cache e no log de decisão
  julgar.ts         API interna tipada: julgar.automod(), julgar.atencao(),
                    julgar.relevancia(), julgar.jaRespondida(), ...
  cache.ts          LRU em memória (Redis quando existir) por hash(estado+versão)
  orcamento.ts      teto de chamadas por grupo/dia; acima dele, degrada para
                    o caminho sem IA e registra
  decisoes.ts       tabela ia_decisoes (grupo, recurso, versão, entrada_hash,
                    resposta jsonb, latência, ação tomada) para calibrar os limiares
```

**Regras invioláveis da camada**

1. **Opt-in por grupo, por recurso:** `group_ai_settings(group_id, recurso, ativo, limiar jsonb)`.
   Tudo desligado por padrão. A aba "IA" das configurações do grupo explica o que é enviado.
2. **Sempre no servidor.** A chave nunca vai para o web nem para o desktop.
3. **Mínimo de dados:**
   - vai só o texto necessário e os nomes de exibição, **nunca** e-mails nem ids de usuário;
   - o estado usa apelidos estáveis ("autor", "pessoa_1");
   - canal privado só com o recurso ligado explicitamente para ele.
4. **Todo recurso tem caminho sem IA.** Timeout, circuit breaker aberto ou
   orçamento estourado levam ao comportamento clássico, nunca a erro para o usuário.
5. **A IA nunca executa a ação irreversível.** Ela segura, sugere, reordena ou
   pré-preenche; apagar, banir e expulsar são sempre humanos.
6. **Limiares calibrados com dados reais:**
   - os valores abaixo são o ponto de partida;
   - `ia_decisoes` + as revisões humanas alimentam a recalibração mensal;
   - ações de maior consequência pedem limiar mais alto (orientação da documentação de confiança).

**Ligações necessárias**

- `api/src/env.ts`: `TYPESAFE_API_KEY: z.string().optional()`.
  Sem a chave, todos os recursos aparecem como "indisponível", no mesmo padrão
  do LiveKit e do Resend.
- `docker-compose.yml`: repassar a variável ao serviço `api`.
- `.env.example` já tem o placeholder.

**Idioma das perguntas.** `instructions` e `criteria` em inglês, que é o idioma
dos exemplos da documentação. O `state` vai no idioma original (pt-BR). Validar
com um conjunto de avaliação em pt-BR antes de ligar cada recurso (§9.3).

### 7.2 Automod com regras do dono (Etapa 5)

Uma requisição com N perguntas paralelas sobre o mesmo estado:

```json
{
  "model": "jev-latest",
  "state": {
    "message": "texto da mensagem",
    "recent_context": ["até 5 mensagens anteriores do canal"],
    "group_rules": ["Sem divulgação de outros servidores", "Sem spoiler fora de #spoilers"],
    "channel": { "name": "geral", "topic": "conversa livre" },
    "author": { "account_age_hours": 3, "first_message_in_group": true }
  },
  "questions": {
    "assedio": {
      "type": "noul",
      "instructions": "Does `message` insult, threaten or harass a specific person, considering `recent_context`? Friendly banter between people clearly joking together is not harassment.",
      "criteria": { "true": "Targets a person with insults, threats or humiliation", "false": "No targeted abuse" }
    },
    "golpe_spam": {
      "type": "noul",
      "instructions": "Is `message` spam or a scam: unsolicited promotion, phishing, fake giveaways, requests for credentials or payment?",
      "criteria": { "true": "Spam, scam or phishing", "false": "Ordinary message" }
    },
    "regra_violada": {
      "type": "choice",
      "instructions": "Which of `group_rules` does `message` most clearly violate, if any? Pick none unless the violation is evident from the text.",
      "criteria": { "none": "No rule is clearly violated", "r0": "Rule 1", "r1": "Rule 2" }
    }
  }
}
```

O código monta os `criteria` de `regra_violada` a partir das regras do grupo (`r0…rN`).

**Política (código, não modelo)**

| Condição | Ação |
|---|---|
| `golpe_spam ≥ 0.90` e autor com sinal de risco | **Segura**: não publica e manda para a fila; o autor vê "Sua mensagem está em revisão" |
| `assedio ≥ 0.85` | Publica **oculta para os outros** e manda para a fila |
| `regra_violada ≠ none` e `confidence ≥ 0.7` | Publica, sinaliza para a fila e avisa o autor com a regra |
| Entre 0.5 e o limiar | Só registra em `ia_decisoes` (dado para calibrar) |
| Timeout / erro / orçamento | Publica normalmente; se o autor tinha sinal de risco, manda para a fila |

- **Síncrono** (D9-C) quando há sinal de risco:
  - conta com menos de 24 h;
  - primeira mensagem no grupo;
  - link externo;
  - modo rígido.
- **Assíncrono** nos demais casos, com ocultação posterior e evento `message.updated`.

### 7.3 Triagem de notificação — nível "Inteligente" (Etapa 2)

```json
"atencao": {
  "type": "score",
  "instructions": "How much does `message` call for the attention of `reader`, who is not mentioned? Consider questions addressed to the group, decisions, deadlines, and whether `reader` took part in `recent_context`.",
  "criteria": [
    "Casual chatter nobody needs to see now",
    "Mildly relevant, fine to read later",
    "Relevant to reader, worth a quiet notification",
    "Directly needs reader: a question, decision or deadline involving them"
  ]
}
```

- Notifica se `score ≥ 2.0` e `confidence ≥ 0.6`.
- **Menção direta sempre notifica**, sem passar pelo Jev.
- **Custo controlado:**
  - só roda para leitores com o nível "Inteligente";
  - só em canais com o nível herdado;
  - agrupa leitores parecidos (mesmo papel e sem participação recente) em um julgamento.

### 7.4 Rerank da busca (Etapa 4)

Uma Score por candidato, todas na mesma requisição (perguntas independentes):

```json
"rel_17": {
  "type": "score",
  "instructions": "How well does `candidates[17].text` answer or match `query`?",
  "criteria": ["Unrelated", "Mentions the topic in passing", "Relevant", "Directly answers the query"]
}
```

Ordem final: `0.7 · score_jev_normalizado + 0.3 · ts_rank_normalizado`. Se a
confiança média ficar abaixo de 0.6, mantém a ordem do FTS. Nunca remove resultados.

### 7.5 "Isso já foi respondido" (Etapa 3)

- **Choice** entre as mensagens fixadas e as últimas respostas marcadas pela reação ✅, mais `none`.
- Sugere o candidato escolhido somente quando `choice ≠ none` e `confidence ≥ 0.75`, e quando o texto
  digitado passa num `noul` "is this a question?" ≥ 0.8.
- Roda com debounce de 1,2 s, só em canais com o recurso ligado.

### 7.6 Triagem de denúncias (Etapa 5)

- **Choice** de categoria: assédio, spam, conteúdo sexual, violência, informação pessoal, fora de tópico ou outra.
- **Score** de gravidade em 4 níveis.
- A fila é ordenada por gravidade × recência. A decisão continua humana.

### 7.7 Cargo a partir de uma descrição (Etapa 5)

- **Um Noul por permissão** (19 hoje em `acoes.ts`) sobre a descrição escrita pelo dono.
- Com `≥ 0.7`, a permissão vem pré-marcada; com `≤ 0.3`, vem desmarcada; entre esses valores, vem desmarcada com o selo "confira".
- **Nunca pré-marca** `group.delete`, `group.manage_roles` nem `group.change_role`.
  Poder sobre pessoas e sobre o grupo é sempre manual.

### 7.8 Sugestão de canal e de modelo de grupo (Etapas 5 e 8)

- **Canal certo:** Choice entre os canais do grupo (nome + tópico) + `none`. Mostra
  "talvez caiba em #suporte" só com `confidence ≥ 0.8`, e nunca move a mensagem.
- **Modelo de grupo:** Choice entre Amigos, Estudo, Time, Jogo e em branco, a
  partir do nome e da descrição. Só pré-seleciona; a pessoa escolhe.

---

## 8. Design System v2

### 8.1 Cor

| Token | Escuro | Claro | Uso |
|---|---|---|---|
| `accent` | `#f59e0b` | `#b45309` | Ação primária, foco, seleção |
| `accentFg` | `#1a1204` | `#ffffff` | Texto sobre o acento |
| `accentSubtle` | `#f59e0b1f` | `#fef3c7` | Menção, canal ativo, não lidas |
| `accentLive` | `#fbbf24` | `#d97706` | **Só** o "no ar": fala e transmissão ao vivo |
| `warning` | `#eab308` | `#a16207` | Aviso, sempre com ícone e texto |
| `danger` | (mantém) | (mantém) | Só perigo |
| `presenceOnline` | (mantém) | (mantém) | Só presença |
| `bgSunken` | `#040507` | `#f1f5f9` | Composer, campos |
| Neutros | (mantém slate) | (mantém) | Base |

**Regras de uso das cores**

- **Contraste:** `tokens.test.ts` exige 4.5:1 para texto e 3:1 para UI em todos os pares.
- **Cores de cargo:** escala OKLCH L 0.72 / C 0.14, com matiz a cada 36° (10 cores + "sem cor").
  Nenhuma pode ser confundida com `danger` ou `presenceOnline`: validar ΔE ≥ 20.

### 8.2 Tipografia

- **Famílias (confirmadas em 2026-09-26):** Geist (UI e texto) e Geist Mono (códigos, números, rótulos técnicos da porta).
  Saem a Inter, a JetBrains Mono e a Space Mono, e fica uma voz só.
  Auto-hospedadas, como hoje.
- **Escala em rem:**

  | 12 | 13 | 14 | **15** | 16 | 20 | 24 |
  |---|---|---|---|---|---|---|
  | legenda mínima | meta | UI | **corpo da mensagem** | títulos de seção | título de tela | título de diálogo |

- **Legibilidade:**
  - nada funcional abaixo de 12px;
  - `line-height` 1.5 no corpo e 1.25 nos títulos;
  - `max-width: 72ch` na mensagem;
  - `tabular-nums` em contadores e horários.
- **Maiúsculas espaçadas:** só nos cabeçalhos de seção da lista (12px, +0.06em) e na porta.

### 8.3 Forma e espaço

- **Raios:** `sm 4` · `md 6` · `lg 10` · `full`, este só em avatar e presença. A pílula isolada do login sai.
- **Ritmo:** 4 e 8px. Mensagem compacta com 2px entre linhas do mesmo autor; confortável com 4px.
- **Sombras:** duas no total, uma para `popover` e outra para `dialog`, curtas (≤ 24px de blur).
  Sai o padrão "borda fina + sombra larga".
- **Cartões:** nada de cartão dentro de cartão. Seção interna usa separador ou `bgSunken`.

### 8.4 Componentes novos ou revistos

| Componente | Pontos-chave |
|---|---|
| `AcoesDaMensagem` | Barra flutuante no canto superior direito da mensagem; aparece no hover ou foco; teclado por Tab; no toque, pressão longa abre uma folha inferior |
| `Mencoes` | Listbox acessível abaixo do textarea no DOM e acima visualmente; avatar e @username |
| `ChipDeMencao` | Fundo `accentSubtle`; o chip de mim mesmo tem peso 600 |
| `AnelDeFala` | Anel de 2px `accentLive` em volta do avatar, com opacidade seguindo o nível de áudio (suavizado a 100 ms); sob reduced-motion vira anel estático |
| `EstadoDaChamada` | Faixa única: conectando (spinner) → conectado (ponto "no ar") → reconectando (âmbar) → falhou (danger + ações) |
| `Silenciar` | Menu com as durações e "até eu reativar"; ícone de sino riscado no canal |
| `Configuracoes` | Casca única com navegação lateral agrupada, altura fixa, rodapé fixo "Salvar / Descartar" quando há mudança (padrão "você tem alterações não salvas") |

### 8.5 Motion e reactbits

Princípio: **no modo Operate, motion informa estado. No modo Persuade (porta e
convite), ele pode encantar.** Sempre sob `MotionConfig reducedMotion="user"`,
que já existe.

| Onde | Efeito (base reactbits ou `ui/bits`) | Duração |
|---|---|---|
| Fala na chamada | `AnelDeFala` (derivado de "Glow") | contínuo, ligado ao áudio |
| Entrar ou sair da chamada | Deslizar + fade da faixa `EstadoDaChamada` | 180 ms |
| Nova mensagem por evento | "Animated List", só a última, sem animar o histórico | 160 ms |
| Reação adicionada | `Faisca` (Click Spark) no botão da reação | 250 ms |
| Contador de não lidas | `Contador`, só quando o número muda por evento | 200 ms |
| Barra de ações | fade 120 ms | 120 ms |
| Porta de entrada | `PalcoMercurio` mais lento e tingido com o acento; `TituloFatiado` na marca uma vez | livre |
| Convite aceito | "Splash Cursor" discreto ou confete curto, **uma vez** | 800 ms |
| **Sai do app** | `TextoDecifrado` no título da voz, `Aurora` fora da porta | — |

---

# PARTE IV — CONTROLE

## 9. Qualidade, métricas e definição de pronto

### 9.1 Definição de pronto (vale para toda tarefa)

- Teste que falha antes e passa depois. Para bug, o teste de regressão vem **primeiro**.
- `npm run typecheck`, `npm run lint` e `npm test` verdes. O pre-commit roda os 795 testes, então a execução leva minutos.
- Invariante no banco quando houver invariante.
- Nova ação de permissão em `acoes.ts`, com descrição.
- Evento novo documentado em `docs/specs/04-protocolo-tempo-real.md`.
- Copy revisada, com acento a partir da Etapa 0.
- Captura em 1440 e 390, nos temas claro e escuro, para qualquer mudança visual.
- `graphify update .` no fim.

### 9.2 Portões de design por etapa

| Portão | Meta |
|---|---|
| Etapa 0 | P0 = 0; `detect.mjs` sem achado novo |
| Etapa 1 | Crítica ≥ 27/40; Lighthouse A11y 100 na conversa; zero `tiny-text` e `line-length` |
| Etapa 3 | Crítica ≥ 29/40; 60 fps com 5 000 mensagens |
| Etapa 6 | Crítica ≥ 32/40; carga cognitiva ≤ 1 falha; zero string sem acento |

A crítica é refeita com `/impeccable critique` no mesmo formato (dois agentes)
para que as notas sejam comparáveis. O snapshot desta rodada fica em `.impeccable/critique/`.

### 9.3 Avaliação dos recursos de IA

Antes de ligar cada recurso:

1. **Conjunto de avaliação** com 200 casos reais anonimizados em pt-BR por
   recurso, rotulados por uma pessoa, cobrindo:
   - brincadeira entre amigos (falso positivo clássico de assédio);
   - gíria;
   - ironia;
   - link legítimo;
   - golpe de Pix.
2. **Métrica por recurso:**
   - automod: precisão ≥ 0.9 na ação "segurar", com recall medido e reportado;
   - rerank: nDCG@10 melhor que o FTS puro;
   - notificação: taxa de "silenciar depois de notificado" abaixo da do nível "tudo".
3. **Revisão:** `ia_decisoes` + as revisões da fila humana alimentam a recalibração mensal dos limiares.

### 9.4 Métricas de produto (visíveis no `/api/metrics`)

- **Ativação:** convite aberto → conta criada → entrou no grupo (funil). Meta: +30% depois da Etapa 0.
- **Retenção:** pessoas que voltam em D1 e D7. Meta: +20% depois da Etapa 2.
- **Voz:** tempo até conectar e taxa de "falhou".
- **Busca:** buscas sem resultado, que viram insumo da Etapa 9.
- **Performance:** p95 das rotas, eventos WS/s e reconexões com `resume` bem-sucedido.

---

## 10. Riscos, dependências e decisões em aberto

### 10.1 Riscos

| Risco | Mitigação |
|---|---|
| Trocar a identidade visual desagradar quem já usa | Validar com capturas antes do merge; o acento é um token só e dá para voltar em um commit |
| FTS pesado em migração com dados | `CREATE INDEX CONCURRENTLY` em migração separada, fora de transação; backup antes (RUNBOOK) |
| Overwrites (B8) vazarem quando a UI existir | A UI só entra no mesmo PR que `canaisVisiveis` e os testes de vazamento |
| Custo ou latência do Jev | Opt-in, orçamento por grupo, cache, circuit breaker e caminho sem IA em todo recurso |
| Falso positivo do automod irritar a comunidade | Nunca apaga; fila humana; limiar alto no início; o autor vê "em revisão", não "removida" |
| Privacidade (LGPD) com a IA | Opt-in explícito, texto mínimo, pseudônimos, sem canal privado por padrão, explicação na aba IA |
| DMs mudarem invariantes do `can()` | As negações ficam concentradas em `ehConversaDireta` e há um teste por negação |
| Suíte lenta no pre-commit | Rodar `npm test` antes; commits por etapa, não por tarefa |

### 10.2 Decisões em aberto (precisam do dono do produto)

Já decididas em 2026-09-26: acento âmbar "no ar" (D1-B) e Geist + Geist Mono
como tipografia única.

1. **Grupos grandes começam com notificação "só menções"?** A proposta usa o limite de 50 membros.
2. **Jev na busca e na notificação:** ligar como padrão para grupos novos, ou sempre opt-in? A recomendação é sempre opt-in.
3. **2FA obrigatório** para donos de grupos grandes?

### 10.3 Ordem de PRs sugerida

1. **Etapa 0** em dois PRs:
   - `fix(web): rascunho por canal, mencoes, convite e fluxos de auth`;
   - `fix(voz): estado unico da chamada, sair da conta e sessoes legiveis`.
2. **Etapa 1** em um PR: `feat(ui): design system v2 — acento no ar, geist, mensagem v2`.
3. **Etapa 2** em dois PRs: roteamento com não lidas, depois notificações com preferências e presença.
4. As etapas seguintes na mesma cadência, cada PR com a crítica do Impeccable anexada quando mudar a interface.
