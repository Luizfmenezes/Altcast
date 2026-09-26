import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import * as Dialogo from '@radix-ui/react-dialog'
import { ApiError, api } from '../../lib/api.js'
import { useStore } from '../../lib/store.js'
import { trocarPor } from '../../lib/rota.js'
import { Avatar } from '../../ui/Avatar.js'
import { Botao } from '../../ui/Botao.js'
import { contagemDeMembros, textoDoMotivo } from '../auth/mensagens.js'

/**
 * O convite aberto por quem JA ESTA DENTRO.
 *
 * Este caminho simplesmente nao existia, e era o defeito mais caro do fluxo de
 * convite: `TelaAuth` — a tela de quem esta de fora — era a unica a ler a
 * rota, e `AppShell` nunca olhava para ela. Quem ja tinha sessao e clicava num
 * link de convite caia no aplicativo normal, e o codigo era descartado em
 * silencio. Nenhum erro, nenhuma tela, nada: a impressao de que o link estava
 * quebrado.
 *
 * O mesmo beco pegava quem digitava um codigo em "Tenho um convite": a tela de
 * boas-vindas chama `irPara({ nome: 'convite' })`, o endereco mudava, e
 * ninguem desenhava nada.
 *
 * A previa vem antes de qualquer escrita, de proposito: entrar num grupo e
 * uma acao com consequencia social, e ninguem deve descobrir em que entrou
 * depois de ja estar dentro.
 */

type Previa =
  | { valid: true; groupName: string; groupIconUrl: string | null; memberCount: number }
  | { valid: false; reason: string }

export function AceitarConvite({ codigo }: { codigo: string }): ReactNode {
  const [previa, setPrevia] = useState<Previa | null>(null)
  const [falhou, setFalhou] = useState(false)
  const [entrando, setEntrando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const escolherGrupo = useStore(e => e.escolherGrupo)
  const grupos = useStore(e => e.groups)

  useEffect(() => {
    let vigente = true
    api.get<Previa>(`/invites/${codigo}`)
      .then(p => { if (vigente) setPrevia(p) })
      .catch(() => { if (vigente) setFalhou(true) })
    return () => { vigente = false }
  }, [codigo])

  /**
   * Sai do endereco do convite sem empilhar historico.
   *
   * `trocarPor` e nao `irPara`: o codigo ja foi gasto, e deixar o Voltar
   * levar de volta a ele mostraria um convite que nao vale mais — com a
   * agravante de o endereco continuar circulando no historico do navegador.
   */
  function sair(): void {
    trocarPor({ nome: 'entrar' })
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
      // e a resposta certa; um alerta vermelho seria castigar quem clicou
      // duas vezes no proprio convite.
      if (e instanceof ApiError && e.code === 'already_member') {
        const jaTenho = grupos.find(g => g.name === (previa as { groupName?: string })?.groupName)
        if (jaTenho !== undefined) escolherGrupo(jaTenho.id)
        sair()
        return
      }
      setErro(e instanceof ApiError ? e.message : 'Nao foi possivel entrar no grupo.')
      setEntrando(false)
    }
  }

  return (
    <Dialogo.Root open onOpenChange={aberto => { if (!aberto) sair() }}>
      <Dialogo.Portal>
        <Dialogo.Overlay className="fixed inset-0 z-40 bg-bg/70 backdrop-blur-sm" />
        <Dialogo.Content
          className="fixed left-1/2 top-1/2 z-50 w-[min(24rem,calc(100vw-2rem))]
                     -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border-subtle
                     bg-bg-raised p-6 text-center
                     shadow-[0_8px_16px_-8px_rgb(0_0_0/0.28),0_24px_48px_-12px_rgb(0_0_0/0.32)]"
        >
          {falhou || previa?.valid === false ? (
            <>
              <Dialogo.Title className="text-[15px] font-semibold text-fg">
                Convite indisponivel
              </Dialogo.Title>
              <Dialogo.Description className="mt-2 text-[13px] text-fg-muted">
                {falhou
                  ? 'Nao foi possivel verificar este convite. Tente novamente.'
                  : textoDoMotivo((previa as { reason: string }).reason)}
              </Dialogo.Description>
              <Botao className="mt-5" largura="cheia" onClick={sair}>Voltar</Botao>
            </>
          ) : previa === null ? (
            // Esqueleto com as dimensoes finais: a resposta chega em
            // milissegundos, e um salto de layout ali chama mais atencao do
            // que a espera.
            <div className="flex flex-col items-center gap-3" aria-busy="true">
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
              <Dialogo.Title className="mt-3 text-[15px] font-semibold text-fg">
                Entrar em {previa.groupName}?
              </Dialogo.Title>
              <Dialogo.Description className="mt-1 text-[13px] text-fg-muted">
                {contagemDeMembros(previa.memberCount)}
              </Dialogo.Description>

              {erro !== null && (
                <p role="alert" className="mt-4 rounded-md border border-danger px-3 py-2
                                           text-left text-sm text-danger">
                  {erro}
                </p>
              )}

              <div className="mt-5 flex gap-2">
                <Botao variante="discreto" largura="cheia" onClick={sair} disabled={entrando}>
                  Agora nao
                </Botao>
                <Botao largura="cheia" onClick={() => { void entrar() }} disabled={entrando}>
                  {entrando ? 'Entrando...' : 'Entrar'}
                </Botao>
              </div>
            </>
          )}
        </Dialogo.Content>
      </Dialogo.Portal>
    </Dialogo.Root>
  )
}
