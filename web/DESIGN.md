# Altcast — Design System v2 ("no ar")

> Fonte de verdade visual do app web e do desktop. Os valores de cor moram em
> `src/ui/tokens.ts` (lidos pelo teste de contraste); este documento explica o
> porquê e as regras de uso. Tipografia Geist confirmada pelo dono do produto
> em 2026-09-26. O acento âmbar (D1-B) foi revertido para o azul em 2026-09-30,
> a pedido do dono do produto; a estrutura de tokens da v2 ficou.

## Ideia

Altcast é um lugar para conversar e **transmitir**. O acento é azul e aparece
com parcimônia — ação primária, seleção, menção. O tom `accentLive` marca **só**
o que está transmitindo agora; a sala com gente usa o verde de presença.

Modo de superfície: **Operate** no app (tarefa, varredura, densidade; a marca
mora nos detalhes) e **Persuade** na porta de entrada e no convite (pode
encantar, uma vez).

## Cor

| Token | Escuro | Claro | Uso |
|---|---|---|---|
| `accent` | `#60a5fa` | `#1d4ed8` | Ação primária, foco, seleção |
| `accentFg` | `#0a1020` | `#ffffff` | Texto sobre o acento |
| `accentSubtle` | `#60a5fa1f` | `#dbeafe` | Fundo de menção, canal com menção |
| `accentLive` | `#fbbf24` | `#b45309` | **Só** o "no ar": fala e transmissão ao vivo |
| `warning` | `#eab308` | `#9a5c06` | Aviso — sempre com ícone e texto |
| `danger` | `#f87171` | `#b91c1c` | Só erro e destruição |
| `presenceOnline` | `#34d399` | `#047857` | Só presença |
| `bgSunken` | `#040507` | `#f8fafc` | Composer, campos |
| neutros | slate | slate | Estrutura |

- O azul do claro é bem mais escuro que o do escuro por conformidade: o nome do
  canal ativo é escrito em `accent` sobre `bgHover`, e ali um `#3b82f6` daria
  3,1:1. A conformidade decide o tom.
- `tokens.test.ts` exige 4,5:1 para texto e 3:1 para ícone/borda em todos os pares.
- `accentLive` ≠ aviso: o aviso tem token próprio (amarelo) e **nunca** aparece só como cor.
- Cores de cargo: escala OKLCH L 0,72 / C 0,14, matiz a cada 36° (10 cores +
  "sem cor"), nenhuma a menos de ΔE 20 de `danger` ou `presenceOnline`.

## Tipografia

- **Geist** (UI e texto) e **Geist Mono** (códigos, números, rótulos técnicos),
  auto-hospedadas em `public/fontes/`, eixo variável. Saem Inter, JetBrains Mono
  e Space Mono: uma voz só.
- Escala: 12 (legenda mínima) · 13 (meta) · 14 (UI) · **15 (corpo da mensagem)** ·
  16 (títulos de seção) · 20 (título de tela) · 24 (título de diálogo).
- Nada funcional abaixo de 12px. `line-height` 1,5 no corpo, 1,25 em títulos.
- Mensagem com `max-width: 72ch`. `tabular-nums` em contadores e horários.
- Maiúsculas espaçadas só nos cabeçalhos de seção da lista (12px, +0,06em) e na porta.

## Forma, espaço e profundidade

- Raios: `sm 4` · `md 6` · `lg 10` · `full` (só avatar e presença).
- Ritmo de 4 e 8px.
- Duas sombras: `shadow-popover` (menus, listas de sugestão) e `shadow-dialog`
  (diálogos), ambas ≤ 24px de blur. Sai o padrão "borda fina + sombra de 64px".
- Nada de cartão dentro de cartão: seção interna usa separador ou `bgSunken`.

## Componentes-chave

| Componente | Regra |
|---|---|
| Mensagem | Avatar de 32px no primeiro bloco do autor; hora no hover das linhas seguintes; corpo 15px/1,5, 72ch |
| `AcoesDaMensagem` | Barra flutuante no canto superior direito, no hover ou foco; teclado por Tab; toque abre por pressão longa |
| `Mencoes` | Listbox abaixo do textarea no DOM, desenhada acima; `aria-activedescendant` |
| `AnelDeFala` | Anel de 2px `accentLive` em volta do avatar de quem fala; estático sob movimento reduzido |
| Estado da chamada | ocioso → conectando → conectado ("no ar") → reconectando (aviso) → falhou (danger + ações). Uma fonte de verdade (`situacaoDaChamada`) |

## Movimento

No modo Operate, movimento **informa estado**; na porta e no convite, pode
encantar uma vez. Sempre sob `MotionConfig reducedMotion="user"`.

| Onde | Efeito | Duração |
|---|---|---|
| Fala | `AnelDeFala` ligado ao nível do áudio | contínuo |
| Entrar/sair da chamada | faixa de estado desliza + fade | 180 ms |
| Mensagem nova por evento | só a última, sem animar o histórico | 160 ms |
| Barra de ações | fade | 120 ms |
| Canal de voz com gente falando | pulso lento do ponto "no ar" | 2 s |
| Fora do app | `TextoDecifrado`, `Aurora` e bounce-easing | — |

## Proibido

- Gradiente em texto; glassmorphism no app.
- Texto funcional em 10–11px.
- Âmbar como único sinal de aviso.
- Cor como único portador de estado (sempre forma e texto juntos).

## Celular (abaixo de 768px)

A pedido do dono do produto (2026-09-30), o celular tem voz própria — cartões
grandes e redondos, no espírito de app de banco — sem mudar a paleta do desktop.

- **Navegação por telas, não por colunas** (`features/movel/ShellMovel.tsx`):
  abas fixas no pé (Início, Conversas, Você), o grupo como tela, a conversa em
  tela cheia. O Voltar do Android desce um nível (cada tela empilha histórico).
- **Pastéis só no celular** (`features/movel/cores.ts`): o cartão principal e
  os cartões de grupo usam pastel com tinta escura `#0b0f19` nos dois temas
  (≥ 12:1, conferido em `conversas-e-movel.test.tsx`). Fora desses cartões, os
  tokens de sempre.
- Raios: 20–28px nos cartões e linhas, `full` em botões pílula. Linhas de lista
  com 56px+ de altura; alvos de toque ≥ 44px.
- Margens seguras (`env(safe-area-inset-*)`) no topo, nas abas e no campo de
  escrita: o app instalado vai até as bordas (`viewport-fit=cover`).
- O botão de enviar aparece só abaixo de `md`; no desktop, Enter envia.
