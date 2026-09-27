import { lazy, Suspense, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { MailWarning, Plus, Ticket } from 'lucide-react'
import { CriarGrupo } from './CriarGrupo.js'
import { Botao } from '../../ui/Botao.js'
import { Campo } from '../../ui/Campo.js'
import { EntrarComGoogle } from '../auth/EntrarComGoogle.js'
import { useReenviarVerificacao } from '../auth/useReenviarVerificacao.js'
import { normalizarCodigoDeConvite } from '../../lib/convite.js'
import { irPara } from '../../lib/rota.js'
import { TituloFatiado } from '../../ui/bits/TituloFatiado.js'

/** `ogl` so entra no pacote de quem chega a esta tela. */
const Aurora = lazy(async () => ({ default: (await import('../../ui/bits/Aurora.js')).Aurora }))

/**
 * O que aparece para quem entrou e nao participa de grupo nenhum.
 *
 * Este estado nao existia enquanto o cadastro era fechado: toda conta nascia
 * dentro do grupo do convite que a criou. Com o cadastro aberto ele passou a
 * ser o PRIMEIRO que muita gente ve, e por isso ele nao pode ser decorativo.
 *
 * Sao as DUAS portas, lado a lado, porque sao os dois jeitos reais de o
 * Altcast comecar a servir para alguem: criar um grupo, ou entrar num que ja
 * existe.
 *
 * ## O que estava errado no desenho anterior
 *
 * Tres defeitos, e nenhum era questao de gosto:
 *
 * 1. **A aurora era um retangulo, e nao uma atmosfera.** Ela e
 *    `absolute inset-0`, e morava dentro do `<main>` que tem `max-w-2xl` —
 *    entao pintava exatamente a coluna de 42rem, com borda dura, enquanto o
 *    resto da janela ficava cinza. Lia-se como um painel colorido encostado no
 *    canto, e nao como fundo. Agora ela e uma camada `fixed` atras de tudo, e
 *    o conteudo flutua sobre ela.
 * 2. **O texto nao tinha contraste garantido.** `text-fg-muted` sobre um
 *    gradiente roxo a 60% nao passa em WCAG AA, que aqui e requisito e nao
 *    revisao final. O conteudo passou a morar em cartoes com fundo proprio; a
 *    cor fica em volta, nunca atras da leitura.
 * 3. **A coluna nao se centralizava verticalmente.** `justify-center` com
 *    `overflow-y-auto` no mesmo elemento se anulam quando o conteudo cresce, e
 *    o que sobrava era tudo encostado no topo-esquerda de uma area enorme.
 *    Quem centra agora e uma grade externa, e o rolo fica com ela.
 */
export function BoasVindas(): ReactNode {
  const { estado, reenviar, endereco, precisaConfirmar } = useReenviarVerificacao()
  const [codigo, setCodigo] = useState('')

  function entrarPorConvite(evento: FormEvent): void {
    evento.preventDefault()
    const limpo = normalizarCodigoDeConvite(codigo)
    if (limpo === null) return
    // Desde esta fatia isto leva a algum lugar: `App` passou a ler a rota
    // dentro da sessao tambem, e o codigo abre a confirmacao de entrada. Antes
    // o endereco mudava e nada acontecia — o beco sem saida que fazia o fluxo
    // de convite parecer quebrado.
    irPara({ nome: 'convite', codigo: limpo })
  }

  return (
    <main className="relative grid h-full w-full place-items-center overflow-y-auto px-4 py-10">
      {/*
        A aurora atras de TUDO, e sem limite de largura.

        Ela nao rola com o conteudo de proposito: e fundo, e fundo que se move
        junto com o texto vira parallax acidental. `-z-10` a mantem abaixo do
        cartao, e o cartao tem fundo opaco — e assim nenhuma escolha de cor do
        shader pode comer a legibilidade do que esta escrito.
      */}
      <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        <Suspense fallback={null}><Aurora /></Suspense>
        {/* Um veu sobre o shader. Sem ele, o gradiente a plena forca disputa
            com o cartao; com ele, a cor vira ambiente. */}
        <div className="absolute inset-0 bg-bg/60" />
      </div>

      <div className="flex w-full max-w-xl flex-col gap-5">
        <header className="text-center">
          <h1 className="text-2xl font-semibold tracking-tight text-fg">
            <TituloFatiado texto="Você ainda não tem grupos" />
          </h1>
          <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-fg-muted">
            Um grupo é onde as conversas acontecem — canais de texto, chamadas de
            voz e as pessoas que você convidar.
          </p>
        </header>

        {precisaConfirmar && (
          <div className="flex flex-col gap-3 rounded-xl border border-border bg-bg-raised/95 p-4
                          backdrop-blur">
            <p className="flex items-start gap-2 text-[13px] text-fg">
              <MailWarning aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-fg-muted" />
              <span id="motivo-da-trava">
                Confirme <strong className="font-medium">{endereco ?? 'seu e-mail'}</strong> para
                criar um grupo. O link vale 24 horas.
              </span>
            </p>

            {/*
              Uma fileira de iguais: dois caminhos para a mesma coisa, com o
              mesmo peso. Antes o botao do Google trazia `mt-6`, largura total
              e uma regua "ou" propria — desenhados para o rodape do formulario
              de login — e dentro desta linha isso virava um "ou" solto no meio
              do nada com o botao encostando na borda. A variante `linha`
              existe por causa deste lugar.
            */}
            <div className="flex flex-wrap items-center gap-2">
              <Botao
                type="button"
                variante="discreto"
                tamanho="sm"
                onClick={() => { void reenviar() }}
                disabled={estado === 'enviando' || estado === 'enviado'}
              >
                {estado === 'enviando' ? 'Enviando...'
                  : estado === 'enviado' ? 'E-mail enviado'
                    : 'Reenviar e-mail'}
              </Botao>
              <span aria-hidden="true" className="text-[11px] uppercase tracking-wider text-fg-muted">
                ou
              </span>
              {/*
                O Google resolve isto na hora, e nao por comodidade: a conta
                dele ja vem com o endereco verificado, entao entrar por ele
                vincula a conta existente e derruba a trava sem depender de
                e-mail nenhum chegar. Como a entrega de e-mail e a parte mais
                fragil de todo o sistema, esta e a saida mais confiavel.
              */}
              <EntrarComGoogle rotulo="Confirmar com o Google" variante="linha" />
            </div>

            {estado === 'enviado' && (
              <p role="status" className="text-xs text-fg-muted">
                Enviado. Se não chegar em alguns minutos, veja o spam — ou entre pelo Google.
              </p>
            )}
            {estado === 'falhou' && (
              <p role="alert" className="text-xs text-danger">
                Não conseguimos enviar agora. Você pode pedir de novo em uma hora,
                ou entrar pelo Google.
              </p>
            )}
          </div>
        )}

        {/*
          `items-stretch` com o rodape ancorado por `mt-auto` em cada cartao: e
          o que faz os dois botoes ficarem na MESMA linha de base mesmo com
          textos de alturas diferentes. Sem isso, um cartao com uma linha a
          mais empurra so o proprio botao, e a fileira fica torta.
        */}
        <div className="grid items-stretch gap-4 sm:grid-cols-2">
          <section className="flex flex-col gap-3 rounded-xl border border-border-subtle
                              bg-bg-raised/95 p-5 backdrop-blur">
            <span className="flex size-9 items-center justify-center rounded-lg bg-accent/12
                             text-accent">
              <Plus aria-hidden="true" strokeWidth={2} className="size-5" />
            </span>
            <h2 className="text-[15px] font-semibold text-fg">Criar um grupo</h2>
            <p className="text-[13px] leading-relaxed text-fg-muted">
              Ele nasce com um canal #geral, e você sai daqui com o link de
              convite na mão para mandar a quem quiser.
            </p>
            <div className="mt-auto pt-1">
              <CriarGrupo
                gatilho={
                  <Botao
                    largura="cheia"
                    disabled={precisaConfirmar}
                    {...(precisaConfirmar ? { 'aria-describedby': 'motivo-da-trava' } : {})}
                  >
                    <Plus aria-hidden="true" />
                    Criar meu primeiro grupo
                  </Botao>
                }
              />
            </div>
          </section>

          <section className="flex flex-col gap-3 rounded-xl border border-border-subtle
                              bg-bg-raised/95 p-5 backdrop-blur">
            <span className="flex size-9 items-center justify-center rounded-lg bg-fg/[0.06]
                             text-fg-muted">
              <Ticket aria-hidden="true" strokeWidth={2} className="size-5" />
            </span>
            <h2 className="text-[15px] font-semibold text-fg">Tenho um convite</h2>
            <p className="text-[13px] leading-relaxed text-fg-muted">
              Cole o link que você recebeu, ou só o código de oito caracteres.
            </p>
            {/*
              Aceitar a URL inteira, e nao so o codigo: quem recebe um convite
              recebe um link, e pedir que a pessoa extraia oito caracteres dele
              e transferir a ela um trabalho que o codigo faz melhor.
            */}
            <form onSubmit={entrarPorConvite} className="mt-auto flex flex-col gap-3 pt-1" noValidate>
              <Campo
                rotulo="Link ou código do convite"
                valor={codigo}
                aoMudar={setCodigo}
                espacoReservado="K7M2P9XQ"
              />
              <Botao
                type="submit"
                variante="discreto"
                largura="cheia"
                disabled={normalizarCodigoDeConvite(codigo) === null}
              >
                Entrar no grupo
              </Botao>
            </form>
          </section>
        </div>
      </div>
    </main>
  )
}
