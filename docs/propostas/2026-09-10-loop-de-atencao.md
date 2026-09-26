# Proposta — O loop de atenção

> Data: 2026-09-10. Status: **proposta. Não passou por brainstorming nem por
> aprovação.** Existe para ser executada mais adiante, não agora.
>
> Origem: pergunta "o que deixaria o Altcast mais parecido com o Discord".

## 1. O problema

O Altcast hoje só existe enquanto a aba está aberta e a pessoa está olhando.
Fechou, minimizou, foi para outro grupo — o sistema perde a capacidade de
chamar alguém de volta. É essa a diferença de *sensação* entre o Altcast e o
Discord, e ela não vem de nenhuma feature isolada: vem do circuito completo
**algo aconteceu → você fica sabendo → você sabe onde → você volta e sabe o que
perdeu**.

O circuito hoje está partido em dois pontos: não existe nada que avise (o
"você fica sabendo") e a contagem de não-lidas só funciona para canal que já
foi aberto nesta sessão (o "você sabe onde" é parcial).

## 2. O que já está pronto — e é bastante

Isto não é um campo vazio. Já existem, verificados no código:

| Peça | Onde |
|---|---|
| Marco de leitura por canal, persistido | `channel_reads` em `api/src/db/schema.ts:211` |
| `PUT /api/channels/:id/read` | `api/src/routes/chatRico.routes.ts` |
| Marcos entregues no `ready` do WebSocket | `Ready.reads` em `web/src/lib/tipos.ts` |
| Contagem de não-lidas no cliente | `naoLidasDoCanal()` em `web/src/lib/store.ts:391` |
| Pílula de contagem + negrito no canal | `ItemDeCanal` em `web/src/features/channels/ListaCanais.tsx` |
| Separador "novas mensagens" e volta ao fim | `web/src/features/messages/MessageList.tsx` |
| Seções colapsáveis na lista de canais | `Secao` em `ListaCanais.tsx` |
| Menções gravadas por pessoa e a todos | `mentions` e `messages.mentionsEveryone` |

A fundação está lá. O que falta é o que atravessa a fronteira da aba.

## 3. O que falta, em cinco partes independentes

### 3.1 Não-lida que sobrevive ao recarregar

`naoLidasDoCanal()` conta apenas o que está em memória, e o comentário no
código explica a razão: o `ready` manda o marco, mas não manda quantas
mensagens vieram depois dele, e inventar um número seria mentir. Está certo —
a correção não é mudar o cliente, é o servidor passar a mandar o que o cliente
não tem como saber.

**Proposta:** o `ready` passa a carregar, por canal, `{ naoLidas, temMencao }`.
São duas contagens que o índice `messages_channel_id_desc_idx` já atende sem
varredura — `count(*) where channel_id = ? and id > marco`. O cliente continua
derivando de ids quando tem histórico local, e usa o número do servidor quando
não tem.

**Por que importa:** é o que faz a barra lateral estar certa no primeiro
segundo depois de abrir o app, que é justamente o segundo em que a pessoa
decide para onde ir.

### 3.2 Menção se distingue de mensagem

Hoje toda novidade é a mesma pílula cinza. No Discord, ser mencionado é
vermelho e conta separado — e é a distinção que permite ignorar 200 mensagens
sem perder a única dirigida a você.

**Proposta:** a pílula ganha dois estados. `temMencao` vem do servidor
(§3.1) e do evento `message.created` quando `mentions` inclui o meu id ou
`mentionsEveryone` é verdadeiro. Cor **e** forma, nunca só cor — a `ListaCanais`
já segue essa regra por causa do SC 1.4.1 e não pode regredir aqui.

### 3.3 Notificação fora da aba

Não existe nenhuma linha de notificação no projeto hoje (`web/src` e
`desktop/src` não citam `Notification`, `setBadge` nem `document.title`).

Quatro superfícies, em ordem de custo:

1. **Título do documento** — `(3) Altcast`. Custa nada e já resolve a aba de
   fundo.
2. **Web Notification** — pedida no primeiro uso, nunca no carregamento. Clicar
   leva ao canal.
3. **Som** — curto, com controle de volume e um botão de mudo que a pessoa
   encontre. Um som que não se desliga vira motivo para fechar o app.
4. **Desktop (Electron)** — `setBadgeCount` na barra de tarefas e `flashFrame`.
   Entra pela ponte de capacidade que `web/src/lib/nativo.ts` já define: um `if`
   por capacidade, jamais por plataforma. A ponte ganha
   `notificar()` e `definirBadge()`; ausentes, o navegador segue pelo caminho
   de sempre.

**Regra de disparo, para não virar spam:** notifica se — e só se — a mensagem
não é minha, o canal não está com foco, e (menção **ou** preferência do canal
diz "tudo").

### 3.4 Preferência de notificação por canal e por grupo

Sem isto, o item anterior fica insuportável em uma semana.

Uma tabela nova, no mesmo espírito de `channel_reads`:

```
notification_prefs
  user_id     uuid   -> users(id)      on delete cascade
  scope_type  enum   ('group' | 'channel')
  scope_id    uuid                       -- group_id ou channel_id
  level       enum   ('tudo' | 'mencoes' | 'nada')
  PK (user_id, scope_type, scope_id)
```

Sem linha significa herdar: canal herda do grupo, grupo herda do padrão
(`mencoes`). Guardar a herança explícita obrigaria a reescrever cada canal
quando o grupo muda; guardar a ausência não obriga a nada.

**Silenciar temporariamente** ("por 1 hora", "até amanhã de manhã") é uma
coluna `mutedUntil` na mesma linha, e vale a pena: quase todo silenciamento
real deveria ter sido temporário.

### 3.5 Quem está na chamada aparece sem entrar

Essa é a assinatura visual mais reconhecível do Discord: os nomes aninhados sob
o canal de voz, visíveis para todo mundo que enxerga o canal. É o que faz
alguém entrar numa conversa que não sabia que estava acontecendo.

O evento `voice.participant_joined` já circula pelo `emit.toChannel`, que já
respeita `audienceOfChannel` — quem não vê o canal não recebe. Falta o estado
por canal no cliente e o desenho na `ListaCanais`.

**Cuidado a registrar:** presença de chamada é memória, como `presence.ts`, e
não linha em banco. O princípio #4 do projeto ("só a conta toca o disco por
padrão") vale aqui. Reiniciar a API zera e reconstrói — está correto.

## 4. Duas coisas fora do circuito, mas do mesmo pacote

**Categorias de canal.** A `ListaCanais` tem hoje duas seções fixas — "Canais
de texto" e "Canais de voz". O Discord agrupa por assunto, com o tipo virando
apenas o ícone. É um `parentId` nulo em `channels` e o `position` que já existe;
o custo real é o arrastar-e-soltar acessível por teclado, não o banco.

**Status: ausente, não perturbe, invisível.** Hoje `presence` é um contador de
conexões, e a resposta é binária. Os três estados extras são declaração da
pessoa, não fato sobre socket — então são um campo à parte, não um quarto valor
do mesmo. "Ausente" automático (sem interação por N minutos) é o único
derivado, e é o mais útil dos três.

## 5. Ordem sugerida

3.1 → 3.2 → 3.3 → 3.4 → 3.5, e as duas do §4 depois. Cada passo é usável
sozinho, e nenhum obriga o seguinte.

## 6. Fora de escopo desta proposta

Notificação por e-mail de mensagem perdida, resumo diário, push para celular,
e qualquer forma de notificação que saia do dispositivo. Também fica de fora
"marcar como não lida", que é uma boa ideia e uma discussão à parte.

## 7. Decisões em aberto

1. O padrão de um canal recém-criado é `mencoes` ou `tudo`? (Discord usa
   `tudo` para servidor pequeno, e é agressivo demais para nós.)
2. Som ligado ou desligado por padrão na primeira vez?
3. Notificação do desktop deve aparecer com a janela aberta mas sem foco, ou só
   com o app minimizado?
