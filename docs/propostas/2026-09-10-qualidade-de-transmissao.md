# Proposta — Qualidade de transmissão e o fim da tela preta

> Data: 2026-09-10. Status: **proposta. Não passou por brainstorming nem por
> aprovação.**
>
> Diferente das outras três propostas, esta não é sobre parecer com o Discord.
> É sobre a transmissão funcionar — e "está preto" é a queixa que destrói a
> confiança no produto mais rápido do que qualquer feature ausente a constrói.

## 1. O ponto de partida

A camada de mídia já foi afinada com cuidado, e várias armadilhas conhecidas já
estão desarmadas em `web/src/lib/midia.ts`:

| Já resolvido | Onde |
|---|---|
| 60 fps pedidos na **captura**, não só na codificação | `QUALIDADES` (`midia.ts:203`) |
| Camada de reserva a 720p30, no lugar dos 360p a 3 fps do SDK | `screenShareSimulcastLayers` (`midia.ts:499`) |
| `degradationPreference: 'maintain-framerate'` | `salaPadrao()` (`midia.ts:505`) |
| `contentHint = 'motion'` na faixa de tela | `dicaDeMovimento()` (`midia.ts:557`) |
| `pixelDensity: 'screen'`, contra o texto borrado em tela densa | `salaPadrao()` (`midia.ts:486`) |
| Som do sistema em captura de janela no Windows | `desktop/src/captura.ts` |
| Qualidade de recepção por faixa, escolhida por quem recebe | `definirQualidadeDeRecepcao` |

**Tela preta é outro problema.** Congelar é a transmissão chegando devagar;
preto é a transmissão não chegando. As causas são diferentes, e nenhuma das
afinações acima toca nelas.

## 2. As causas, separadas por onde nascem

### Na origem — o que o Windows entrega ao capturar

1. **Janela minimizada.** No Windows a captura de uma janela minimizada devolve
   preto ou o último quadro congelado. Não há erro em lugar nenhum: a captura
   "funciona" e o conteúdo é preto.
2. **Janela acelerada por hardware** — um jogo, outro navegador, um app Electron
   — capturada pelo caminho antigo do Chromium (GDI/DWM). É a causa clássica da
   tela preta de jogo. O caminho novo (Windows Graphics Capture) resolve, e é
   um *feature flag* do Chromium, não código nosso.
3. **Duas GPUs no mesmo notebook.** A janela desenha na GPU dedicada e a captura
   lê da integrada. Resultado: preto.
4. **Tela cheia exclusiva.** O jogo contorna o compositor; não há o que capturar.
5. **Janela protegida** (`SetWindowDisplayAffinity`, conteúdo com DRM). Preto
   **por desenho** do sistema operacional — nada a corrigir, tudo a explicar.

### No envio

6. **Sufoco de CPU.** O padrão hoje é `1080p60` a 8 Mb/s (`QUALIDADE_PADRAO`,
   `midia.ts`) em VP8, que o navegador codifica por **software**. Numa máquina
   modesta o codificador não acompanha, `framesEncoded` para de subir, e a sala
   vê congelado — ou preto, se parar antes do primeiro quadro-chave.
7. **`dynacast` pausa a camada que ninguém assiste.** Correto e desejável; o
   efeito colateral é que, ao voltar a assistir, há preto até o próximo
   quadro-chave chegar.

### Na recepção

8. **`adaptiveStream` pausa faixa cujo elemento não está visível** — área zero,
   `display: none`, aba em segundo plano. Ao reaparecer, preto até o
   quadro-chave.
9. **Perda do quadro-chave.** Um pacote perdido na hora errada deixa preto até o
   próximo, que pode demorar segundos.
10. **Remontagem do elemento de vídeo.** No `PainelDeVoz`, a mesma faixa é
    renderizada em **dois lugares diferentes da árvore** — no palco e na fita de
    miniaturas. A `key` é estável (`idDaFaixa`), mas mudar de pai desmonta e
    remonta o componente, e o `useEffect` de `FaixaDeMidia` faz `detach` seguido
    de `attach`. Toda troca de palco custa um piscar de preto, e ele é nosso,
    não da rede.

## 3. O que propor, em ordem de retorno

### 3.1 Saber que está preto — antes de a pessoa reclamar

Nada disso se conserta às cegas. O primeiro passo não é uma correção, é um
instrumento.

`RTCPeerConnection.getStats()` já responde tudo o que falta, e o LiveKit expõe
o acesso. Amostrando a cada dois segundos:

- **Publicando:** `framesSent`, `framesEncoded`, `qualityLimitationReason`
  (`cpu`, `bandwidth` ou `none`). Se `framesEncoded` não sobe, o problema é
  daqui, e `qualityLimitationReason` diz qual dos dois é.
- **Recebendo:** `framesDecoded`, `freezeCount`, `totalFreezesDuration`,
  `framesDropped`. Se `framesDecoded` não sobe enquanto a publicação continua
  ativa, está preto — e isso é um **fato observável**, não uma suspeita.

Vira duas coisas na interface:

- Um aviso para quem transmite: *"Sua transmissão está parada há 6 s — o
  computador não está dando conta de codificar."* Com a causa, e com o botão que
  resolve (§3.4).
- Uma linha no painel de estatísticas por participante, que já existe em forma
  embrionária (`Sinal`, `QualidadeDeRecepcao` em `midia.ts`).

Isso separa, de uma vez, "a câmera dele" de "a rede dele" de "a minha rede" —
três diagnósticos que hoje chegam como a mesma frase e pedem providências
opostas.

### 3.2 Ver a própria tela

Quem compartilha precisa ver, na própria interface, o que está mandando. Se o
que sai é preto, a pessoa descobre em um segundo em vez de descobrir pela
terceira mensagem de alguém no chat.

A faixa local já é distinguida (`Faixa.local`, `midia.ts:318`) e a câmera
própria já se vê espelhada. Estender isso à tela é pequeno e é o item de melhor
relação valor/custo desta proposta inteira.

### 3.3 Curar sozinho o preto que é falta de quadro-chave

Os casos 7, 8 e 9 do §2 têm todos a mesma cura: forçar um quadro-chave novo.

Regra: se `framesDecoded` de uma faixa não subir por **3 segundos** enquanto a
publicação continua ativa e inscrita, reinscrever a faixa. O SFU responde com um
quadro-chave e a imagem volta.

Uma alternativa mais barata para o mesmo efeito é alternar `setVideoQuality` —
que `definirQualidadeDeRecepcao` já sabe chamar (`midia.ts:1103`) — e voltar ao
valor anterior, o que provoca troca de camada e, com ela, um quadro-chave. Vale
medir qual das duas é menos visível.

Com limite: no máximo uma tentativa a cada 15 s, e desiste depois de três. Uma
cura que fica se repetindo é um laço de piscadas, e é pior do que o defeito.

### 3.4 Parar de sufocar a máquina fraca

Três mudanças, da mais segura para a mais ousada:

1. **O padrão deixa de ser `1080p60`.** Escolher a qualidade mais alta para quem
   nunca configurou nada é apostar que toda máquina aguenta. `1080p30` como
   padrão, com os 60 quadros oferecidos a quem escolher, inverte a aposta para o
   lado certo. A escolha já é guardada por máquina em `localStorage`
   (`lerQualidade()`), então quem quer 60 configura uma vez.
2. **Rebaixamento automático com aviso.** `qualityLimitationReason === 'cpu'`
   por 10 s consecutivos → cair um degrau e **dizer que caiu**. Rebaixar em
   silêncio é o que faz alguém jurar que "o Altcast está borrado hoje".
3. **Experimentar H.264 na tela.** VP8 é codificado por software; H.264 costuma
   ter codificador em hardware em qualquer GPU dos últimos dez anos, e o custo
   de CPU despenca. É `videoCodec` em `publishDefaults`. Precisa de medição
   antes: H.264 não tem SVC, o comportamento de simulcast muda, e o navegador
   pode cair de volta para software sem avisar. **Não adotar sem medir.**

### 3.5 Consertar o preto de captura no app de desktop

O app é o único lugar onde dá para agir sobre as causas 1 a 5 do §2.

- **Ligar o Windows Graphics Capture explicitamente.** Hoje `desktop/src/main.ts`
  não define nenhum switch de linha de comando. As *features* candidatas do
  Chromium são `AllowWgcScreenCapturer` e `AllowWgcWindowCapturer` — os nomes e
  o padrão mudam entre versões, e o projeto está no Electron 44, então isto é um
  **experimento a medir**, não uma receita a aplicar. O teste é direto:
  compartilhar a janela de um jogo, com e sem o switch.
- **Detectar a janela minimizada antes de capturar.** `desktopCapturer` já é
  consultado em `captura.ts`; uma miniatura inteiramente preta é um sinal barato
  e confiável. Melhor do que capturar: avisar, e oferecer capturar a tela
  inteira, que não sofre do problema.
- **Detectar o preto na origem.** Um quadro amostrado em um `canvas` 8×8 a cada
  poucos segundos responde "está tudo preto?" por quase nada de CPU. Responde
  também pelo caso 5 — a janela protegida por DRM —, que não tem conserto e
  precisa de uma frase honesta: *"Este aplicativo bloqueia a captura de tela."*

### 3.6 Parar de piscar por nossa culpa

O caso 10 do §2 é o único inteiramente nosso. A faixa que muda de miniatura para
palco não deveria remontar.

Duas saídas: manter um único elemento de vídeo por faixa e mover o **nó** entre
os contêineres em vez de recriá-lo; ou renderizar as duas posições sempre e
alternar a visibilidade. A segunda é mais simples e mais perigosa — elemento
oculto é exatamente o que faz o `adaptiveStream` pausar a faixa (caso 8), o que
troca uma piscada por um congelamento. A primeira é a correta.

## 4. Ordem sugerida

**3.1 e 3.2 primeiro, sempre.** Sem instrumento, todo o resto é palpite, e não
há como saber se uma correção corrigiu. Depois 3.3 (a cura automática paga
sozinha), 3.4.1 (uma linha, risco perto de zero), 3.5, 3.6, e por fim 3.4.3, que
é o único item que pede uma bateria de medição própria.

## 5. Fora de escopo

Gravação de chamada (fora de escopo do produto inteiro, spec 00), transcodificar
no servidor, medir qualidade por percepção (VMAF e afins) e afinar o próprio
LiveKit — o SFU aqui é uma dependência, não um objeto de trabalho.

## 6. Decisões em aberto

1. O aviso de transmissão parada aparece só para quem transmite, ou também para
   quem assiste?
2. A cura automática (§3.3) pode agir sozinha, ou deve pedir confirmação?
   (Agir sozinha é melhor produto e mais difícil de depurar.)
3. Vale um "modo apresentação" — 1080p a 5 fps com nitidez máxima, com
   `degradationPreference: 'maintain-resolution'` — para slides e código, onde a
   escolha atual está deliberadamente errada?
