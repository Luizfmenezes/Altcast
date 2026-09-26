# Proposta — Roadmap para um Altcast profissional

Data: 2026-09-26 · Status: proposta (nada implementado)

Levantamento feito lendo o código em `8cd4118` (api, web, desktop, docs/propostas),
com o detector do Impeccable sobre `web/src` e a documentação ao vivo do TypeSafe.
Cada item cita onde o problema está. Organizado pela jornada do usuário e, no fim,
em ondas de entrega.

---

## 0. Consertar antes de construir (bugs reais, confirmados no código)

| # | Problema | Onde | Efeito para o usuário |
|---|---|---|---|
| B1 | `<Conversa>`/`<Composer>` sem `key` do canal | `web/src/AppShell.tsx:457`, `Composer.tsx` | Rascunho, resposta e **anexo** vão junto ao trocar de canal. Anexo subido no canal A sai no canal B |
| B2 | Menções usam `members` de todos os grupos | `Composer.tsx:57,143` | Sugere pessoas de outro grupo; `key` duplicada; Enter envia em vez de escolher |
| B3 | Sucesso de verificação/reset chama `trocarPor({nome:'entrar'})` | `VerificarEmail.tsx:35`, `RedefinirSenha.tsx:33` | As telas "e-mail confirmado" e "senha trocada" nunca aparecem |
| B4 | `/verificar/<token>` com sessão aberta cai no AppShell | `App.tsx` | Justamente quem vê a faixa "confirme seu e-mail" não consegue confirmar |
| B5 | Convite + "já tenho conta" perde o código | `TelaAuth`/`Login` | Convite some no caminho do login |
| B6 | "Tentar de novo" reenvia sem anexos nem `replyToId` | `features/messages/envio.ts` | Reenvio perde conteúdo |
| B7 | Paginação sem trava e sem preservar o scroll | `MessageList.tsx` | Rajada de requisições, pulo de posição e falso "Novas mensagens" |
| B8 | Overwrites de canal não valem em listagem, `ready` e fanout | `channels.routes.ts:181`, `gateway.ts:52`, `realtime/fanout.ts:31`, `typing` em `gateway.ts:154` | Latente: hoje não há rota que crie overwrite. **Vira vazamento no dia em que a UI de permissões por canal existir.** Corrigir junto com ela |
| B9 | Latência dentro de `aria-live` | `presence/BarraConexao.tsx` | O leitor de tela anuncia a cada ping |
| B10 | Paleta promete Enter, mas não tem item ativo; membros duplicados | `busca/PaletaDeComandos.tsx` | Ctrl+K parece quebrado |
| B11 | Critérios de admin divergentes (papel × permissão) | `PainelDoUsuario` × `possoNoGrupo` | Cargo customizado vê o menu, mas não a aba |
| B12 | Não lidas contadas só em memória | `naoLidasDoCanal` | Canal nunca aberto mostra 0; o ponto na BarraGrupos quase nunca acende |

Pequenos: `BarraGrupos` sem `overflow-y-auto`; `?erro=google` fica na URL; a URL fica em
`/entrar` depois do login; `already_member` busca o grupo pelo **nome**
(`AceitarConvite.tsx`); `Kbd` mostra "Ctrl" no Mac; erro de histórico engolido
(`.catch(()=>undefined)`) e sem estado de carregando.

**Texto:** toda a interface está sem acentos ("Nao foi possivel", "Voce"). É o problema
visual mais visível do produto e o mais barato de corrigir.

---

## 1. Entrar (primeiro acesso)

Hoje: login, cadastro, Google com PKCE, verificação, reset e prévia de convite. Falta:

- **Deep links e histórico:** rotas `/g/:grupo/c/:canal/m/:msg` com Voltar do navegador.
  Base para notificação clicável, link de mensagem e "copiar link".
- **Senha:** botão de mostrar, validação no cliente com medidor (a regra de 12 caracteres
  hoje é só dica), `autocomplete` correto.
- **Segurança da conta:** 2FA TOTP com códigos de recuperação, depois passkeys (WebAuthn).
  A tabela `sessions` já guarda userAgent/IP: mostrar "Chrome no Windows · São Paulo ·
  agora" em vez do user-agent cru, e avisar por e-mail em login de dispositivo novo.
- **LGPD:** exportar meus dados (zip JSON + anexos) e excluir conta com carência de 14 dias.
  Bloqueio atual: `groups.ownerId` é RESTRICT (`schema.ts:122`), então é preciso antes
  **transferir a titularidade** do grupo, que também falta.

## 2. Primeiro grupo (onboarding)

- **Modelos de grupo** (Amigos, Estudo, Time, Jogo): criam canais, cargos e mensagem de
  boas-vindas prontos.
- **Checklist do dono** no canal inicial: ícone → convidar 1 pessoa → criar canal de voz →
  primeira mensagem. Some quando completa.
- **Tela de boas-vindas do grupo** para quem entra: regras, canais sugeridos e um "diga oi".
- Convite com **prévia rica** (ícone, membros online/total) também no Open Graph, para o
  link ficar bonito no WhatsApp.

## 3. Conversar (o coração do produto)

Por ordem de retorno:

1. **UI de editar/apagar** (o backend já tem PATCH/DELETE e os eventos, falta a tela), e ↑
   para editar a última mensagem.
2. **Markdown seguro** (negrito, itálico, código, bloco com realce, spoiler, citação) e
   links clicáveis com `rel="noopener noreferrer"`.
3. **Seletor de emoji completo** com busca e recentes; "quem reagiu" em tooltip.
4. **Menções de verdade:** destaque visual, navegação por setas, suporte a nomes com espaço
   (buscar por `username`), `@cargo`, e contagem de menções no servidor.
5. **Busca de mensagens:** Postgres `tsvector` com configuração `portuguese` e índice GIN.
   Filtros `de:`, `em:`, `tem:arquivo`, `antes:`/`depois:`. Resultado abre no contexto (usa os deep links).
6. **Fixar mensagens** (coluna `pinnedAt` + painel "Fixadas").
7. **Previews de link** (Open Graph buscado no servidor com proteção SSRF: bloquear IP
   privado, timeout, limite de bytes) e lightbox de imagens.
8. **Virtualização** da lista (`@tanstack/react-virtual`) e abrir no **primeiro não lido**.
9. **Threads**, depois de DM: são o recurso mais caro deste bloco.
10. Ações de mensagem só no **hover/foco** (hoje aparecem em todas, o que gera ruído) e menu de contexto (botão direito).

## 4. Mensagens diretas e presença

A proposta `2026-09-10-mensagens-diretas.md` segue sem nada implementado. É a maior
ausência para uso diário:

- DM 1:1 e DM em grupo (até 10), com ligação de voz reaproveitando o LiveKit.
- **Status:** online / ausente (inatividade automática) / não perturbe / invisível, mais
  status personalizado com emoji e validade.
- **Bloquear usuário:** some das DMs, não recebe menção e as mensagens aparecem recolhidas.
- "Pedido de amizade" é opcional: dá para começar só com "pessoas com quem divido grupo".

## 5. Voz e tela

Já é forte: dispositivos, supressão, PTT, volume por pessoa, tela com qualidade, PiP.
Falta:

- Indicador de fala **além da cor**: anel animado no avatar e no roster da lista de canais
  (hoje só `text-accent`, o que falha o WCAG 1.4.1).
- Tecla de PTT configurável; sensibilidade de entrada (VAD) com barra; **teste de
  microfone** fora da chamada; aplicar o tratamento de áudio sem precisar reentrar.
- **Moderação na sala:** silenciar ou remover alguém (hoje só no token do LiveKit,
  `channels.routes.ts:424`) e mutar alguém localmente.
- A proposta de qualidade de transmissão ainda tem pendentes: tela preta via `getStats`,
  recuperação por quadro-chave e simulcast.
- Soundboard e canal de **palco** (o enum só tem `text`/`voice`, `schema.ts:20`) ficam para depois.

## 6. Notificações (loop de atenção)

A proposta `2026-09-10-loop-de-atencao.md` está quase toda pendente (só §3.5 foi feito):

- Contagem de não lidas e de menções **no `ready`** e atualizada por evento.
- Web Notification API (clicável, abre o deep link), som de menção, **título da aba**
  `(3) Altcast`, badge no favicon, `setBadgeCount` no Electron.
- **Preferências** por grupo e canal: tudo / só menções / nada, e silenciar por
  15 min, 1 h, 8 h ou até eu reativar.
- Pular para o próximo não lido com Alt+Shift+↑/↓.

## 7. Moderação e confiança

- **Ban** (com remoção das mensagens das últimas 24 h ou 7 dias), **timeout**, **slowmode** por canal.
- **Log de auditoria** (hoje fora de escopo em `cargos-e-permissoes.md:180`): quem fez o
  quê, quando e em quem, filtrável. Sem ele, cargos delegados não dão confiança ao dono.
- **Denúncia** de mensagem, que chega a quem tem `group.moderate`.
- **UI de permissões por canal** (overwrites), junto com a correção B8.
- **Automod** (ver §10, com Jev).

## 8. Personalização e interface

- **Configurações reorganizadas** (hoje "Aparência" fica dentro de "Conta" e o grupo aparece
  em dois lugares). Proposta de estrutura, estilo Discord:
  - Minha conta · Perfil · Privacidade e segurança · Dispositivos
  - Aparência · Acessibilidade · Voz e vídeo · Notificações · Atalhos · Idioma
  - Busca dentro das configurações.
- **Aparência:** "seguir o sistema"; **cor de destaque** (tokens já estão em
  `ui/tokens.css`, basta derivar a escala em OKLCH); tamanho de fonte da conversa; zoom;
  modo compacto estilo IRC; alto contraste; temas extras (OLED, sépia).
- **Perfil:** banner, bio, pronomes, cor do perfil e **apelido por grupo**.
- **Grupo:** banner, descrição, canal de regras, **categorias de canais** com
  arrastar para reordenar, **emojis customizados**.
- **Mobile:** barra de grupos de 64 px fixa mesmo em 320 px. Trocar por navegação por
  gestos (deslizar grupos ↔ canais ↔ conversa ↔ membros), backdrop, clique fora e focus
  trap nas gavetas.
- **Atalhos:** tela listando todos (Ctrl+/), Ctrl+Alt+↑/↓ entre grupos, Esc em camadas
  (fecha só a camada de cima e cancela a resposta).
- **i18n:** extrair strings (ex.: `i18next`) já corrigindo a acentuação. pt-BR como
  fonte, inglês depois.

### Motion e reactbits

O projeto já tem `ui/bits` (Aurora, Contador, Faísca, TextoDecifrado, TítuloFatiado) e
respeita `prefers-reduced-motion`. Usar motion onde ele **informa**, não como enfeite no app:

- Anel de fala pulsante (o "Glow"/"Ripple" do reactbits) no avatar em chamada.
- Contador de não lidas com "Counter" animado (já existe `Contador.tsx`).
- "Animated List" na entrada de novas mensagens e no roster de voz.
- "Click Spark" (`Faisca.tsx`) em reações.
- Aurora e TextoDecifrado só em superfícies de **persuasão** (login, convite, estados vazios), nunca na conversa.
- O detector achou 5 pontos leves: bounce-easing em `mercurio.css:168`, side-tab em
  `Composer.tsx:259`, borda de destaque em `Abas.tsx:63` e Inter como fonte única
  (`fontes.css`). Uma fonte display com personalidade nos títulos e na marca daria identidade própria ao produto.

## 9. Plataforma e operação (o "profissional" invisível)

- **Gateway com sequência e resume:** hoje toda reconexão refaz o `ready` inteiro e perde o
  que ocorreu no intervalo.
- **Escala horizontal:** presença, chamadas e rate limit vivem em memória. Com Redis
  (pub/sub + store do `@fastify/rate-limit`) dá para ter mais de uma instância.
- **Observabilidade:** `/api/metrics` em formato Prometheus, tracing OpenTelemetry,
  Sentry no web e no desktop, alertas.
- **Backups:** incluir o armazenamento de anexos (hoje só o banco), agendar e copiar para fora da VM.
- **Uploads:** antivírus (ClamAV) assíncrono antes de liberar o download.
- **Desktop:** auto-update, início com o Windows, notificações nativas.

## 10. Recursos de IA com TypeSafe (Jev)

Julgamentos tipados e rápidos (~150 ms), sempre **no servidor** (`api/`). A chave
`TYPESAFE_API_KEY` já está no `.env`, mas nada a lê: é preciso ligá-la em `api/src/env.ts` e
no `docker-compose.yml`. O código decide o que fazer; o Jev só responde a pergunta
semântica. Cada recurso é opcional por grupo e desligado por padrão.

| Recurso | Primitivo | Estado enviado | O que o código faz |
|---|---|---|---|
| **Automod com regras do dono** | Noul por regra ("contém assédio?", "é spam/golpe?", "viola a regra 3 do grupo?") | mensagem + regras escritas pelo dono | Acima do limiar: segura a mensagem e manda para a fila de moderação; nunca apaga sozinho. Regras em linguagem natural, sem regex |
| **Triagem de notificação** | Score "quanto isto exige a atenção de `user`" | mensagem, canal, se há menção, histórico curto | No modo "só o importante", notifica acima do limiar. Ajuda muito em grupos grandes |
| **Rerank da busca** | Score de relevância por candidato | query + top 50 do `tsvector` | Reordena. A busca continua funcionando sem IA |
| **Pergunta já respondida** | Choice entre mensagens fixadas/recentes + "nenhuma" | pergunta nova + candidatas | Sugere "isso foi respondido aqui" antes de enviar |
| **Roteamento de canal** | Choice entre canais do grupo | mensagem + nomes e descrições dos canais | Sugere "talvez caiba em #suporte" |
| **Triagem de denúncia** | Choice de categoria + Score de gravidade | mensagem denunciada + contexto | Ordena a fila do moderador por gravidade |
| **Cargo a partir de descrição** | Noul por permissão | "quem pode organizar eventos mas não expulsar" + lista de permissões | Pré-marca as caixas; o dono confirma |

Com um limiar calibrado nos dados do próprio grupo, o custo por mensagem é baixo o
suficiente para rodar o automod em toda mensagem.

---

## Ondas de entrega

| Onda | Conteúdo | Por quê primeiro |
|---|---|---|
| **1. Confiança** | B1–B12, acentuação, UI de editar/apagar, menções corrigidas | Bugs que fazem o produto parecer quebrado; a maioria é pequena |
| **2. Atenção** | Não lidas/menções no servidor, notificações, mute, título/badge, deep links | Faz as pessoas voltarem ao app |
| **3. Conversa rica** | Markdown, emoji picker, busca (+rerank Jev), fixar, previews, virtualização | Paridade com o que o usuário espera de um chat |
| **4. Social** | DMs, status, bloquear, perfil rico | Uso diário fora dos grupos |
| **5. Comunidade** | Moderação completa, auditoria, overwrites (com B8), automod Jev, modelos de grupo, categorias, emojis | Grupos maiores e delegação segura |
| **6. Polimento** | Reorganização das configurações, cor de destaque, mobile por gestos, i18n, motion informativo | Identidade e acessibilidade |
| **7. Plataforma** | Resume, Redis, observabilidade, backups completos, 2FA/passkeys, LGPD, antivírus | Operação séria e escala |

Cada onda cabe em um ou dois PRs, na mesma cadência dos commits atuais.
