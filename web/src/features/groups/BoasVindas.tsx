import { lazy, Suspense, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { MailWarning, Plus } from 'lucide-react'
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
 * existe. A versao anterior so oferecia a primeira, e mandava quem tinha
 * recebido um convite "abrir o link que voce recebeu" — ou seja, sair da
 * aplicacao e ir procurar no e-mail.
 */
export function BoasVindas(): ReactNode {
  const { estado, reenviar, endereco, precisaConfirmar } = useReenviarVerificacao()
  const [codigo, setCodigo] = useState('')

  function entrarPorConvite(evento: FormEvent): void {
    evento.preventDefault()
    const limpo = normalizarCodigoDeConvite(codigo)
    if (limpo === null) return
    irPara({ nome: 'convite', codigo: limpo })
  }

  return (
    <main className="relative mx-auto flex h-full w-full max-w-2xl flex-col justify-center gap-8 overflow-y-auto px-6 py-10">
      {/*
        O unico lugar do app com fundo em WebGL, e de proposito.

        Esta tela nao tem video, nao tem audio e nao tem lista que role: e o
        unico momento em que a GPU esta inteiramente livre. Dentro de um canal
        ela estaria disputando com o encode da camera e o decode de quem
        transmite — por isso `Aurora` entra por `lazy`, e o pacote inicial de
        quem so quer conversar nao carrega uma linha de `ogl`.
      */}
      <Suspense fallback={null}><Aurora /></Suspense>

      <div>
        <h1 className="text-xl font-semibold text-fg">
          <TituloFatiado texto="Voce ainda nao tem grupos" />
        </h1>
        <p className="mt-2 max-w-prose text-sm leading-relaxed text-fg-muted">
          Um grupo e onde as conversas acontecem — canais de texto, chamadas de
          voz e as pessoas que voce convidar.
        </p>
      </div>

      {precisaConfirmar && (
        <div
          className="flex flex-col gap-3 rounded-lg border border-border bg-bg-raised p-4"
        >
          <p className="flex items-start gap-2 text-sm text-fg">
            <MailWarning aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-fg-muted" />
            <span id="motivo-da-trava">
              Confirme <strong className="font-medium">{endereco ?? 'seu e-mail'}</strong> para
              criar um grupo. O link vale 24 horas.
            </span>
          </p>

          <div className="flex flex-wrap items-center gap-2">
            <Botao
              type="button"
              variante="discreto"
              onClick={() => { void reenviar() }}
              disabled={estado === 'enviando' || estado === 'enviado'}
            >
              {estado === 'enviando' ? 'Enviando...'
                : estado === 'enviado' ? 'E-mail enviado'
                  : 'Reenviar e-mail de confirmacao'}
            </Botao>
            {/*
              O Google resolve isto na hora, e nao por comodidade: a conta dele
              ja vem com o endereco verificado, entao entrar por ele vincula a
              conta existente e derruba a trava sem depender de e-mail nenhum
              chegar. Como a entrega de e-mail e a parte mais fragil de todo o
              sistema, esta e a saida mais confiavel — e por isso fica aqui,
              com o mesmo peso do outro botao, e nao escondida.
            */}
            <EntrarComGoogle rotulo="Confirmar com o Google" />
          </div>

          {estado === 'enviado' && (
            <p role="status" className="text-xs text-fg-muted">
              Enviado. Se nao chegar em alguns minutos, veja o spam — ou entre pelo Google.
            </p>
          )}
          {estado === 'falhou' && (
            <p role="alert" className="text-xs text-danger">
              Nao conseguimos enviar agora. Voce pode pedir de novo em uma hora,
              ou entrar pelo Google.
            </p>
          )}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <section className="flex flex-col gap-3 rounded-lg border border-border-subtle bg-bg-raised p-5">
          <h2 className="text-[15px] font-semibold text-fg">Criar um grupo</h2>
          <p className="flex-1 text-[13px] leading-relaxed text-fg-muted">
            Ele nasce com um canal #geral, e voce sai daqui com o link de
            convite na mao para mandar a quem quiser.
          </p>
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
        </section>

        <section className="flex flex-col gap-3 rounded-lg border border-border-subtle bg-bg-raised p-5">
          <h2 className="text-[15px] font-semibold text-fg">Tenho um convite</h2>
          <p className="text-[13px] leading-relaxed text-fg-muted">
            Cole o link que voce recebeu, ou so o codigo de oito caracteres.
          </p>
          {/*
            Aceitar a URL inteira, e nao so o codigo: quem recebe um convite
            recebe um link, e pedir que a pessoa extraia oito caracteres dele e
            transferir a ela um trabalho que o codigo faz melhor.
          */}
          <form onSubmit={entrarPorConvite} className="mt-auto flex flex-col gap-3" noValidate>
            <Campo
              rotulo="Link ou codigo do convite"
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
    </main>
  )
}
