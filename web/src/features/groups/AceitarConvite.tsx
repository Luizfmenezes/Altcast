import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import * as Dialogo from '@radix-ui/react-dialog'
import { ApiError, api } from '../../lib/api.js'
import { useStore } from '../../lib/store.js'
import { trocarPor } from '../../lib/rota.js'
import { Avatar } from '../../ui/Avatar.js'
import { Botao } from '../../ui/Botao.js'
import { contagemDeMembros, textoDoMotivo } from '../auth/mensagens.js'
import { usarPrevia } from '../auth/PreviaConvite.js'

/**
 * O convite aberto por quem JA ESTA DENTRO.
 *
 * Este caminho simplesmente nao existia, e era o defeito mais caro do fluxo de
 * convite: `TelaAuth` — a tela de quem esta de fora — era a unica a ler a
 * rota, e `AppShell` nunca olhava para ela. Quem ja tinha sessao e clicava num
 * link de convite caia no aplicativo normal, e o codigo era descartado em
 * silencio.
 *
 * A previa vem antes de qualquer escrita, de proposito: entrar num grupo e
 * uma acao com consequencia social, e ninguem deve descobrir em que entrou
 * depois de ja estar dentro.
 *
 * A excecao e `automatico`: a pessoa acabou de passar pela porta de entrada
 * com o cartao do grupo na tela — "Entre para aceitar o convite de X" — e ja
 * decidiu. Perguntar de novo depois do login seria pedir a mesma confirmacao
 * duas vezes.
 */
export function AceitarConvite({ codigo, automatico = false }: {
  codigo: string
  automatico?: boolean
}): ReactNode {
  const { previa, falhou } = usarPrevia(codigo)
  const [entrando, setEntrando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const escolherGrupo = useStore(e => e.escolherGrupo)
  const jaTentou = useRef(false)

  /**
   * Sai do endereco do convite sem empilhar historico.
   *
   * `trocarPor` e nao `irPara`: o codigo ja foi gasto, e deixar o Voltar
   * levar de volta a ele mostraria um convite que nao vale mais — com a
   * agravante de o endereco continuar circulando no historico do navegador.
   */
  function sair(): void {
    trocarPor({ nome: 'app' })
  }

  async function entrar(): Promise<void> {
    setErro(null)
    setEntrando(true)
    try {
      const r = await api.post<{ group: { id: string } }>(`/invites/${codigo}/accept`)
      // Nao insere na store: o `group.joined` do socket traz o grupo E os
      // canais dele, e inserir aqui a mao criaria uma segunda fonte da
      // verdade. So aponta a tela para la.
      escolherGrupo(r.group.id)
      sair()
    } catch (e) {
      // Ja ser membro nao e erro nenhum do ponto de vista de quem clicou: a
      // pessoa queria chegar naquele grupo, e ela ja esta nele. Levar ate la
      // e a resposta certa. O grupo vem PELO ID no erro — a versao anterior o
      // procurava pelo nome, e dois grupos chamados "Amigos" levavam ao errado.
      if (e instanceof ApiError && e.code === 'already_member') {
        const groupId = (e.details as { groupId?: unknown } | null)?.groupId
        if (typeof groupId === 'string') escolherGrupo(groupId)
        sair()
        return
      }
      setErro(e instanceof ApiError ? e.message : 'Não foi possível entrar no grupo.')
      setEntrando(false)
    }
  }

  useEffect(() => {
    if (!automatico || previa?.valid !== true || jaTentou.current) return
    jaTentou.current = true
    void entrar()
    // `entrar` muda a cada render e nao pode entrar nas dependencias: a trava
    // acima e o que garante uma tentativa so.
  }, [automatico, previa])

  return (
    <Dialogo.Root open onOpenChange={aberto => { if (!aberto) sair() }}>
      <Dialogo.Portal>
        <Dialogo.Overlay className="fixed inset-0 z-40 bg-bg/70 backdrop-blur-sm" />
        <Dialogo.Content
          className="fixed left-1/2 top-1/2 z-50 w-[min(24rem,calc(100%-2rem))]
                     -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border-subtle
                     bg-bg-raised p-6 text-center shadow-dialog"
        >
          {falhou || previa?.valid === false ? (
            <>
              <Dialogo.Title className="text-base font-semibold text-fg">
                Convite indisponível
              </Dialogo.Title>
              <Dialogo.Description className="mt-2 text-sm text-fg-muted">
                {falhou
                  ? 'Não foi possível verificar este convite. Tente novamente.'
                  : textoDoMotivo((previa as { reason: string }).reason)}
              </Dialogo.Description>
              <Botao className="mt-5" largura="cheia" onClick={sair}>Voltar</Botao>
            </>
          ) : previa === null ? (
            // Esqueleto com as dimensoes finais: a resposta chega em
            // milissegundos, e um salto de layout ali chama mais atencao do
            // que a espera.
            <div className="flex flex-col items-center gap-3" aria-busy="true">
              <Dialogo.Title className="sr-only">Carregando convite</Dialogo.Title>
              <div className="size-14 rounded-xl bg-bg-hover" />
              <div className="h-4 w-36 rounded bg-bg-hover" />
              <div className="h-3 w-20 rounded bg-bg-hover" />
              <div className="mt-2 h-9 w-full rounded-md bg-bg-hover" />
            </div>
          ) : (
            <>
              <div className="flex justify-center">
                <Avatar nome={previa.groupName} url={previa.groupIconUrl} className="size-14" />
              </div>
              <Dialogo.Title className="mt-3 text-base font-semibold text-fg">
                {automatico && erro === null
                  ? `Entrando em ${previa.groupName}…`
                  : `Entrar em ${previa.groupName}?`}
              </Dialogo.Title>
              <Dialogo.Description className="mt-1 text-sm text-fg-muted">
                {contagemDeMembros(previa.memberCount)}
              </Dialogo.Description>

              {erro !== null && (
                <p role="alert" className="mt-4 rounded-md border border-danger px-3 py-2
                                           text-left text-sm text-danger">
                  {erro}
                </p>
              )}

              {/*
                Grade de duas colunas, e nao `flex` com dois botoes de largura
                cheia. Dois `w-full` numa linha flex nao encolhem: o segundo
                transbordava o dialogo, e no celular (390px) o "Entrar" ficava
                inteiro fora da tela — o botao que e o motivo do convite.
                Abaixo de 360px os dois empilham, com o primario em cima.
              */}
              {(!automatico || erro !== null) && (
                <div className="mt-5 grid grid-cols-2 gap-2 max-[360px]:grid-cols-1">
                  <Botao
                    variante="discreto"
                    largura="cheia"
                    onClick={sair}
                    disabled={entrando}
                    className="max-[360px]:order-2"
                  >
                    Agora não
                  </Botao>
                  <Botao
                    largura="cheia"
                    onClick={() => { void entrar() }}
                    disabled={entrando}
                    className="max-[360px]:order-1"
                  >
                    {entrando ? 'Entrando…' : 'Entrar'}
                  </Botao>
                </div>
              )}
            </>
          )}
        </Dialogo.Content>
      </Dialogo.Portal>
    </Dialogo.Root>
  )
}
