import { useCallback, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import * as Dialogo from '@radix-ui/react-dialog'
import { AppWindow, Monitor, RefreshCw, Volume2, VolumeX, X } from 'lucide-react'
import { Botao } from '../../ui/Botao.js'
import { nativo } from '../../lib/nativo.js'
import type { FonteDeTela, SomDaTela } from '../../lib/nativo.js'

/**
 * O seletor de tela do app de desktop.
 *
 * Substitui a caixa do Chrome, e nao por gosto: o pedido que originou o app
 * foi "transmitir a janela do sistema, nao a aba do Google". Aqui a lista vem
 * do `desktopCapturer`, que oferece TELAS e JANELAS — aba de navegador nao
 * aparece porque nao e pedida.
 *
 * O ganho maior, porem, e o som. No Chrome em Windows, compartilhar uma janela
 * nunca leva audio; so aba e tela inteira tem a caixa "compartilhar audio".
 * Por aqui o som do sistema vem junto em qualquer caso, e e por isso que a
 * opcao de som mora ACIMA da lista em vez de escondida num ajuste: ela e a
 * diferenca que a pessoa vinha procurando.
 *
 * No navegador este componente nunca e montado. Quem decide e `PainelDeVoz`,
 * lendo `nativo()`.
 */

const CHAVE_DE_SOM = 'altcast:som-da-tela'

/**
 * A escolha fica no navegador, e nao na conta, pela mesma razao que o
 * microfone e a qualidade: a resposta certa e da MAQUINA. Quem transmite de um
 * desktop com fone quer o som do jogo; quem transmite de um notebook num
 * escritorio quase sempre nao quer.
 */
export function lerSomDaTela(): SomDaTela {
  try {
    return localStorage.getItem(CHAVE_DE_SOM) === 'nenhum' ? 'nenhum' : 'sistema'
  } catch {
    return 'sistema'
  }
}

export function guardarSomDaTela(som: SomDaTela): void {
  try {
    localStorage.setItem(CHAVE_DE_SOM, som)
  } catch {
    // Nao poder lembrar a escolha nao pode impedir de faze-la agora.
  }
}

type Situacao = 'carregando' | 'pronto' | 'erro'

export function SeletorDeFonte({ aberto, aoFechar, aoEscolher, listar }: {
  aberto: boolean
  aoFechar: () => void
  /** Chamado com a fonte escolhida. Quem transmite e quem chamou. */
  aoEscolher: (id: string, som: SomDaTela) => void
  /** Injetavel para teste, pelo mesmo motivo que `criarSala` em `midia.ts`. */
  listar?: () => Promise<FonteDeTela[]>
}): ReactNode {
  const [fontes, setFontes] = useState<FonteDeTela[]>([])
  const [situacao, setSituacao] = useState<Situacao>('carregando')
  const [escolhida, setEscolhida] = useState<string | null>(null)
  const [som, setSom] = useState<SomDaTela>(lerSomDaTela)

  const carregar = useCallback(async (): Promise<void> => {
    const buscar = listar ?? nativo()?.listarFontes
    if (buscar === undefined) {
      setSituacao('erro')
      return
    }
    setSituacao('carregando')
    try {
      const lista = await buscar()
      setFontes(lista)
      setSituacao('pronto')
      // A escolha anterior pode nao existir mais: a janela foi fechada
      // enquanto o dialogo estava aberto. Mante-la selecionada deixaria o
      // botao de compartilhar habilitado para uma fonte que ja se foi.
      setEscolhida(atual => (lista.some(f => f.id === atual) ? atual : null))
    } catch {
      setSituacao('erro')
    }
  }, [listar])

  /**
   * A lista e buscada A CADA abertura, nunca uma vez.
   *
   * Janelas abrem e fecham entre duas transmissoes, e uma lista em cache
   * ofereceria o jogo que a pessoa fechou dez minutos atras — que e uma
   * escolha que falha depois de clicada, na hora mais visivel possivel.
   */
  useEffect(() => {
    if (!aberto) return
    void carregar()
  }, [aberto, carregar])

  const telas = fontes.filter(f => f.tipo === 'tela')
  const janelas = fontes.filter(f => f.tipo === 'janela')

  function confirmar(): void {
    if (escolhida === null) return
    guardarSomDaTela(som)
    aoEscolher(escolhida, som)
    aoFechar()
  }

  return (
    <Dialogo.Root open={aberto} onOpenChange={a => { if (!a) aoFechar() }}>
      <Dialogo.Portal>
        <Dialogo.Overlay className="fixed inset-0 z-40 bg-bg/70 backdrop-blur-sm
                                    data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <Dialogo.Content
          className="fixed left-1/2 top-1/2 z-50 flex max-h-[min(85vh,44rem)]
                     w-[min(52rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2
                     flex-col rounded-xl border border-border-subtle bg-bg-raised p-6
                     shadow-[0_8px_16px_-8px_rgb(0_0_0/0.28),0_24px_48px_-12px_rgb(0_0_0/0.32)]
                     data-[state=open]:animate-in data-[state=open]:fade-in-0
                     data-[state=open]:zoom-in-95"
        >
          <div className="mb-4 flex items-start justify-between gap-4">
            <div>
              <Dialogo.Title className="text-[15px] font-semibold text-fg">
                Escolha o que transmitir
              </Dialogo.Title>
              <Dialogo.Description className="mt-1 text-[13px] text-fg-muted">
                Uma tela inteira ou a janela de um programa. O som do sistema vai
                junto em qualquer uma das duas.
              </Dialogo.Description>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <Botao
                variante="fantasma"
                tamanho="iconeSm"
                onClick={() => { void carregar() }}
                disabled={situacao === 'carregando'}
              >
                <RefreshCw aria-hidden="true" />
                <span className="sr-only">Atualizar a lista</span>
              </Botao>
              <Dialogo.Close asChild>
                <Botao variante="fantasma" tamanho="iconeSm">
                  <X aria-hidden="true" />
                  <span className="sr-only">Fechar</span>
                </Botao>
              </Dialogo.Close>
            </div>
          </div>

          {/*
            O som fica ACIMA da lista, e nao ao lado do botao de confirmar: e a
            decisao que a pessoa veio tomar, e uma caixa depois da lista ficaria
            fora da tela justamente quando ha muitas janelas para rolar.
          */}
          <label
            className="mb-4 flex items-start gap-3 rounded-md border border-border-subtle
                       bg-bg p-3 text-sm"
          >
            <input
              type="checkbox"
              checked={som === 'sistema'}
              onChange={e => { setSom(e.target.checked ? 'sistema' : 'nenhum') }}
              className="mt-0.5 size-4 accent-[var(--color-accent)]"
            />
            <span className="flex flex-col gap-0.5">
              <span className="flex items-center gap-2 font-medium text-fg">
                {som === 'sistema'
                  ? <Volume2 aria-hidden="true" className="size-4" />
                  : <VolumeX aria-hidden="true" className="size-4" />}
                Transmitir o som do sistema
              </span>
              <span className="text-[13px] text-fg-muted">
                O audio do jogo ou do video chega junto, com volume proprio para quem
                assiste. Isto e o que o navegador nao consegue fazer com uma janela.
              </span>
            </span>
          </label>

          {situacao === 'erro' && (
            <p
              role="alert"
              className="rounded-md border border-danger px-3 py-2 text-sm text-danger"
            >
              Nao foi possivel listar as telas e janelas.
            </p>
          )}

          {situacao === 'carregando' && (
            <p role="status" className="py-8 text-center text-sm text-fg-muted">
              Procurando telas e janelas...
            </p>
          )}

          {situacao === 'pronto' && fontes.length === 0 && (
            <p className="py-8 text-center text-sm text-fg-muted">
              Nenhuma tela ou janela disponivel.
            </p>
          )}

          {situacao === 'pronto' && fontes.length > 0 && (
            <div className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1">
              <Grupo
                titulo="Telas"
                icone={<Monitor aria-hidden="true" className="size-4" />}
                fontes={telas}
                escolhida={escolhida}
                aoEscolher={setEscolhida}
              />
              <Grupo
                titulo="Janelas"
                icone={<AppWindow aria-hidden="true" className="size-4" />}
                fontes={janelas}
                escolhida={escolhida}
                aoEscolher={setEscolhida}
              />
            </div>
          )}

          {/*
            Escolher e confirmar sao dois passos de proposito. Um clique que
            transmite na hora faz de qualquer erro de mira uma transmissao da
            tela inteira para a sala — e o desfazer, aqui, chega sempre depois
            de alguem ja ter visto.
          */}
          <div className="mt-4 flex shrink-0 justify-end gap-2 border-t border-border-subtle pt-4">
            <Dialogo.Close asChild>
              <Botao type="button" variante="discreto">Cancelar</Botao>
            </Dialogo.Close>
            <Botao type="button" onClick={confirmar} disabled={escolhida === null}>
              Compartilhar
            </Botao>
          </div>
        </Dialogo.Content>
      </Dialogo.Portal>
    </Dialogo.Root>
  )
}

/**
 * Telas e janelas separadas, com o grupo vazio simplesmente ausente.
 *
 * Um cabecalho "Janelas" sobre o nada e pior do que nenhum cabecalho: ele
 * afirma que existe uma lista e sugere que ela falhou em carregar.
 */
function Grupo({ titulo, icone, fontes, escolhida, aoEscolher }: {
  titulo: string
  icone: ReactNode
  fontes: FonteDeTela[]
  escolhida: string | null
  aoEscolher: (id: string) => void
}): ReactNode {
  if (fontes.length === 0) return null
  return (
    <section className="mb-4 last:mb-0">
      <h3 className="mb-2 flex items-center gap-2 text-[13px] font-medium text-fg-muted">
        {icone}
        {titulo}
      </h3>
      <ul className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-3">
        {fontes.map(f => (
          <li key={f.id}>
            <button
              type="button"
              onClick={() => { aoEscolher(f.id) }}
              aria-pressed={escolhida === f.id}
              className="group flex w-full flex-col gap-2 rounded-lg border-2 border-transparent
                         bg-bg p-2 text-left transition-colors hover:border-border
                         focus-visible:border-accent aria-pressed:border-accent"
            >
              {/*
                A miniatura tem proporcao fixa. Sem ela, uma janela estreita e
                uma tela ultrawide na mesma grade produzem cartoes de alturas
                diferentes, e a lista fica com dentes.
              */}
              <span className="block aspect-video overflow-hidden rounded bg-bg-hover">
                <img src={f.miniatura} alt="" className="size-full object-contain" />
              </span>
              <span className="flex min-w-0 items-center gap-2">
                {f.icone !== null && (
                  <img src={f.icone} alt="" className="size-4 shrink-0" />
                )}
                <span className="truncate text-[13px] text-fg">{f.nome}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}
