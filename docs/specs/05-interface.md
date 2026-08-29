# 05 — Interface

## 1. Direção de design, declarada antes do código

| Eixo | Definição |
|---|---|
| **Propósito** | Ferramenta de trabalho usada por horas seguidas. Não é página de apresentação |
| **Público** | A equipe, repetindo o mesmo fluxo diariamente: abrir, escanear o que mudou, responder, voltar ao trabalho |
| **Tom** | Denso, quieto, escaneável. Utilitário refinado |
| **Restrições** | React, WCAG 2.2 AA, responsivo até 400% de zoom, tema claro e escuro |

Isso descarta explicitamente o repertório visual genérico de interface gerada:
gradiente roxo, formas decorativas, hero gigante com texto vago, card dentro de
card, seções de marketing antes do produto.

**A primeira tela após o login já é a conversa.** O produto é o produto.

## 2. O detalhe memorável

O design escolhe **um** elemento que o torna intencional, e é este:

> **A barra de conexão honesta** — uma calha fina e permanente no rodapé que diz
> a verdade sobre o estado do tempo real: conectado, reconectando, latência em
> milissegundos.

Quase todo chat esconde isso e deixa a pessoa falando no vazio sem saber. Como
toda a arquitetura foi desenhada em torno de "o WebSocket pode falhar e o REST
cura", **exibir esse estado é a expressão visual da alma do sistema**, não
enfeite.

Na Fatia 2 ela cresce naturalmente para mostrar qualidade de mídia por
participante — sem redesenho, porque o lugar já existe.

## 3. Layout

```
+--+------------+--------------------------+----------+
|  |            |  # planejamento          |          |
|G |  CANAIS    +--------------------------+ MEMBROS  |
|R |            |                          |          |
|U | # geral    |   conversa               | * Felipe |
|P | # planej.  |   (rolagem)              | * Ana    |
|O | # diretoria|                          | o Carlos |
|S |            +--------------------------+          |
|  |            |  [ escrever... ]         |          |
+--+------------+--------------------------+----------+
| * conectado - 42 ms                                 |
+-----------------------------------------------------+
  64px    240px          flex              240px
```

Larguras **fixas** onde precisam ser estáveis. A barra lateral não pode mudar de
largura quando aparece um nome longo ou um estado de hover.

### Pontos de quebra

| Largura | Comportamento |
|---|---|
| 1200px ou mais | Layout completo, quatro colunas |
| 900 a 1199px | Painel de membros colapsa, acessível por botão |
| 640 a 899px | Lista de canais vira gaveta sobreposta |
| Menos de 640px | Coluna única, navegação por gaveta, campo de escrita fixo no rodapé |
| Zoom 400% | Tudo empilhado e utilizável (WCAG SC 1.4.10 Reflow) |

### Densidade

Alternância **compacto / confortável**, persistida por usuário. Quem usa oito
horas por dia quer ver mais linhas; quem entra uma vez por semana quer respiro.

## 4. Cor

Paleta **multidimensional**, jamais dominada por uma família de matiz:

| Papel | Uso |
|---|---|
| Neutro frio (zinc) | Estrutura, fundos, texto, bordas — a maior parte da tela |
| **Âmbar** | Único acento de ação: botão primário, canal ativo, menção |
| Verde discreto | Exclusivamente presença online |
| Vermelho | Exclusivamente erro e destruição |

Quando o vermelho aparece na tela, **significa alguma coisa**. É por isso que ele
não decora nada.

Tema escuro como padrão — é o hábito da categoria e reduz fadiga em uso
prolongado. Tema claro disponível e igualmente cuidado. Ambos definidos por CSS
variables; **nenhum componente escreve cor literal**.

## 5. Tipografia

| Fonte | Onde | Por quê |
|---|---|---|
| **Inter** | Toda a interface | Legibilidade em tamanho pequeno, altura de x generosa |
| **JetBrains Mono** | Códigos de convite, IDs, horários | Ver abaixo |

A troca para monoespaçada nos códigos **não é estética**: `K7M2P9XQ` em
monoespaçada é ditável por telefone sem erro — e é literalmente assim que esse
código vai circular. A escolha do alfabeto (base32 de Crockford, sem as letras
ambíguas) e a escolha da fonte servem à mesma finalidade.

Escalas contextuais, entre 12 e 20 px. **Nenhum texto gigante decorativo.**

## 6. Acessibilidade — WCAG 2.2 nível AA

Requisito de implementação, não revisão final.

### Perceptível

- Contraste **4.5:1** em texto normal, **3:1** em texto grande e componentes de
  interface. Validado no token, não no olho
- Presença **nunca é só cor**: círculo cheio para online, círculo vazado para
  offline, mais rótulo textual acessível. Daltônico não pode depender de verde
  contra cinza (SC 1.4.1)
- Todo ícone sem texto tem `aria-label` descritivo; ícone decorativo recebe
  `aria-hidden="true"`
- Reflow completo em 400% de zoom sem rolagem horizontal (SC 1.4.10)

### Operável

- **Alvos de no mínimo 24 por 24 px** (SC 2.5.8), e 44 por 44 px em toque —
  inclusive os ícones pequenos de ação sobre a mensagem
- **Foco sempre visível**: anel de 2 px, contraste 3:1, com deslocamento
  (SC 2.4.11 Focus Appearance). Remover o outline sem substituto é proibido
- Navegação completa por teclado, com ordem lógica
- Atalhos: `Ctrl/Cmd+K` busca de canal, `Esc` fecha sobreposição, `Alt` com seta
  para cima ou para baixo navega entre canais
- **Modais prendem o foco** enquanto abertos e o liberam no `Esc` ou no botão de
  fechar, devolvendo-o ao elemento que os abriu (SC 2.1.2)
- Link "pular para a conversa" como primeiro elemento focável

### Compreensível

- **Trocar de canal move o foco para o campo de escrita** e anuncia o nome do
  canal. Sem isso, quem navega por teclado se perde a cada troca
- Erros de formulário em texto, com sugestão de correção (SC 3.3.3), nunca só
  borda vermelha
- Rótulos persistentes nos campos, não apenas `placeholder`
- Navegação consistente entre telas

### Robusto

- **A lista de mensagens usa `role="log"` com `aria-live="polite"`**
- Sutileza que quase todo chat erra: anunciar cada mensagem em conversa
  movimentada transforma leitor de tela em tortura. Portanto o anúncio é
  **agrupado** e **pausado enquanto o campo de escrita está focado** — quem está
  digitando não é interrompido
- **O indicador de digitação fica FORA da região viva.** É informação de baixo
  valor e altíssima frequência; anunciá-la seria ruído puro
- Mudanças de estado de conexão anunciadas via `role="status"`
- `prefers-reduced-motion` respeitado: movimento existe apenas para orientar
  transição de estado, nunca para enfeitar

## 7. Stack de frontend

| Camada | Escolha | Motivo |
|---|---|---|
| Build | **Vite** | Arranque instantâneo, build simples |
| Framework | **React + TypeScript** | Ecossistema e tipagem ponta a ponta |
| Estilo | **Tailwind** com tokens próprios | Densidade e consistência sem CSS órfão |
| Primitivos | **Radix UI** | Diálogo, menu, tooltip e popover já resolvem foco, teclado e ARIA corretamente |
| Cache REST | **TanStack Query** | É exatamente o que cura os buracos do WebSocket |
| Estado local | **Zustand** | Pequeno, sem cerimônia |
| Ícones | **Lucide** | Conjunto coerente, com tree-shaking |

Radix não é preferência estética: reimplementar diálogo acessível à mão é
precisamente como os requisitos da seção anterior morrem na prática.

## 8. Telas da Fatia 1

| Tela | Conteúdo |
|---|---|
| Login | E-mail, senha, erro uniforme |
| Cadastro | Só acessível com código de convite válido no contexto |
| Prévia de convite | Nome do grupo, ícone, contagem de membros, botão de entrar |
| Aplicação | Layout de quatro colunas descrito acima |
| Configurações do grupo | Nome, ícone, membros, papéis, convites, lista de canais |
| Configurações do canal | Nome, tópico, visibilidade, lista de acesso |
| Configurações do usuário | Nome de exibição, senha, sessões ativas, densidade, tema |
| Erro e offline | Estado claro com ação de recuperação |

## 9. Comportamentos de interface obrigatórios

- **Eco otimista**: a mensagem aparece imediatamente, esmaecida, com o UUIDv7 já
  gerado no cliente. Depois confirma, ou vira "falhou — tentar de novo".
  **Nunca some em silêncio**
- **Âncora de rolagem**: a rolagem fica colada no fim se o usuário já estava no
  fim; caso contrário, aparece o marcador "novas mensagens" sem arrastar a
  leitura
- **Agrupamento**: mensagens consecutivas do mesmo autor em menos de 5 minutos
  compartilham o cabeçalho
- **Separador de dia** entre mensagens de datas diferentes
- **Estado vazio** com instrução concreta, não ilustração decorativa
- **Esqueletos** de carregamento com as dimensões finais, para não haver salto
  de layout
