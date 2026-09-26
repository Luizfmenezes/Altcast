# Avisos de terceiros

## React Bits

Parte dos componentes de `web/src/ui/bits/` foi derivada do **React Bits**
(<https://reactbits.dev>), adaptada para os tokens, a acessibilidade e o
orcamento de desempenho deste projeto. Os arquivos derivados trazem a atribuicao
no proprio cabecalho.

O que veio de la, e em que estado:

| Arquivo daqui | Origem | O que mudou |
|---|---|---|
| `web/src/ui/bits/Faisca.tsx` | `Animations/ClickSpark` | O laco de `requestAnimationFrame` so existe enquanto ha faisca viva, em vez de rodar para sempre; respeita `prefers-reduced-motion`; a cor sai do tema. |
| `web/src/ui/bits/Contador.tsx` | `TextAnimations/CountUp` | Reage a mudancas do alvo, e nao so a primeira entrada em tela; locale `pt-BR`; sem animacao sob movimento reduzido. |
| `web/src/ui/bits/TextoDecifrado.tsx` | `TextAnimations/DecryptedText` | O `sr-only` carrega o texto REAL — o original entrega o embaralhado ao leitor de tela; roda uma vez por troca de texto. |
| `web/src/ui/bits/TituloFatiado.tsx` | `TextAnimations/SplitText` | `revert()` no desmonte, para o DOM voltar a ser uma frase; texto real em `sr-only`. |
| `web/src/ui/bits/Aurora.tsx` e `aurora.shaders.ts` | `Backgrounds/Aurora` | Os shaders GLSL sao copia literal. O componente ganhou: guarda contra ausencia de WebGL, pausa quando a aba perde visibilidade, nao monta sob movimento reduzido, cores do tema, e carga por `lazy` para manter `ogl` fora do pacote inicial. |

### Licenca

React Bits — Copyright (c) 2026 David Haz.
**MIT License + Commons Clause License Condition v1.0.**

A MIT permite usar, copiar, modificar, mesclar e distribuir o software,
inclusive comercialmente, como parte de uma aplicacao ou produto — que e
exatamente o caso aqui.

A **Commons Clause** proibe vender, sublicenciar ou redistribuir *os componentes
em si*, isolados, empacotados ou portados para outra tecnologia. Ou seja: usa-los
dentro do Altcast e permitido; publicar uma biblioteca de componentes derivada
deles, nao.

O aviso de copyright e a nota de permissao devem acompanhar copias ou porcoes
substanciais do software — e o que este arquivo faz.

## Bibliotecas de animacao

| Pacote | Licenca | Onde e usado |
|---|---|---|
| `motion` | MIT | `MotionConfig` na raiz, a pilula do grupo ativo e o contador. |
| `gsap` + `@gsap/react` | Licenca padrao do GSAP (gratuita para uso nao-comercial de assinatura; os plugins antes exclusivos do Club, incluindo `SplitText`, passaram a ser gratuitos a partir do 3.13) | Apenas `TituloFatiado`, que usa `SplitText`. |
| `ogl` | MIT | Apenas `Aurora`. |
