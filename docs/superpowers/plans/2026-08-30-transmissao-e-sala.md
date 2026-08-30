# Plano — Transmissão e sala

> Roteiro da Fatia 2.5: transformar a chamada de vídeo que existe hoje numa
> **transmissão** com sala em volta. Data: 2026-08-30.
> Status: **rascunho, aguardando aprovação.**

## 1. Por que este plano existe

A Fatia 2 entregou mídia funcionando: qualquer participante transmite áudio,
vídeo e tela, com volume por fonte, tela cheia, mini player e qualidade
escolhível. O que ela não entregou foi a **forma**. Hoje uma tela compartilhada
de 1080p60 aparece como um retângulo de 220px na mesma grade da webcam de quem
está ouvindo, e ler outro canal derruba a chamada.

O sistema tem as peças de um Discord. Falta a montagem.

Este plano cobre sete fases, na ordem em que devem ser feitas. **A ordem não é
negociável entre 0 e 1** — a Fase 0 bloqueia todas as outras. Da Fase 3 em
diante a ordem é preferência, e cada fase tem valor de uso próprio.

## 2. O que já existe, para não reconstruir

Vale registrar, porque metade do trabalho já está feita e não é óbvio olhando a
interface:

| Peça | Onde | Situação |
|---|---|---|
| Volume por fonte, com `audio` e `audio-tela` separados | `midia.ts` `definirVolume` | pronto, e lembrado entre chamadas |
| Tela cheia e mini player (PiP) por faixa | `FaixaDeMidia.tsx` | pronto |
| Qualidade 1080p60/1080p30/720p30 | `midia.ts:176` `QUALIDADES` | pronto, **só para quem publica** |
| `adaptiveStream` + `dynacast` | `midia.ts:362` | ligados |
| Dica de movimento no codec da tela | `midia.ts:430` `dicaDeMovimento` | pronto |
| Quem está falando | `RoomEvent.ActiveSpeakersChanged` → `estado.falando` | pronto, mas só pinta o nome na lista |
| Desbloqueio de autoplay | `PainelDeVoz.tsx`, botão "Ativar o som" | pronto |
| Reações, respostas, menções | `docs/superpowers/specs/2026-08-29-chat-rico-design.md` | **especificado, zero implementado** |

Confirmado por busca: não há nenhuma tabela, tipo ou rota de `reaction`,
`reply` ou `mention` no código. O tipo `Mensagem` em `web/src/lib/tipos.ts` só
tem `attachments`.

---

## Fase 0 — O som

**Custo: desconhecido. É por isso que ela é a Fase 0.**

`prompt.md` registra que o som não funciona. Não há plano de correção aqui
porque **ainda não houve diagnóstico**, e escrever a correção antes de
reproduzir o defeito é como escolher o remédio antes do exame. O que segue é o
protocolo de diagnóstico, com as hipóteses ordenadas por custo de teste.

### 0.1 Reproduzir primeiro, sempre

Antes de qualquer edição, estabelecer o caso mínimo:

- Duas abas, dois usuários, mesmo canal de voz.
- O microfone de A chega em B? A tela de A com som chega em B?
- O medidor de nível de A se move? (Isso separa "não captura" de "não entrega".)

O medidor é o divisor de águas: ele é alimentado por `createAudioAnalyser` na
faixa **local**. Se ele se move, a captura está viva e o defeito é de entrega ou
reprodução. Se não se move, o defeito é de captura ou permissão.

### 0.2 Hipóteses, da mais barata para a mais cara

**H1 — Volume 0 fossilizado no `localStorage`.**
`lerVolumes()` restaura volumes de chamadas anteriores, e
`RoomEvent.TrackSubscribed` aplica o valor guardado **antes do primeiro
pacote**. Um `0` gravado durante um teste antigo silencia aquela pessoa para
sempre, e o defeito viaja com o navegador, não com o código.
*Teste:* `localStorage.removeItem('altcast:volumes')` e recarregar.
*Custo: segundos.*

**H2 — Autoplay bloqueado sem o evento que avisa.**
`estado.audioBloqueado` só é escrito dentro de
`RoomEvent.AudioPlaybackStatusChanged`. Em `entrar()`, logo depois do
`connect`, **ninguém lê `sala.canPlaybackAudio`**. Se a sala conecta já
bloqueada e o evento não dispara na transição inicial, o botão "Ativar o som"
nunca é renderizado e o áudio morre em silêncio — sem erro, sem aviso.
*Teste:* logar `s.canPlaybackAudio` imediatamente após o `connect`.
*Custo: minutos. Se confirmada, a correção é uma linha e vale de qualquer
forma:* ler o estado na entrada em vez de só reagir ao evento.

**H3 — `papelDe` devolvendo `null` e descartando a faixa calada.**
Em `TrackSubscribed` há `if (papel === null) return`. Uma fonte que o
classificador não reconheça é descartada sem rastro nenhum. É o formato
clássico de falha silenciosa.
*Teste:* instrumentar o `return` com o `source` da publicação.
*Custo: minutos.*

**H4 — Servidor de mídia.** Configuração do LiveKit, TURN, codec de áudio.
*É a última hipótese de propósito:* se o vídeo chega e o áudio não, os dois
usam o mesmo transporte, o que torna a causa comum improvável.

### 0.3 Critério de saída

Não é "o som voltou". É:

- Um teste automatizado que falha com o defeito presente e passa sem ele.
- O caso de duas abas verificado à mão, microfone **e** som de tela.
- Se a causa for H2, o `canPlaybackAudio` passa a ser lido na entrada,
  independentemente de ter sido ela a causa.

**Nenhuma fase seguinte começa antes deste critério.** Palco e chat ao lado de
uma transmissão muda não valem nada.

---

## Fase 1 — Modo palco

**Custo: baixo. Ganho: o maior da lista.**

### O problema

`PainelDeVoz.tsx` monta os vídeos em
`grid-cols-[repeat(auto-fit,minmax(220px,1fr))]`. Cada faixa recebe peso igual.
A consequência é que a coisa que a sala inteira veio ver — a tela compartilhada
— divide o espaço em pé de igualdade com uma webcam parada.

### A forma

Um **palco** e uma **fita**. O palco ocupa a área toda menos uma faixa; a fita
guarda as outras faixas como miniaturas, na horizontal embaixo ou na vertical
ao lado, conforme a largura.

### Quem sobe ao palco, e por quê

A escolha automática precisa acertar sozinha na maioria esmagadora das vezes,
porque ninguém quer clicar para arrumar a tela toda vez que alguém entra:

1. Uma faixa fixada à mão pela pessoa, se houver. **Escolha manual sempre
   ganha** — se eu fixei, é porque o automático errou, e desfazer minha escolha
   seria errar duas vezes.
2. Senão, a tela compartilhada mais recente.
3. Senão, quem está falando (com histerese — veja abaixo).
4. Senão, a primeira câmera.
5. Senão, sem palco: cai na grade de hoje.

**A histerese não é detalhe.** `ActiveSpeakersChanged` dispara a cada sílaba.
Trocar o palco a cada disparo produz um estroboscópio numa conversa de quatro
pessoas. Regra: só troca depois de ~2s de fala contínua, e nunca desmonta uma
tela compartilhada — quem está mostrando algo continua no palco mesmo calado.

### Interação

- Clique numa miniatura → aquela faixa vira o palco e fica **fixada**.
- Clique no fixado → desfixa, volta ao automático.
- Duplo clique no palco → tela cheia (reusa o `alternarCheia` que já existe).
- Um botão de alternância "palco / grade", lembrado no `localStorage` ao lado
  de `altcast:qualidade-da-tela`.

### Arquivos

- `PainelDeVoz.tsx` — deixa de montar a grade; passa a escolher palco e fita.
- **Novo** `web/src/features/voice/palco.ts` — a função pura de escolha, e nada
  mais. Separada de propósito: a regra acima tem cinco ramos e histerese, e
  testar isso dentro de um componente React custa dez vezes mais do que testar
  uma função que recebe faixas e devolve um `sid`.
- `FaixaDeMidia.tsx` — ganha uma prop de tamanho (`palco` | `miniatura`). As
  miniaturas não mostram controles de volume: numa faixa de 120px o cursor não
  cabe e o alvo de toque fica abaixo do mínimo de acessibilidade.

### Acessibilidade

A fita é uma lista de botões de verdade, navegável por Tab, cada um com
`aria-pressed` para o estado de fixado. A troca de palco anuncia numa
`role="status"` — mas **só a troca manual**. Anunciar cada troca automática
transformaria o leitor de tela numa metralhadora, exatamente o que o comentário
em `PainelDeVoz.tsx` já evita para as entradas de participante.

---

## Fase 2 — Chat ao lado do palco

**Custo: baixo. Ganho: o segundo maior.**

### O problema

`Conversa.tsx` decide a coluna inteira pelo tipo do canal:

> *"Canal de voz não tem histórico nem escrita: mostrar um composer
> desabilitado embaixo da chamada seria oferecer uma ação que o canal não
> tem."*

O raciocínio estava certo para a Fatia 2 e está errado agora. A conclusão
dependia de canal de voz não ter histórico — o que é uma decisão, não uma lei.
Twitch e Discord provam o contrário todo dia: a conversa **durante** a
transmissão é metade do produto.

### A decisão

Canal de voz passa a ter histórico de texto, como qualquer outro canal. Não é
um chat novo, efêmero, paralelo: é o mesmo `messages` com o mesmo `channelId`,
persistente, com o mesmo fan-out do WebSocket. Isso é o que torna a fase barata
— `MessageList` e `Composer` entram como estão, sem uma linha de backend.

*Verificar antes de começar:* se alguma rota da API recusa escrita em canal
`type = 'voice'`, é aí que mora o trabalho de servidor desta fase. Se não
recusa, a fase é só frontend.

### A forma

Palco à esquerda, chat numa coluna de ~320px à direita. Abaixo de 1000px o chat
vira uma aba sobre o palco — dividir 360px de largura entre vídeo e conversa não
entrega nenhum dos dois. Alternável e lembrado.

### Arquivos

- `Conversa.tsx` — o ramo de voz passa a renderizar palco **e** conversa.
- `AppShell.tsx` — nada, se a coluna nascer dentro de `Conversa`. Preferível.

---

## Fase 3 — Qualidade escolhida por quem assiste

**Custo: médio. Ganho: alto.**

### O problema

`definirQualidade` (`midia.ts:768`) controla o que **eu publico**. Quem assiste
não tem escolha: depende do `adaptiveStream`, que decide por área na tela e não
por banda de quem recebe. A queixa "travou pra mim" hoje só tem uma saída —
pedir para quem transmite baixar a qualidade **para todo mundo**.

O YouTube resolveu isso há quinze anos com um menu.

### A forma

No canto de cada faixa remota, um seletor: **Automático / Alta / Média /
Baixa**. Automático é o padrão e é o comportamento de hoje.

O LiveKit expõe `setVideoQuality()` na `RemoteTrackPublication`. Escolher uma
qualidade fixa desliga o adaptativo **para aquela faixa**, e só para ela.

### O ponto que exige cuidado

Isto é a primeira preferência de recepção do sistema, e ela **não pode** morar
junto de `altcast:volumes`. Volume é preferência sobre uma pessoa; qualidade é
preferência sobre uma máquina e uma rede. Chave nova, escopo por faixa, e um
reset ao sair da chamada — a rede de ontem não é a de hoje.

### Extra barato, mesmo pacote

`RoomEvent.ConnectionQualityChanged` já existe no LiveKit. Três barrinhas ao
lado do nome custam quase nada e respondem sozinhas a metade das perguntas de
suporte que uma transmissão gera.

### Arquivos

- `midia.ts` — `definirQualidadeDeRecepcao(sid, nivel)`, e o estado por faixa.
- `FaixaDeMidia.tsx` — o seletor, ao lado dos botões que já existem.

---

## Fase 4 — Chamada persistente

**Custo: alto. É arquitetura, não interface.**

### O problema

`useChamada.ts` derruba a chamada quando `channelId` muda:

> *"Sair no desmonte cobre os dois casos que mais deixam microfone aberto:
> trocar de canal e fechar a aba."*

O comentário defende uma decisão real e boa — microfone aberto por engano é um
defeito sério. Mas o preço é que **ler outro canal custa a chamada**. No
Discord você navega o servidor inteiro e a chamada segue numa barra no rodapé.

### Por que é caro

A chamada hoje é estado de um componente. Precisa virar estado da aplicação —
uma chamada por vez, dona do seu ciclo de vida, sobrevivendo à navegação e
morrendo só por clique explícito ou fechamento da aba.

Isso significa mover a chamada de `useChamada` para a store (`lib/store.ts`), e
`PainelDeVoz` passa a ser uma **vista** de um estado que ele não possui mais.

### O que não pode regredir

A proteção que o desmonte dava precisa continuar existindo por outro caminho:

- `beforeunload` / `pagehide` ainda derruba a chamada ao fechar a aba.
- Entrar num segundo canal de voz derruba o primeiro, explicitamente.
- A barra persistente mostra **sempre** o estado do microfone. É ela que
  substitui a garantia perdida: o microfone aberto fica visível em toda tela do
  sistema, o tempo todo.

### A barra

Rodapé, ao lado de `BarraConexao`: nome do canal, quem está falando, mudo,
ensurdecer, sair, e um clique que volta para o canal da chamada.

### Arquivos

- `lib/store.ts` — passa a hospedar a chamada.
- `useChamada.ts` — vira um seletor da store; perde o ciclo de vida.
- **Novo** `web/src/features/voice/BarraDeChamada.tsx`.
- `AppShell.tsx` — monta a barra acima de `BarraConexao`.

### Aviso de sequenciamento

Esta fase reescreve a dona do estado que as Fases 1 e 3 leem. Fazê-la **depois**
delas é deliberado: mexer na arquitetura primeiro obrigaria a refazer palco e
qualidade em cima de um alvo móvel. Se a ordem mudar, este é o custo.

---

## Fase 5 — Push-to-talk, ensurdecer, supressão de ruído

**Custo: médio. Ganho: alto. É a fase que "parece Discord".**

Três itens independentes, agrupados por afinidade:

**Push-to-talk.** Uma tecla configurável mantém o microfone ligado enquanto
pressionada. Precisa de um `keydown`/`keyup` global, um atraso de soltura de
~200ms (sem ele a última sílaba é cortada), e um indicador visível — o modo tem
de ser óbvio, senão vira microfone que "não funciona".
*Limite conhecido:* fora da aba, o navegador não entrega a tecla. Uma extensão
resolveria; está fora de escopo. Documentar em vez de esconder.

**Ensurdecer.** Silencia tudo de uma vez, e silencia o próprio microfone junto —
é o que a palavra significa em toda ferramenta que a usa: "saí um pouco".
Precisa **não** destruir os volumes individuais: é um interruptor por cima, não
um `definirVolume(0)` em cada faixa.

**Supressão de ruído e eco.** `noiseSuppression`, `echoCancellation` e
`autoGainControl` já existem no `getUserMedia`; o sistema simplesmente não os
oferece. Três interruptores em `ConfiguracaoDeMidia.tsx`, guardados junto das
preferências de dispositivo — são preferência de máquina, mesma justificativa
que já está escrita lá.

**Atalhos, no mesmo pacote:** `M` mudo, `D` ensurdecer, `F` tela cheia no palco.
`AppShell.tsx` já tem um registrador de atalhos globais (`Alt`+setas) para
seguir de modelo — e a mesma regra: nunca capturar tecla com o foco num campo
de texto.

---

## Fase 6 — Chat rico

**Custo: alto. Ganho: médio — e é por isso que fica por último.**

A especificação já está escrita e aprovada em
`docs/superpowers/specs/2026-08-29-chat-rico-design.md`: reações, respostas
encadeadas, menções resolvidas na escrita, e não-lidos por canal. Migrações,
autorização, tempo real e fatiamento estão todos lá.

**Este plano não redesenha nada disso.** Quando a fase chegar, o caminho é
executar aquela spec via `writing-plans`, não reabrir a discussão.

Fica por último por uma razão só: chat rico melhora uma coisa que **já
funciona**. As fases 0 a 5 fazem funcionar coisas que hoje não funcionam, ou não
existem.

---

## 3. Decisões que atravessam o plano

**D-A. Nenhuma fase quebra o que já é acessível.** O sistema tem WCAG 2.2 AA
verificado em teste (`web/test/helpers/axe.ts`, `contrast.ts`). Palco, fita,
barra de chamada e seletor de qualidade entram com rótulo, foco e alvo mínimo,
ou não entram.

**D-B. A camada de mídia continua sendo o único lugar que conhece o LiveKit.**
`midia.ts` é a fronteira declarada na spec 01. `setVideoQuality` e
`ConnectionQuality` entram atrás dela, expostos como "qualidade" e "sinal". Um
componente que importe `livekit-client` viola a spec.

**D-C. Escolha manual sempre ganha da automática.** Vale para o palco, para o
volume e para a qualidade. O automático é um palpite; quando a pessoa corrige o
palpite, ela está dizendo que ele errou.

**D-D. Preferência de máquina no `localStorage`, preferência de conta no
servidor.** Já é o critério em vigor para dispositivo, volume e qualidade de
publicação. Tudo que este plano adiciona é de máquina.

## 4. Testes

O projeto tem vitest com testes por feature (`web/test/voice-panel.test.tsx`,
`midia.test.ts`, `faixa-de-midia.test.tsx`) e Playwright em `e2e/`. Cada fase
segue o padrão que já existe:

| Fase | O que precisa de teste |
|---|---|
| 0 | Um teste que **falha antes** da correção. Sem isso não há correção, há coincidência. |
| 1 | `palco.ts` puro: os cinco ramos, a histerese, e o fixado vencendo o automático. |
| 2 | Canal de voz renderiza histórico e composer; mensagem enviada de dentro da chamada aparece. |
| 3 | Escolher qualidade chama a camada de mídia; sair da chamada limpa a escolha. |
| 4 | Trocar de canal **mantém** a chamada; entrar noutro canal de voz derruba a anterior; fechar a aba derruba. |
| 5 | Soltar a tecla desliga o microfone após o atraso; ensurdecer preserva os volumes individuais. |

## 5. Riscos

**O maior:** a Fase 0 pode ser cara. Se o defeito for de servidor (H4), o custo
não é de frontend e o cronograma inteiro desloca. Por isso o diagnóstico vem
antes de qualquer promessa de prazo.

**O segundo:** a Fase 4 toca a store, que tudo lê. Ela é a única fase deste
plano que pode quebrar coisas não relacionadas. Merece a própria branch e a
própria revisão.

**O terceiro:** palco automático que erra é pior que grade que não decide nada.
A histerese e a regra "tela compartilhada não sai do palco" são a defesa; se na
prática elas não bastarem, o botão de grade é a saída de emergência — e é por
isso que ele existe desde a Fase 1.

## 6. Fora de escopo

Gravação de transmissão, emotes, clipes, sobreposição de alertas, chat com
moderação automática, transmissão para fora do grupo. A spec 00 já exclui
gravação e federação; os demais são caminho de plataforma pública, e o Altcast é
um círculo fechado por decisão de arquitetura.
