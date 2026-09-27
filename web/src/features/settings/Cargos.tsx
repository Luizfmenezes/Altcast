import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { Plus, Shield, Trash2, TriangleAlert } from 'lucide-react'
import { ApiError, api } from '../../lib/api.js'
import { useStore, possoNoGrupo } from '../../lib/store.js'
import { Botao } from '../../ui/Botao.js'
import { Campo } from '../../ui/Campo.js'
import { ConfirmarAcao } from '../../ui/ConfirmarAcao.js'
import { cn } from '../../lib/utils.js'
import type { Acao, Cargo, DescricaoDeAcao } from '../../lib/tipos.js'

/**
 * Cargos: a lista a esquerda, o cargo escolhido a direita.
 *
 * O problema que esta tela existe para resolver nao e tecnico. Uma tela de
 * permissoes e, por natureza, uma parede de interruptores — e uma parede de
 * interruptores sem hierarquia visual e o jeito mais confiavel de fazer alguem
 * desistir de configurar o proprio grupo. Tres decisoes atacam isso:
 *
 * 1. **Os interruptores vem AGRUPADOS por assunto**, e o agrupamento vem do
 *    servidor junto com um rotulo e uma frase explicando o que cada permissao
 *    faz. Ninguem deveria ter de deduzir o que `channel.manage_members`
 *    significa a partir do nome dele.
 * 2. **O que concede poder sobre pessoas e marcado**, com um aviso proprio.
 *    "Remover membros" e "Apagar o grupo" nao podem ter o mesmo peso visual
 *    que "Reagir".
 * 3. **O que voce nao pode conceder aparece desabilitado e explicado**, em vez
 *    de aceitar o clique e falhar no servidor. A regra "ninguem concede o que
 *    nao tem" e do servidor; esconde-la da tela faria a recusa parecer um bug.
 *
 * As permissoes de AUTORIA — editar e apagar a propria mensagem — nao aparecem
 * porque nao sao concediveis: elas vem de ter escrito a mensagem, e um
 * interruptor que nao muda nada so ensina que os interruptores mentem.
 */

const PALETA = [
  '#5865F2', '#3BA55D', '#FAA81A', '#ED4245', '#EB459E',
  '#9B59B6', '#1ABC9C', '#E67E22', '#95A5A6', '#11806A',
] as const

const SECOES: DescricaoDeAcao['secao'][] = ['Grupo', 'Canais', 'Mensagens', 'Voz']

/** A cor de um cargo contra o fundo do tema.
 *
 *  Cor de cargo e escolhida por gente, e gente escolhe cinza-claro. O texto
 *  colorido fica sempre sobre a cor de fundo do proprio chip, com opacidade
 *  baixa, em vez de direto no fundo do tema: assim nenhuma escolha derruba o
 *  contraste abaixo do minimo, e WCAG AA continua sendo requisito e nao
 *  revisao final. */
function ChipDeCor({ cor, nome }: { cor: string | null; nome: string }): ReactNode {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded px-1.5 py-0.5 text-[12px] font-medium"
      style={cor === null ? undefined : { color: cor, backgroundColor: `${cor}1f` }}
    >
      <span
        aria-hidden="true"
        className="size-2 shrink-0 rounded-full"
        style={{ backgroundColor: cor ?? 'currentColor' }}
      />
      {nome}
    </span>
  )
}

/**
 * O nome do cargo, salvo ao SAIR do campo — nunca a cada tecla.
 *
 * O campo controlado direto pela store parecia mais simples e teria disparado
 * um PATCH por caractere digitado: dez requisicoes para escrever "Moderador",
 * dez eventos de tempo real para o grupo inteiro, e uma corrida em que a
 * resposta da terceira chega depois da quinta e devolve o nome pela metade.
 *
 * O estado local so cede a store quando a identidade do cargo muda — trocar de
 * cargo na lista precisa trocar o que o campo mostra, e um `key` resolveria
 * isso de fora, mas escondendo o motivo.
 */
function NomeDoCargo({ cargo, podeEditar, aoSalvar }: {
  cargo: Cargo
  podeEditar: boolean
  aoSalvar: (nome: string) => void
}): ReactNode {
  const [valor, setValor] = useState(cargo.name)
  useEffect(() => { setValor(cargo.name) }, [cargo.id, cargo.name])

  function confirmar(): void {
    const limpo = valor.trim()
    if (limpo === '' || limpo === cargo.name) { setValor(cargo.name); return }
    aoSalvar(limpo)
  }

  return (
    <div
      onBlur={confirmar}
      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); confirmar() } }}
    >
      <Campo
        rotulo="Nome do cargo"
        valor={valor}
        aoMudar={podeEditar ? setValor : () => undefined}
        dica="Salva ao sair do campo."
      />
    </div>
  )
}

export function Cargos({ groupId }: { groupId: string }): ReactNode {
  /**
   * O MAPA cru, e a lista derivada com `useMemo`.
   *
   * Um seletor `Object.values(e.cargos).filter(...)` parecia mais direto e
   * era um laco infinito: ele constroi um array NOVO a cada chamada, o zustand
   * compara por identidade, conclui que mudou em todo render e dispara outro —
   * a aba trava. E a mesma armadilha que `PainelDeVoz` documenta na constante
   * `NINGUEM`, e ela cobra o mesmo preco aqui.
   *
   * O mapa e uma referencia estavel; derivar dele e trabalho de render, e nao
   * de assinatura.
   */
  const todosOsCargos = useStore(e => e.cargos)
  const cargosDoGrupo = useMemo(
    () => Object.values(todosOsCargos).filter(c => c.groupId === groupId),
    [todosOsCargos, groupId],
  )
  const posso = useStore(e => possoNoGrupo(e, groupId, 'group.manage_roles'))
  const grupo = useStore(e => e.groups.find(g => g.id === groupId))
  const eu = useStore(e => e.user?.id)
  const cargosDoMembro = useStore(e => e.cargosDoMembro)

  const [catalogo, setCatalogo] = useState<DescricaoDeAcao[]>([])
  const [escolhido, setEscolhido] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [criando, setCriando] = useState(false)
  const [nomeNovo, setNomeNovo] = useState('')

  useEffect(() => {
    let vigente = true
    api.get<DescricaoDeAcao[]>('/permissions/catalog')
      .then(c => { if (vigente && Array.isArray(c)) setCatalogo(c) })
      .catch(() => undefined)
    return () => { vigente = false }
  }, [])

  const ordenados = useMemo(
    () => [...cargosDoGrupo].sort((a, b) => b.position - a.position || a.name.localeCompare(b.name)),
    [cargosDoGrupo],
  )

  // A altura de quem esta configurando. O dono atravessa tudo, como em can.ts.
  const minhaAltura = useMemo(() => {
    if (grupo?.role === 'owner') return Number.POSITIVE_INFINITY
    if (eu === undefined) return 0
    const meus = cargosDoMembro[`${groupId}:${eu}`] ?? []
    let maior = 0
    for (const id of meus) {
      const c = todosOsCargos[id]
      if (c !== undefined && !c.isDefault && c.position > maior) maior = c.position
    }
    return maior
  }, [grupo?.role, eu, groupId, cargosDoMembro, todosOsCargos])

  /** O conjunto que EU tenho: e o teto do que posso conceder. */
  const minhasPermissoes = useMemo(() => {
    const conjunto = new Set<Acao>()
    if (grupo?.role === 'owner') {
      for (const d of catalogo) conjunto.add(d.acao)
      return conjunto
    }
    if (eu === undefined) return conjunto
    const meus = cargosDoMembro[`${groupId}:${eu}`] ?? []
    for (const c of cargosDoGrupo) {
      if (!c.isDefault && !meus.includes(c.id)) continue
      for (const a of c.permissions) conjunto.add(a)
    }
    return conjunto
  }, [grupo?.role, eu, groupId, cargosDoMembro, cargosDoGrupo, catalogo])

  const atual = escolhido === null ? ordenados[0] ?? null : ordenados.find(c => c.id === escolhido) ?? null
  const alcanco = atual !== null && (atual.isDefault || minhaAltura > atual.position)

  async function criar(): Promise<void> {
    setErro(null)
    try {
      const novo = await api.post<Cargo>(`/groups/${groupId}/roles`, {
        name: nomeNovo.trim(), color: PALETA[ordenados.length % PALETA.length],
      })
      // O `role.created` do socket poe na store; aqui so apontamos para ele.
      setEscolhido(novo.id)
      setNomeNovo('')
      setCriando(false)
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : 'Não foi possível criar o cargo.')
    }
  }

  async function salvar(cargo: Cargo, campos: Partial<Cargo>): Promise<void> {
    setErro(null)
    try {
      await api.patch(`/groups/${groupId}/roles/${cargo.id}`, campos)
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : 'Não foi possível salvar.')
    }
  }

  async function apagar(cargo: Cargo): Promise<void> {
    setErro(null)
    try {
      await api.delete(`/groups/${groupId}/roles/${cargo.id}`)
      setEscolhido(null)
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : 'Não foi possível apagar o cargo.')
    }
  }

  function alternar(cargo: Cargo, acao: Acao, ligado: boolean): void {
    const proximas = ligado
      ? [...cargo.permissions, acao]
      : cargo.permissions.filter(a => a !== acao)
    void salvar(cargo, { permissions: [...new Set(proximas)] })
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Sem `<h3>Cargos</h3>` aqui: a tela de configuracoes ja imprime o
          titulo e o subtitulo da secao, e repeti-los davam dois "Cargos"
          empilhados com descricoes diferentes — o tipo de duplicacao que faz a
          pessoa reler para descobrir se sao a mesma coisa. */}
      <p className="max-w-prose text-[13px] text-fg-muted">
        Quem tem mais de um cargo soma o que cada um permite. O cargo mais alto da lista
        manda mais, e você só edita o que estiver abaixo do seu.
      </p>

      {erro !== null && (
        <p role="alert" className="rounded-md border border-danger px-3 py-2 text-sm text-danger">
          {erro}
        </p>
      )}

      <div className="flex flex-col gap-4 md:flex-row md:items-start">
        {/* A lista. Ordenada do mais alto para o mais baixo, que e a ordem em
            que a hierarquia funciona — e nao alfabetica, que esconderia
            justamente a informacao que decide quem manda em quem. */}
        <div className="flex shrink-0 flex-col gap-2 md:w-52">
          <ul className="flex list-none flex-col gap-0.5">
            {ordenados.map(cargo => (
              <li key={cargo.id}>
                <button
                  type="button"
                  onClick={() => setEscolhido(cargo.id)}
                  aria-current={atual?.id === cargo.id ? 'true' : undefined}
                  className={cn(
                    `flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left
                     text-[13px] transition-colors`,
                    atual?.id === cargo.id
                      ? 'bg-bg-hover text-fg'
                      : 'text-fg-muted hover:bg-bg-hover hover:text-fg',
                  )}
                >
                  <span
                    aria-hidden="true"
                    className="size-2.5 shrink-0 rounded-full border border-border-subtle"
                    style={{ backgroundColor: cargo.color ?? 'transparent' }}
                  />
                  <span className="min-w-0 flex-1 truncate">{cargo.name}</span>
                  {cargo.isDefault && (
                    <span className="shrink-0 text-[10px] uppercase tracking-wide text-fg-muted">
                      todos
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>

          {posso && (criando ? (
            <div className="flex flex-col gap-2 rounded-md border border-border-subtle p-2">
              <Campo rotulo="Nome do cargo" valor={nomeNovo} aoMudar={setNomeNovo} />
              <div className="flex gap-2">
                <Botao
                  tamanho="sm" largura="cheia"
                  disabled={nomeNovo.trim() === ''}
                  onClick={() => { void criar() }}
                >
                  Criar
                </Botao>
                <Botao
                  tamanho="sm" variante="discreto" largura="cheia"
                  onClick={() => { setCriando(false); setNomeNovo('') }}
                >
                  Cancelar
                </Botao>
              </div>
            </div>
          ) : (
            <Botao variante="discreto" tamanho="sm" onClick={() => setCriando(true)}>
              <Plus aria-hidden="true" className="size-4" />
              Novo cargo
            </Botao>
          ))}
        </div>

        {/* O cargo escolhido. */}
        {atual === null ? (
          <p className="text-[13px] text-fg-muted">Nenhum cargo ainda.</p>
        ) : (
          <div className="min-w-0 flex-1 flex-col gap-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <ChipDeCor cor={atual.color} nome={atual.name} />
              {posso && alcanco && !atual.isDefault && (
                <ConfirmarAcao
                  titulo={`Apagar o cargo ${atual.name}?`}
                  descricao={
                    'Quem tinha este cargo perde as permissões dele e a cor do nome. '
                    + 'As pessoas continuam no grupo.'
                  }
                  confirmar="Apagar cargo"
                  aoConfirmar={() => { void apagar(atual) }}
                  gatilho={
                    <Botao variante="fantasma" tamanho="sm">
                      <Trash2 aria-hidden="true" className="size-4" />
                      Apagar
                    </Botao>
                  }
                />
              )}
            </div>

            {!alcanco && (
              <p className="mt-3 flex items-start gap-2 rounded-md border border-border-subtle
                            bg-bg px-3 py-2 text-[13px] text-fg-muted">
                <Shield aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                Este cargo está na sua altura ou acima dela. Você pode ver, mas não editar —
                e o que impede alguém de se promover pela própria tela de cargos.
              </p>
            )}

            {atual.isDefault && (
              <p className="mt-3 rounded-md border border-border-subtle bg-bg px-3 py-2
                            text-[13px] text-fg-muted">
                Este é o cargo de <strong className="font-medium text-fg">todos</strong>: vale
                para quem está no grupo sem nenhum outro cargo. Ele não se renomeia nem se
                apaga, mas o que ele permite é o piso do grupo inteiro.
              </p>
            )}

            {!atual.isDefault && (
              <div className="mt-4 flex flex-col gap-3">
                <div className="max-w-xs">
                  <NomeDoCargo
                    cargo={atual}
                    podeEditar={posso && alcanco}
                    aoSalvar={nome => { void salvar(atual, { name: nome }) }}
                  />
                </div>

                <fieldset disabled={!posso || !alcanco} className="flex flex-col gap-2">
                  <legend className="text-[11px] uppercase tracking-wide text-fg-muted">
                    Cor
                  </legend>
                  <div className="flex flex-wrap gap-1.5">
                    {PALETA.map(cor => (
                      <button
                        key={cor}
                        type="button"
                        onClick={() => { void salvar(atual, { color: cor }) }}
                        aria-label={`Usar a cor ${cor}`}
                        aria-pressed={atual.color?.toLowerCase() === cor.toLowerCase()}
                        className={cn(
                          `size-7 rounded-md border-2 transition-transform
                           hover:scale-110 disabled:hover:scale-100`,
                          atual.color?.toLowerCase() === cor.toLowerCase()
                            ? 'border-fg' : 'border-transparent',
                        )}
                        style={{ backgroundColor: cor }}
                      />
                    ))}
                    <button
                      type="button"
                      onClick={() => { void salvar(atual, { color: null }) }}
                      aria-label="Sem cor"
                      aria-pressed={atual.color === null}
                      className={cn(
                        `flex size-7 items-center justify-center rounded-md border-2
                         text-[10px] text-fg-muted transition-transform hover:scale-110`,
                        atual.color === null ? 'border-fg' : 'border-border-subtle',
                      )}
                    >
                      —
                    </button>
                  </div>
                </fieldset>
              </div>
            )}

            <div className="mt-6 flex flex-col gap-5">
              {SECOES.map(secao => {
                const itens = catalogo.filter(d => d.secao === secao)
                if (itens.length === 0) return null
                return (
                  <fieldset key={secao} disabled={!posso || !alcanco} className="flex flex-col gap-1">
                    <legend className="mb-1 text-[11px] uppercase tracking-wide text-fg-muted">
                      {secao}
                    </legend>
                    {itens.map(d => {
                      const marcada = atual.permissions.includes(d.acao)
                      // Nao posso conceder o que eu mesmo nao tenho. A regra e
                      // do servidor; mostra-la aqui e o que impede a recusa de
                      // parecer um defeito.
                      const forcaDesligado = !marcada && !minhasPermissoes.has(d.acao)
                      return (
                        <label
                          key={d.acao}
                          className={cn(
                            `flex cursor-pointer items-start gap-3 rounded-md px-2 py-2
                             transition-colors hover:bg-bg-hover`,
                            (forcaDesligado || !posso || !alcanco) && 'cursor-not-allowed opacity-60',
                          )}
                        >
                          <input
                            type="checkbox"
                            checked={marcada}
                            disabled={forcaDesligado}
                            onChange={e => alternar(atual, d.acao, e.target.checked)}
                            className="mt-0.5 size-4 shrink-0 accent-accent"
                          />
                          <span className="min-w-0 flex-1">
                            <span className="flex flex-wrap items-center gap-1.5 text-[13px] text-fg">
                              {d.rotulo}
                              {d.sensivel === true && (
                                <span
                                  className="inline-flex items-center gap-1 rounded bg-danger/12
                                             px-1.5 py-0.5 text-[10px] font-medium text-danger"
                                >
                                  <TriangleAlert aria-hidden="true" className="size-3" />
                                  poder sobre pessoas
                                </span>
                              )}
                            </span>
                            <span className="mt-0.5 block text-[12px] leading-relaxed text-fg-muted">
                              {d.descricao}
                              {forcaDesligado && ' Você não tem esta permissão, então não pode concedê-la.'}
                            </span>
                          </span>
                        </label>
                      )
                    })}
                  </fieldset>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
