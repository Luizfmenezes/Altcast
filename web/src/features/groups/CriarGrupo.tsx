import { useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import * as Dialogo from '@radix-ui/react-dialog'
import { Check, Copy, Plus, X } from 'lucide-react'
import { ApiError, api } from '../../lib/api.js'
import { useStore } from '../../lib/store.js'
import { Campo } from '../../ui/Campo.js'
import { Botao } from '../../ui/Botao.js'
import { Dica } from '../../ui/Tooltip.js'
import type { Grupo } from '../../lib/tipos.js'

/**
 * Criacao de grupo, em duas etapas.
 *
 * A segunda etapa existe por um motivo concreto: um grupo sozinho nao serve
 * para nada, e o link que o torna util morava tres cliques adiante, dentro de
 * Configuracoes > Grupo. Quem acabava de criar o primeiro grupo ficava olhando
 * um canal vazio sem saber como chamar alguem.
 *
 * Entao o dialogo nao fecha ao criar: ele vira a tela do convite, com o link
 * ja copiado. O grupo e o convite nascem no mesmo gesto porque e assim que a
 * pessoa pensa neles.
 *
 * Conta sem e-mail confirmado recebe 403 do servidor — nas DUAS chamadas, que
 * passam pelo mesmo portao. A interface nao esconde o botao por isso: esconder
 * deixaria a pessoa sem entender o que falta.
 */

/** Uma etapa, e nao um booleano: `codigo` so existe depois de o grupo existir. */
type Etapa =
  | { fase: 'nome' }
  | { fase: 'convite'; nomeDoGrupo: string; codigo: string | null }

/** Sete dias, usos ilimitados: o mesmo padrao que `Convidar.tsx` ja oferece. */
const VALIDADE_PADRAO_HORAS = 24 * 7

export function CriarGrupo({ gatilho }: { gatilho?: ReactNode }): ReactNode {
  const [aberto, setAberto] = useState(false)
  const [etapa, setEtapa] = useState<Etapa>({ fase: 'nome' })
  const [nome, setNome] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)
  const [copiado, setCopiado] = useState(false)
  const cota = useStore(e => e.cotaDeGrupos)

  // `max: null` e o administrador da plataforma: sem teto. Cota ausente e um
  // servidor que nao fala disso — e entao a tela nao promete teto nenhum.
  const noTeto = cota !== null && cota.max !== null && cota.used >= cota.max

  function reiniciar(estaAberto: boolean): void {
    setAberto(estaAberto)
    if (estaAberto) return
    // So ao FECHAR: limpar na abertura apagaria a tela de convite de quem
    // reabriu o dialogo sem querer.
    setEtapa({ fase: 'nome' })
    setNome('')
    setErro(null)
    setCopiado(false)
  }

  function enderecoDe(codigo: string): string {
    return `${window.location.origin}/convite/${codigo}`
  }

  async function copiar(codigo: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(enderecoDe(codigo))
      setCopiado(true)
    } catch {
      // Area de transferencia negada pelo navegador. O endereco esta na tela
      // num campo selecionavel, entao nao ha nada perdido — so nao ha atalho.
      setCopiado(false)
    }
  }

  async function enviar(evento: FormEvent): Promise<void> {
    evento.preventDefault()
    setErro(null)
    setEnviando(true)
    try {
      const grupo = await api.post<Grupo & { id: string }>('/groups', { name: nome })
      // Nada de apontar a tela daqui.
      //
      // Este trecho chamava `escolherGrupo(grupo.id)` confiando num `ready`
      // que nao vinha: o `ready` e a fotografia da CONEXAO, e nao chega de
      // novo porque um grupo nasceu. O resultado era `grupoAtivo` apontando
      // para um grupo fora de `groups[]`, sem canal nenhum — a tela em branco
      // que so o refresh resolvia.
      //
      // Agora quem poe o grupo na store e aponta a tela para ele e o
      // `group.created` do socket, que chega com os canais junto. Uma fonte da
      // verdade, e ela e o servidor.

      // O convite e um segundo pedido, e ele pode falhar sozinho — por
      // exemplo, com e-mail nao confirmado, que barra os dois. Falhar aqui NAO
      // desfaz o grupo: a pessoa segue para a etapa de convite sem link, com
      // um caminho claro, em vez de ficar olhando um erro sobre um grupo que
      // na verdade foi criado.
      let codigo: string | null = null
      try {
        const convite = await api.post<{ code: string }>(
          `/groups/${grupo.id}/invites`, { expiresInHours: VALIDADE_PADRAO_HORAS },
        )
        codigo = convite.code
        void copiar(convite.code)
      } catch {
        codigo = null
      }

      setEtapa({ fase: 'convite', nomeDoGrupo: grupo.name, codigo })
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : 'Não foi possível criar o grupo.')
    } finally {
      setEnviando(false)
    }
  }

  // Extraido antes do JSX para o TypeScript estreitar o tipo uma vez so, em
  // vez de exigir asserção nao-nula dentro de cada manipulador.
  const codigo = etapa.fase === 'convite' ? etapa.codigo : null

  const rotuloDoGatilho = noTeto
    ? `Você já criou o máximo de ${cota?.max} grupos`
    : cota?.max == null ? 'Criar grupo' : `Criar grupo — ${cota.used} de ${cota.max}`

  return (
    <Dialogo.Root open={aberto} onOpenChange={reiniciar}>
      <Dialogo.Trigger asChild disabled={noTeto}>
        {gatilho ?? (
          <Dica texto={rotuloDoGatilho} lado="right">
            <button
              type="button"
              disabled={noTeto}
              className="flex size-10 items-center justify-center rounded-[10px] border
                         border-dashed border-border text-fg-muted transition-colors
                         hover:border-accent hover:text-accent
                         disabled:cursor-not-allowed disabled:opacity-40
                         disabled:hover:border-border disabled:hover:text-fg-muted"
            >
              <Plus aria-hidden="true" strokeWidth={2} className="size-5" />
              <span className="sr-only">{rotuloDoGatilho}</span>
            </button>
          </Dica>
        )}
      </Dialogo.Trigger>

      <Dialogo.Portal>
        <Dialogo.Overlay className="fixed inset-0 z-40 bg-bg/70 backdrop-blur-sm
                                    data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <Dialogo.Content
          className="fixed left-1/2 top-1/2 z-50 w-[min(26rem,calc(100vw-2rem))]
                     -translate-x-1/2 -translate-y-1/2 rounded-lg border
                     border-border-subtle bg-bg-raised p-6
                     shadow-dialog
                     data-[state=open]:animate-in data-[state=open]:fade-in-0
                     data-[state=open]:zoom-in-95"
        >
          <div className="mb-4 flex items-start justify-between gap-4">
            <div>
              <Dialogo.Title className="text-[15px] font-semibold text-fg">
                {etapa.fase === 'nome' ? 'Criar um grupo' : `${etapa.nomeDoGrupo} esta pronto`}
              </Dialogo.Title>
              <Dialogo.Description className="mt-1 text-[13px] text-fg-muted">
                {etapa.fase === 'nome'
                  ? 'Ele já nasce com um canal #geral. Você pode renomear depois.'
                  : etapa.codigo === null
                    ? 'O grupo foi criado. O convite você gera nas configurações dele.'
                    : 'Mande este link para quem você quiser dentro. Ele vale sete dias.'}
              </Dialogo.Description>
            </div>
            <Dialogo.Close asChild>
              <Botao variante="fantasma" tamanho="iconeSm">
                <X aria-hidden="true" />
                <span className="sr-only">Fechar</span>
              </Botao>
            </Dialogo.Close>
          </div>

          {erro !== null && (
            <p role="alert" className="mb-4 rounded-md border border-danger px-3 py-2
                                       text-sm text-danger">
              {erro}
            </p>
          )}

          {etapa.fase === 'nome' ? (
            <form onSubmit={enviar} className="flex flex-col gap-4" noValidate>
              <Campo
                rotulo="Nome do grupo" valor={nome} aoMudar={setNome}
                espacoReservado="Anticorp" obrigatorio
              />
              <div className="flex justify-end gap-2">
                <Dialogo.Close asChild>
                  <Botao type="button" variante="discreto">Cancelar</Botao>
                </Dialogo.Close>
                <Botao type="submit" disabled={enviando || nome.trim() === ''}>
                  {enviando ? 'Criando...' : 'Criar grupo'}
                </Botao>
              </div>
            </form>
          ) : (
            <div className="flex flex-col gap-4">
              {codigo !== null && (
                <div className="flex flex-col gap-2">
                  <label
                    htmlFor="link-do-convite"
                    className="text-xs uppercase tracking-wide text-fg-muted"
                  >
                    Link de convite
                  </label>
                  <div className="flex gap-2">
                    {/*
                      Somente leitura e selecionado ao focar: o link e para
                      copiar, nunca para editar, e quem nao tem area de
                      transferencia ainda consegue pegar com o teclado.
                    */}
                    <input
                      id="link-do-convite"
                      readOnly
                      value={enderecoDe(codigo)}
                      onFocus={e => e.currentTarget.select()}
                      className="min-w-0 flex-1 rounded-md border border-border bg-bg
                                 px-3 py-2 font-mono text-[13px] text-fg"
                    />
                    <Botao
                      type="button"
                      onClick={() => { void copiar(codigo) }}
                      aria-label={copiado ? 'Link copiado' : 'Copiar link'}
                    >
                      {copiado
                        ? <Check aria-hidden="true" className="size-4" />
                        : <Copy aria-hidden="true" className="size-4" />}
                      {copiado ? 'Copiado' : 'Copiar'}
                    </Botao>
                  </div>
                  {/*
                    role="status" e nao aria-live no proprio botao: o rotulo do
                    botao ja muda, e anunciar a mudanca DELE interromperia quem
                    acabou de aciona-lo.
                  */}
                  <p role="status" className="min-h-4 text-[12px] text-fg-muted">
                    {copiado ? 'Link copiado para a área de transferência.' : ''}
                  </p>
                </div>
              )}

              <div className="flex justify-end">
                <Dialogo.Close asChild>
                  <Botao type="button">Ir para o grupo</Botao>
                </Dialogo.Close>
              </div>
            </div>
          )}
        </Dialogo.Content>
      </Dialogo.Portal>
    </Dialogo.Root>
  )
}
