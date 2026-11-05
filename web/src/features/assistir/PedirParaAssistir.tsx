import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import * as Dialogo from '@radix-ui/react-dialog'
import { ApiError, api } from '../../lib/api.js'
import { caminhoDe, lerRota, trocarPor } from '../../lib/rota.js'
import type { Rota } from '../../lib/rota.js'
import { useStore } from '../../lib/store.js'
import { Avatar } from '../../ui/Avatar.js'
import { Botao } from '../../ui/Botao.js'
import { usePedidosParaAssistir } from './pedidos.js'

/**
 * Quem clicou em "Assistir no Altcast" no perfil de alguem no Discord.
 *
 * Quase sempre e um amigo que NAO esta no grupo. A tela mostra quem transmite e
 * onde, e o unico botao e "Pedir para assistir": entrar continua dependendo de
 * quem transmite dizer sim. Quem ja e do grupo vai direto ao canal.
 */

export type PreviaDaTransmissao = {
  anfitriao: { displayName: string; avatarUrl: string | null }
  grupo: { name: string; iconUrl: string | null }
  tela: boolean
  membro: boolean | null
  groupId?: string
  channelId?: string
}

export function usarPreviaDaTransmissao(anfitriao: string, canal: string): {
  previa: PreviaDaTransmissao | null
  erro: string | null
} {
  const [estado, setEstado] = useState<{ previa: PreviaDaTransmissao | null; erro: string | null }>(
    { previa: null, erro: null },
  )
  useEffect(() => {
    let vigente = true
    api.get<PreviaDaTransmissao>(`/assistir/${anfitriao}/${canal}`)
      .then(previa => { if (vigente) setEstado({ previa, erro: null }) })
      .catch((e: unknown) => {
        if (!vigente) return
        setEstado({
          previa: null,
          erro: e instanceof ApiError ? e.message : 'Não foi possível abrir esta transmissão.',
        })
      })
    return () => { vigente = false }
  }, [anfitriao, canal])
  return estado
}

const CHAVE = 'altcast:assistir-depois'

/**
 * Guarda o pedido para depois do login.
 *
 * A entrada pelo Google sai do Altcast e volta pela raiz — o endereco
 * `/assistir/...` se perde no caminho. A aba e a mesma, e o `sessionStorage`
 * sobrevive a ida e volta.
 */
export function lembrarDeAssistir(rota: Extract<Rota, { nome: 'assistir' }>): void {
  try { window.sessionStorage.setItem(CHAVE, caminhoDe(rota)) } catch { /* sem armazenamento, sem retomada */ }
}

/** O pedido guardado, uma vez so. */
export function retomarAssistir(): Rota | null {
  try {
    const caminho = window.sessionStorage.getItem(CHAVE)
    window.sessionStorage.removeItem(CHAVE)
    if (caminho === null) return null
    const rota = lerRota({ pathname: caminho, search: '' })
    return rota.nome === 'assistir' ? rota : null
  } catch {
    return null
  }
}

function abrirCanal(groupId: string, channelId: string): void {
  // O grupo pode ainda nao estar na store (o `group.joined` acabou de chegar),
  // e a rota do canal e quem sabe esperar por ele.
  useStore.getState().escolherGrupo(groupId)
  trocarPor({ nome: 'canal', grupo: groupId, canal: channelId })
}

/** O cartao de quem transmite: igual nos dois lados da porta. */
function CartaoDaTransmissao({ previa }: { previa: PreviaDaTransmissao }): ReactNode {
  return (
    <div className="flex flex-col items-center">
      <Avatar nome={previa.anfitriao.displayName} url={previa.anfitriao.avatarUrl} className="size-14" />
      <p className="mt-3 text-base font-semibold text-fg">
        {previa.anfitriao.displayName} está {previa.tela ? 'transmitindo a tela' : 'em chamada'}
      </p>
      <p className="mt-1 flex items-center gap-1.5 text-sm text-fg-muted">
        <Avatar nome={previa.grupo.name} url={previa.grupo.iconUrl} tamanho="sm" quadrado />
        {previa.grupo.name}
      </p>
    </div>
  )
}

/** Fora da sessao: a previa em cima do login, e a promessa de voltar aqui. */
export function AvisoDeAssistir({ rota }: { rota: Extract<Rota, { nome: 'assistir' }> }): ReactNode {
  const { previa, erro } = usarPreviaDaTransmissao(rota.anfitriao, rota.canal)
  useEffect(() => { lembrarDeAssistir(rota) }, [rota])

  return (
    <div className="mb-6 rounded-lg border border-border-subtle bg-bg-raised p-5 text-center">
      {previa !== null ? (
        <>
          <CartaoDaTransmissao previa={previa} />
          <p className="mt-3 text-sm text-fg-muted">Entre para pedir para assistir.</p>
        </>
      ) : (
        <p className="text-sm text-fg-muted" aria-busy={erro === null}>
          {erro ?? 'Carregando a transmissão…'}
        </p>
      )}
    </div>
  )
}

type Fase =
  | { tipo: 'previa' }
  | { tipo: 'enviando' }
  | { tipo: 'esperando'; id: string }
  | { tipo: 'recusado' }

/** Com sessao: a previa e o pedido, num dialogo sobre o aplicativo. */
export function PedirParaAssistir({ anfitriao, canal }: { anfitriao: string; canal: string }): ReactNode {
  const { previa, erro: erroDaPrevia } = usarPreviaDaTransmissao(anfitriao, canal)
  const [fase, setFase] = useState<Fase>({ tipo: 'previa' })
  const [erro, setErro] = useState<string | null>(null)
  const resposta = usePedidosParaAssistir(e => (fase.tipo === 'esperando' ? e.respostas[fase.id] : undefined))

  useEffect(() => {
    if (resposta === undefined) return
    if (resposta.tipo === 'aceito') abrirCanal(resposta.groupId, resposta.channelId)
    else setFase({ tipo: 'recusado' })
  }, [resposta])

  function sair(): void {
    trocarPor({ nome: 'app' })
  }

  async function pedir(): Promise<void> {
    setErro(null)
    setFase({ tipo: 'enviando' })
    try {
      const r = await api.post<{ id: string }>(`/assistir/${anfitriao}/${canal}/pedido`)
      setFase({ tipo: 'esperando', id: r.id })
    } catch (e) {
      // Ja ser do grupo nao e erro para quem clicou: leva ao canal.
      if (e instanceof ApiError && e.code === 'already_member') {
        const d = e.details as { groupId?: unknown; channelId?: unknown } | null
        if (typeof d?.groupId === 'string' && typeof d.channelId === 'string') {
          abrirCanal(d.groupId, d.channelId)
          return
        }
      }
      setErro(e instanceof ApiError ? e.message : 'Não foi possível enviar o pedido.')
      setFase({ tipo: 'previa' })
    }
  }

  const nome = previa?.anfitriao.displayName ?? ''

  return (
    <Dialogo.Root open onOpenChange={aberto => { if (!aberto) sair() }}>
      <Dialogo.Portal>
        <Dialogo.Overlay className="fixed inset-0 z-40 bg-bg/70 backdrop-blur-sm" />
        <Dialogo.Content
          className="fixed left-1/2 top-1/2 z-50 w-[min(24rem,calc(100%-2rem))]
                     -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border-subtle
                     bg-bg-raised p-6 text-center shadow-dialog"
        >
          {erroDaPrevia !== null ? (
            <>
              <Dialogo.Title className="text-base font-semibold text-fg">
                Transmissão indisponível
              </Dialogo.Title>
              <Dialogo.Description className="mt-2 text-sm text-fg-muted">{erroDaPrevia}</Dialogo.Description>
              <Botao className="mt-5" largura="cheia" onClick={sair}>Voltar</Botao>
            </>
          ) : previa === null ? (
            <div className="flex flex-col items-center gap-3" aria-busy="true">
              <Dialogo.Title className="sr-only">Carregando a transmissão</Dialogo.Title>
              <div className="size-14 rounded-full bg-bg-hover" />
              <div className="h-4 w-44 rounded bg-bg-hover" />
              <div className="h-3 w-24 rounded bg-bg-hover" />
              <div className="mt-2 h-9 w-full rounded-md bg-bg-hover" />
            </div>
          ) : (
            <>
              <Dialogo.Title asChild><div><CartaoDaTransmissao previa={previa} /></div></Dialogo.Title>
              <Dialogo.Description className="mt-3 text-sm text-fg-muted">
                {previa.membro === true
                  ? 'Você já participa deste grupo.'
                  : fase.tipo === 'esperando'
                    ? `Pedido enviado. Assim que ${nome} aceitar, você entra no canal.`
                    : fase.tipo === 'recusado'
                      ? `${nome} não aceitou o pedido desta vez.`
                      : `Peça para assistir. ${nome} decide se você entra no grupo.`}
              </Dialogo.Description>

              {erro !== null && (
                <p role="alert" className="mt-4 rounded-md border border-danger px-3 py-2
                                           text-left text-sm text-danger">
                  {erro}
                </p>
              )}

              <div className="mt-5 grid grid-cols-2 gap-2 max-[360px]:grid-cols-1">
                <Botao variante="discreto" largura="cheia" onClick={sair} className="max-[360px]:order-2">
                  {fase.tipo === 'recusado' ? 'Fechar' : 'Agora não'}
                </Botao>
                {previa.membro === true && previa.groupId !== undefined && previa.channelId !== undefined ? (
                  <Botao
                    largura="cheia" className="max-[360px]:order-1"
                    onClick={() => { abrirCanal(previa.groupId!, previa.channelId!) }}
                  >
                    Abrir canal
                  </Botao>
                ) : (
                  <Botao
                    largura="cheia" className="max-[360px]:order-1"
                    disabled={fase.tipo === 'enviando' || fase.tipo === 'esperando' || fase.tipo === 'recusado'}
                    onClick={() => { void pedir() }}
                  >
                    {fase.tipo === 'enviando' ? 'Enviando…'
                      : fase.tipo === 'esperando' ? 'Aguardando…'
                        : 'Pedir para assistir'}
                  </Botao>
                )}
              </div>
            </>
          )}
        </Dialogo.Content>
      </Dialogo.Portal>
    </Dialogo.Root>
  )
}
